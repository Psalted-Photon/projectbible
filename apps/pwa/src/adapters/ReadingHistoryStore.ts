import type {
  ReadingHistoryStore,
  ReadingHistoryEntry,
  ActiveReadingPlan,
  ReadingPlanDay
} from '@projectbible/core';
import { readTransaction, writeTransaction, generateId } from './db';
import type { DBReadingHistoryEntry, DBActiveReadingPlan, DBReadingPlanDay } from './db';

/**
 * IndexedDB implementation of ReadingHistoryStore
 * Tracks reading history and manages reading plans with progress
 */
export class IndexedDBReadingHistoryStore implements ReadingHistoryStore {
  
  // ===== Reading History =====
  
  /**
   * Record that a chapter was read
   */
  async recordReading(book: string, chapter: number, planId?: string): Promise<ReadingHistoryEntry> {
    const now = Date.now();
    const entry: DBReadingHistoryEntry = {
      id: generateId(),
      book,
      chapter,
      readAt: now,
      planId
    };
    
    await writeTransaction('reading_history', (store) => store.add(entry));
    
    // If part of a plan, check if we should mark the day complete
    if (planId) {
      await this.checkAndCompletePlanDay(planId, book, chapter);
    }
    
    return this.dbToHistoryEntry(entry);
  }

  /**
   * Get reading history, optionally filtered by book/chapter
   */
  async getReadingHistory(book?: string, chapter?: number): Promise<ReadingHistoryEntry[]> {
    if (book && chapter !== undefined) {
      const entries = await readTransaction<DBReadingHistoryEntry[]>(
        'reading_history',
        (store) => {
          const index = store.index('book_chapter');
          return index.getAll([book, chapter]);
        }
      );
      return entries.map(e => this.dbToHistoryEntry(e));
    }
    
    if (book) {
      const allEntries = await readTransaction<DBReadingHistoryEntry[]>(
        'reading_history',
        (store) => store.getAll()
      );
      const filtered = allEntries.filter(e => e.book === book);
      return filtered.map(e => this.dbToHistoryEntry(e));
    }
    
    const entries = await readTransaction<DBReadingHistoryEntry[]>(
      'reading_history',
      (store) => store.getAll()
    );
    return entries.map(e => this.dbToHistoryEntry(e));
  }

  /**
   * Check if a chapter has been read
   */
  async hasRead(book: string, chapter: number, planId?: string): Promise<boolean> {
    const entries = await readTransaction<DBReadingHistoryEntry[]>(
      'reading_history',
      (store) => {
        const index = store.index('book_chapter');
        return index.getAll([book, chapter]);
      }
    );
    
    if (!planId) {
      return entries.length > 0;
    }
    
    return entries.some(e => e.planId === planId);
  }

  /**
   * Get reading streak (consecutive days with readings)
   */
  async getReadingStreak(): Promise<number> {
    const entries = await readTransaction<DBReadingHistoryEntry[]>(
      'reading_history',
      (store) => {
        const index = store.index('readAt');
        return index.getAll();
      }
    );
    
    if (entries.length === 0) return 0;
    
    // Sort by date descending
    entries.sort((a, b) => b.readAt - a.readAt);
    
    // Get unique days
    const days = new Set<string>();
    for (const entry of entries) {
      const date = new Date(entry.readAt);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      days.add(dayKey);
    }
    
    const uniqueDays = Array.from(days).sort().reverse();
    
    // Count consecutive days from today
    let streak = 0;
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    
    for (let i = 0; i < uniqueDays.length; i++) {
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);
      const expectedKey = `${expectedDate.getFullYear()}-${expectedDate.getMonth()}-${expectedDate.getDate()}`;
      
      if (uniqueDays[i] === expectedKey) {
        streak++;
      } else {
        break;
      }
    }
    
    return streak;
  }

  /**
   * Get total chapters read (unique book+chapter combinations)
   */
  async getTotalChaptersRead(): Promise<number> {
    const entries = await readTransaction<DBReadingHistoryEntry[]>(
      'reading_history',
      (store) => store.getAll()
    );
    
    const uniqueChapters = new Set<string>();
    for (const entry of entries) {
      uniqueChapters.add(`${entry.book}-${entry.chapter}`);
    }
    
    return uniqueChapters.size;
  }

  // ===== Reading Plan Management =====

  /**
   * Start a new reading plan
   */
  async startReadingPlan(name: string, config: any): Promise<ActiveReadingPlan> {
    const now = Date.now();
    const planId = generateId();
    
    const dbPlan: DBActiveReadingPlan = {
      id: planId,
      name,
      config: JSON.stringify(config),
      startedAt: now,
      currentDayNumber: 1
    };
    
    await writeTransaction('reading_plans', (store) => store.add(dbPlan));
    
    // Generate and store daily readings from config
    if (config.days) {
      for (const day of config.days) {
        const dbDay: DBReadingPlanDay = {
          id: `${planId}-${day.dayNumber}`,
          planId,
          dayNumber: day.dayNumber,
          date: day.date.getTime(),
          chapters: JSON.stringify(day.chapters),
          completed: 0
        };
        
        await writeTransaction('reading_plan_days', (store) => store.add(dbDay));
      }
    }
    
    return this.dbToPlan(dbPlan);
  }

  /**
   * Get the active reading plan (most recent uncompleted)
   */
  async getActiveReadingPlan(): Promise<ActiveReadingPlan | null> {
    const plans = await readTransaction<DBActiveReadingPlan[]>(
      'reading_plans',
      (store) => store.getAll()
    );
    
    const activePlans = plans.filter(p => !p.completedAt);
    if (activePlans.length === 0) return null;
    
    // Return most recent
    activePlans.sort((a, b) => b.startedAt - a.startedAt);
    return this.dbToPlan(activePlans[0]);
  }

  /**
   * Get a specific reading plan by ID
   */
  async getReadingPlan(planId: string): Promise<ActiveReadingPlan | null> {
    const plan = await readTransaction<DBActiveReadingPlan>(
      'reading_plans',
      (store) => store.get(planId)
    );
    
    return plan ? this.dbToPlan(plan) : null;
  }

  /**
   * Get all reading plans
   */
  async getAllReadingPlans(): Promise<ActiveReadingPlan[]> {
    const plans = await readTransaction<DBActiveReadingPlan[]>(
      'reading_plans',
      (store) => store.getAll()
    );
    
    return plans.map(p => this.dbToPlan(p));
  }

  /**
   * Mark a reading plan as completed
   */
  async completeReadingPlan(planId: string): Promise<void> {
    const plan = await readTransaction<DBActiveReadingPlan>(
      'reading_plans',
      (store) => store.get(planId)
    );
    
    if (plan) {
      plan.completedAt = Date.now();
      await writeTransaction('reading_plans', (store) => store.put(plan));
    }
  }

  /**
   * Delete a reading plan and all its days
   */
  async deleteReadingPlan(planId: string): Promise<void> {
    await writeTransaction('reading_plans', (store) => store.delete(planId));
    
    // Delete all days for this plan
    const days = await readTransaction<DBReadingPlanDay[]>(
      'reading_plan_days',
      (store) => {
        const index = store.index('planId');
        return index.getAll(planId);
      }
    );
    
    for (const day of days) {
      await writeTransaction('reading_plan_days', (store) => store.delete(day.id));
    }
  }

  // ===== Daily Reading Progress =====

  /**
   * Get reading assignment for a specific day
   */
  async getDayReading(planId: string, dayNumber: number): Promise<ReadingPlanDay | null> {
    const day = await readTransaction<DBReadingPlanDay | undefined>(
      'reading_plan_days',
      (store) => {
        const index = store.index('planId_dayNumber');
        return index.get([planId, dayNumber]);
      }
    );
    
    return day ? this.dbToDay(day) : null;
  }

  /**
   * Get all days for a reading plan
   */
  async getAllDayReadings(planId: string): Promise<ReadingPlanDay[]> {
    const days = await readTransaction<DBReadingPlanDay[]>(
      'reading_plan_days',
      (store) => {
        const index = store.index('planId');
        return index.getAll(planId);
      }
    );
    
    return days.map(d => this.dbToDay(d));
  }

  /**
   * Mark a day as completed
   */
  async completeDayReading(planId: string, dayNumber: number): Promise<void> {
    const day = await readTransaction<DBReadingPlanDay | undefined>(
      'reading_plan_days',
      (store) => {
        const index = store.index('planId_dayNumber');
        return index.get([planId, dayNumber]);
      }
    );
    
    if (day && !day.completed) {
      day.completed = 1;
      day.completedAt = Date.now();
      await writeTransaction('reading_plan_days', (store) => store.put(day));
      
      // Update plan's current day number
      const plan = await readTransaction<DBActiveReadingPlan>(
        'reading_plans',
        (store) => store.get(planId)
      );
      
      if (plan && plan.currentDayNumber === dayNumber) {
        plan.currentDayNumber = dayNumber + 1;
        await writeTransaction('reading_plans', (store) => store.put(plan));
      }
    }
  }

  /**
   * Get progress percentage for a reading plan
   */
  async getPlanProgress(planId: string): Promise<number> {
    const days = await readTransaction<DBReadingPlanDay[]>(
      'reading_plan_days',
      (store) => {
        const index = store.index('planId');
        return index.getAll(planId);
      }
    );
    
    if (days.length === 0) return 0;
    
    const completedDays = days.filter(d => d.completed === 1).length;
    return Math.round((completedDays / days.length) * 100);
  }

  /**
   * Get today's reading assignment from active plan
   */
  async getTodaysReading(): Promise<ReadingPlanDay | null> {
    const activePlan = await this.getActiveReadingPlan();
    if (!activePlan) return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();
    
    const days = await readTransaction<DBReadingPlanDay[]>(
      'reading_plan_days',
      (store) => {
        const index = store.index('planId');
        return index.getAll(activePlan.id);
      }
    );
    
    // Find day matching today's date
    const todayDay = days.find(d => {
      const dayDate = new Date(d.date);
      dayDate.setHours(0, 0, 0, 0);
      return dayDate.getTime() === todayTimestamp;
    });
    
    return todayDay ? this.dbToDay(todayDay) : null;
  }

  // ===== Helper Methods =====

  /**
   * Check if reading a chapter completes a plan day, and mark it complete
   */
  private async checkAndCompletePlanDay(planId: string, book: string, chapter: number): Promise<void> {
    const days = await readTransaction<DBReadingPlanDay[]>(
      'reading_plan_days',
      (store) => {
        const index = store.index('planId');
        return index.getAll(planId);
      }
    );
    
    for (const day of days) {
      if (day.completed) continue;
      
      const chapters = JSON.parse(day.chapters);
      const hasChapter = chapters.some((c: any) => c.book === book && c.chapter === chapter);
      
      if (hasChapter) {
        // Check if all chapters in this day are now read
        const allRead = await Promise.all(
          chapters.map((c: any) => this.hasRead(c.book, c.chapter, planId))
        );
        
        if (allRead.every(Boolean)) {
          await this.completeDayReading(planId, day.dayNumber);
        }
      }
    }
  }

  // ===== Conversion Helpers =====

  private dbToHistoryEntry(db: DBReadingHistoryEntry): ReadingHistoryEntry {
    return {
      id: db.id,
      book: db.book,
      chapter: db.chapter,
      readAt: new Date(db.readAt),
      planId: db.planId
    };
  }

  private dbToPlan(db: DBActiveReadingPlan): ActiveReadingPlan {
    return {
      id: db.id,
      name: db.name,
      config: JSON.parse(db.config),
      startedAt: new Date(db.startedAt),
      completedAt: db.completedAt ? new Date(db.completedAt) : undefined,
      currentDayNumber: db.currentDayNumber
    };
  }

  private dbToDay(db: DBReadingPlanDay): ReadingPlanDay {
    return {
      planId: db.planId,
      dayNumber: db.dayNumber,
      date: new Date(db.date),
      chapters: JSON.parse(db.chapters),
      completed: db.completed === 1,
      completedAt: db.completedAt ? new Date(db.completedAt) : undefined
    };
  }
}

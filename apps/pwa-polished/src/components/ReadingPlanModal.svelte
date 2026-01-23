<script lang="ts">
  import { onMount } from 'svelte';
  import { generateReadingPlan, BIBLE_BOOKS, type ReadingPlanConfig, type ReadingPlan } from '@projectbible/core';
  import { VERSE_COUNTS } from '../../../../packages/core/src/BibleMetadata';
  import { suggestCatchUp, getDaysAheadBehind, calculateStreak } from '../../../../packages/core/src/ReadingPlanEngine';
  import { navigationStore } from '../stores/navigationStore';
  import {
    readingProgressStore,
    getLatestChapterState,
    type ReadingProgressEntry,
  } from '../stores/ReadingProgressStore';
  import { planMetadataStore } from '../stores/PlanMetadataStore';
  import { syncOrchestrator, type SyncQueueStats } from '../services/SyncOrchestrator';
  import { userProfileStore } from '../stores/userProfileStore';
  
  export let isOpen = false;
  
  let currentTab: 'create' | 'active' | 'history' = 'create';
  let currentReadingPlan: ReadingPlan | null = null;
  let currentPlanId: string | null = null;
  
  // Storage keys
  const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan';
  const STORAGE_PLAN_HISTORY = 'projectbible_reading_plan_history';
  
  // Create plan form state
  let planPreset = '';
  let planStartDate = new Date().toISOString().split('T')[0];
  let planEndDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  let dayChecks = [true, true, true, true, true, true, true]; // Sun-Sat
  let selectedBooks = new Set(BIBLE_BOOKS.map(b => b.name));
  let ordering: 'canonical' | 'chronological' | 'shuffled' = 'canonical';
  let optDailyPsalm = false;
  let optRandomizePsalms = false;
  let optDailyProverb = false;
  let optRandomizeProverbs = false;
  let optReverseOrder = false;
  let optShowOverallStats = true;
  let optShowDailyStats = true;
  let planGenerationStatus = '';
  let planHistory: any[] = [];
  let viewMode: 'calendar' | 'list' | 'catchup' = 'calendar';
  let dayProgressMap = new Map<number, ReadingProgressEntry>();
  let lastLoadedPlanId: string | null = null;
  let catchUpMode: 'spread' | 'dedicated' = 'spread';
  let maxCatchUpPerDay = 3;
  let catchUpDays: Array<{ dayNumber: number; date: Date; chapters: Array<{ book: string; chapter: number }> }> = [];
  const CATCHUP_STORAGE_PREFIX = 'projectbible_catchup_days_';
  let showCatchUpDays = true;
  let verseStats = {
    total: 0,
    read: 0,
    remaining: 0,
    todayRead: 0,
  };
  let syncStatus = 'Not synced';
  let syncStats: SyncQueueStats = {
    pending: 0,
    processing: 0,
    failed: 0,
    done: 0,
    lastSyncedAt: null,
    lastError: null,
  };
  let syncError: string | null = null;
  let userName: string | null = null;
  
  // Derived book lists
  const OT_BOOKS = BIBLE_BOOKS.filter(b => b.testament === 'OT').map(b => b.name);
  const NT_BOOKS = BIBLE_BOOKS.filter(b => b.testament === 'NT').map(b => b.name);
  
  onMount(() => {
    loadActivePlan();
    loadPlanHistory();
    const unsubscribeSync = syncOrchestrator.subscribe((stats) => {
      syncStats = stats;
      syncError = stats.lastError;
      syncStatus = formatSyncStatus(stats);
    });
    const unsubscribeProfile = userProfileStore.subscribe((profile) => {
      userName = profile.name;
    });
    return () => {
      unsubscribeSync();
      unsubscribeProfile();
    };
  });

  $: if (currentReadingPlan) {
    dayProgressMap;
    verseStats = computeVerseStats();
  }

  $: if (currentReadingPlan && currentPlanId && currentPlanId !== lastLoadedPlanId) {
    loadProgressForPlan();
    loadCatchUpDays();
  }

  function formatSyncStatus(stats: SyncQueueStats): string {
    if (stats.processing > 0) {
      return stats.pending > 0
        ? `Auto-syncing (${stats.pending} queued)`
        : 'Auto-syncing...';
    }
    if (stats.failed > 0) {
      return `Sync failed (${stats.failed})`;
    }
    if (stats.pending > 0) {
      return `Queued (${stats.pending})`;
    }
    if (stats.lastSyncedAt) {
      const ageMs = Date.now() - stats.lastSyncedAt;
      if (ageMs < 30000) return 'Synced just now';
      return `Synced ${new Date(stats.lastSyncedAt).toLocaleTimeString()}`;
    }
    return 'Not synced';
  }

  
  function loadActivePlan() {
    try {
      const stored = localStorage.getItem(STORAGE_ACTIVE_PLAN);
      if (stored) {
        const data = JSON.parse(stored);
        currentReadingPlan = data.plan;
        currentPlanId = data.id;
        if (currentReadingPlan) {
          currentReadingPlan.config.startDate = new Date(currentReadingPlan.config.startDate);
          currentReadingPlan.config.endDate = new Date(currentReadingPlan.config.endDate);
          currentReadingPlan.days.forEach(day => {
            day.date = new Date(day.date);
          });
        }
      }
    } catch (e) {
      console.error('Error loading active plan:', e);
    }
  }
  
  function saveActivePlan() {
    if (currentReadingPlan && currentPlanId) {
      localStorage.setItem(STORAGE_ACTIVE_PLAN, JSON.stringify({
        id: currentPlanId,
        plan: currentReadingPlan
      }));
    }
  }
  
  function loadPlanHistory() {
    try {
      const historyStr = localStorage.getItem(STORAGE_PLAN_HISTORY);
      planHistory = historyStr ? JSON.parse(historyStr) : [];
    } catch (e) {
      console.error('Error loading plan history:', e);
      planHistory = [];
    }
  }

  function getVerseCountForChapter(bookName: string, chapter: number): number {
    return VERSE_COUNTS[bookName]?.[chapter - 1] ?? 0;
  }

  function isSameDate(timestamp: number, reference: Date): boolean {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime() === reference.getTime();
  }

  function computeVerseStats() {
    if (!currentReadingPlan) {
      return { total: 0, read: 0, remaining: 0, todayRead: 0 };
    }

    let total = 0;
    let read = 0;
    let todayRead = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    currentReadingPlan.days.forEach((day) => {
      const progress = getDayProgress(day.dayNumber);

      day.chapters.forEach((chapter: any) => {
        const verseCount = getVerseCountForChapter(chapter.book, chapter.chapter);
        total += verseCount;

        if (!progress) return;
        const chapterProgress = progress.chaptersRead.find(
          (item) => item.book === chapter.book && item.chapter === chapter.chapter,
        );
        if (!chapterProgress || chapterProgress.actions.length === 0) return;
        const latest = chapterProgress.actions[chapterProgress.actions.length - 1];
        if (latest.type === 'checked') {
          read += verseCount;
          if (isSameDate(latest.timestamp, today)) {
            todayRead += verseCount;
          }
        }
      });
    });

    return {
      total,
      read,
      remaining: Math.max(0, total - read),
      todayRead,
    };
  }

  function getOverdueDays() {
    if (!currentReadingPlan) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return currentReadingPlan.days.filter((day) => {
      const dayDate = new Date(day.date);
      dayDate.setHours(0, 0, 0, 0);
      const progress = getDayProgress(day.dayNumber);
      return dayDate < today && !progress?.completed;
    });
  }

  function getOverdueChapters() {
    return getOverdueDays().flatMap((day) => day.chapters);
  }

  function getEvenSpreadSuggestions() {
    if (!currentReadingPlan) return [];
    return suggestCatchUp(currentReadingPlan, getProgressEntries(), maxCatchUpPerDay);
  }

  function getDedicatedCatchUpDays() {
    const overdueChapters = getOverdueChapters();
    if (overdueChapters.length === 0) return [];

    const baseDayNumber = currentReadingPlan?.days?.[currentReadingPlan.days.length - 1]?.dayNumber ?? 0;
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const days: Array<{ dayNumber: number; date: Date; chapters: Array<{ book: string; chapter: number }> }> = [];
    let index = 0;
    let dayNumber = baseDayNumber + 1;

    while (index < overdueChapters.length) {
      const chunk = overdueChapters.slice(index, index + maxCatchUpPerDay);
      const date = new Date(startDate);
      date.setDate(date.getDate() + (dayNumber - baseDayNumber));
      days.push({
        dayNumber,
        date,
        chapters: chunk,
      });
      index += maxCatchUpPerDay;
      dayNumber += 1;
    }

    return days;
  }

  async function applyEvenSpread() {
    if (!currentPlanId) return;
    const suggestions = getEvenSpreadSuggestions();
    for (const suggestion of suggestions) {
      const existing = await readingProgressStore.getDayProgress(currentPlanId, suggestion.dayNumber);
      const entry = existing
        ? existing
        : await readingProgressStore.ensureDayProgress(
            currentPlanId,
            suggestion.dayNumber,
            currentReadingPlan?.days.find((day) => day.dayNumber === suggestion.dayNumber)?.chapters ?? [],
          );
      entry.catchUpAdjustment = {
        originalDayNumber: -1,
        addedChapters: suggestion.addedChapters,
      };
      await readingProgressStore.setCatchUpAdjustment(entry);
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(entry.dayNumber, entry);
    }
    await persistCatchUpAdjustment('spread', suggestions);
    await syncOrchestrator.enqueue(
      'catch-up-apply',
      { planId: currentPlanId, mode: 'spread', appliedAt: Date.now(), data: suggestions },
      1,
    );
  }

  function applyDedicatedCatchUp() {
    const days = getDedicatedCatchUpDays();
    saveCatchUpDays(days);
    if (currentPlanId) {
      void persistCatchUpAdjustment('dedicated', days);
      void syncOrchestrator.enqueue(
        'catch-up-apply',
        { planId: currentPlanId, mode: 'dedicated', appliedAt: Date.now(), data: days },
        1,
      );
    }
  }

  async function persistCatchUpAdjustment(mode: 'spread' | 'dedicated', data: any) {
    if (!currentPlanId) return;
    const existing = await planMetadataStore.getPlanMetadata(currentPlanId);
    if (!existing) return;
    await planMetadataStore.upsertPlanMetadata({
      ...existing,
      catchUpAdjustment: {
        mode,
        appliedAt: Date.now(),
        data,
      },
    });
  }

  async function loadProgressForPlan() {
    if (!currentPlanId) return;
    try {
      const entries = await readingProgressStore.getProgressForPlan(currentPlanId);
      dayProgressMap = new Map(entries.map((entry) => [entry.dayNumber, entry]));
      lastLoadedPlanId = currentPlanId;
    } catch (error) {
      console.error('Error loading reading progress:', error);
    }
  }

  function loadCatchUpDays() {
    if (!currentPlanId) return;
    const stored = localStorage.getItem(`${CATCHUP_STORAGE_PREFIX}${currentPlanId}`);
    if (!stored) {
      catchUpDays = [];
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Array<{ dayNumber: number; date: string; chapters: Array<{ book: string; chapter: number }> }>;
      catchUpDays = parsed.map((day) => ({
        ...day,
        date: new Date(day.date),
      }));
    } catch (error) {
      console.error('Error loading catch-up days:', error);
      catchUpDays = [];
    }
  }

  function saveCatchUpDays(days: Array<{ dayNumber: number; date: Date; chapters: Array<{ book: string; chapter: number }> }>) {
    if (!currentPlanId) return;
    const serialized = days.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date.toISOString(),
      chapters: day.chapters,
    }));
    localStorage.setItem(`${CATCHUP_STORAGE_PREFIX}${currentPlanId}`, JSON.stringify(serialized));
    catchUpDays = days;
  }

  function getDayProgress(dayNumber: number): ReadingProgressEntry | undefined {
    return dayProgressMap.get(dayNumber);
  }

  function getEffectiveChapters(day: any): Array<{ book: string; chapter: number }> {
    const baseChapters = day.chapters ?? [];
    const progress = getDayProgress(day.dayNumber);
    const adjustment = progress?.catchUpAdjustment?.addedChapters ?? [];
    return [...baseChapters, ...adjustment];
  }

  function getDisplayedDays() {
    if (!currentReadingPlan) return [];
    const baseDays = currentReadingPlan.days.map((day) => ({
      ...day,
      date: new Date(day.date),
      isCatchUp: false,
    }));

    const catchUpEntries = catchUpDays.map((day) => ({
      dayNumber: day.dayNumber,
      date: new Date(day.date),
      chapters: day.chapters,
      isCatchUp: true,
    }));

    const combined = [...baseDays, ...catchUpEntries].sort((a, b) => a.dayNumber - b.dayNumber);
    return showCatchUpDays ? combined : combined.filter((day) => !day.isCatchUp);
  }

  function getProgressEntries(): ReadingProgressEntry[] {
    return Array.from(dayProgressMap.values());
  }

  function isChapterChecked(progress: ReadingProgressEntry | undefined, book: string, chapter: number): boolean {
    const state = getLatestChapterState(progress, book, chapter);
    return state === 'checked';
  }

  function getDayProgressCounts(day: any) {
    const progress = getDayProgress(day.dayNumber);
    const effectiveChapters = getEffectiveChapters(day);
    const total = effectiveChapters.length;
    const checked = effectiveChapters.filter((chapter: any) =>
      isChapterChecked(progress, chapter.book, chapter.chapter)
    ).length;
    return { checked, total };
  }

  function getDayStatus(day: any): 'unread' | 'current' | 'completed' | 'ahead' | 'overdue' {
    const progress = getDayProgress(day.dayNumber);
    const dayDate = new Date(day.date);
    dayDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (progress?.completed) {
      return dayDate.getTime() > today.getTime() ? 'ahead' : 'completed';
    }
    if (dayDate.getTime() < today.getTime()) return 'overdue';
    if (dayDate.getTime() === today.getTime()) return 'current';
    return 'unread';
  }

  async function ensureStartedReading(day: any) {
    if (!currentPlanId) return;
    const effectiveChapters = getEffectiveChapters(day);
    const progress = await readingProgressStore.ensureDayProgress(
      currentPlanId,
      day.dayNumber,
      effectiveChapters,
    );
    if (!progress.startedReadingAt) {
      const startedAt = Date.now();
      await readingProgressStore.setStartedReadingAt(currentPlanId, day.dayNumber, startedAt);
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(day.dayNumber, { ...progress, startedReadingAt: startedAt });
    }
  }

  async function handleChapterClick(day: any, chapter: any) {
    await ensureStartedReading(day);
    navigateToChapter(chapter.book, chapter.chapter);
  }

  async function toggleChapter(day: any, chapter: any) {
    if (!currentPlanId) return;
    const effectiveChapters = getEffectiveChapters(day);
    const progress = getDayProgress(day.dayNumber);
    const wasCompleted = progress?.completed ?? false;
    const currentlyChecked = isChapterChecked(progress, chapter.book, chapter.chapter);
    const updated = await readingProgressStore.setChapterAction(
      currentPlanId,
      day.dayNumber,
      effectiveChapters,
      { book: chapter.book, chapter: chapter.chapter },
      currentlyChecked ? 'unchecked' : 'checked',
    );
    dayProgressMap = new Map(dayProgressMap);
    dayProgressMap.set(day.dayNumber, updated);

    if (updated.completed !== wasCompleted) {
      await syncOrchestrator.enqueue(
        updated.completed ? 'day-complete' : 'day-incomplete',
        {
          planId: currentPlanId,
          dayNumber: day.dayNumber,
          completed: updated.completed,
          completedAt: updated.completedAt,
          chaptersRead: updated.chaptersRead,
        },
        1,
      );
    } else {
      await syncOrchestrator.enqueue(
        'chapter-toggle',
        {
          planId: currentPlanId,
          dayNumber: day.dayNumber,
          chapter: { book: chapter.book, chapter: chapter.chapter },
          action: currentlyChecked ? 'unchecked' : 'checked',
          timestamp: Date.now(),
        },
        5,
      );
    }
  }

  async function markDayComplete(day: any) {
    if (!currentPlanId) return;
    const effectiveChapters = getEffectiveChapters(day);
    const updated = await readingProgressStore.markDayComplete(
      currentPlanId,
      day.dayNumber,
      effectiveChapters,
    );
    dayProgressMap = new Map(dayProgressMap);
    dayProgressMap.set(day.dayNumber, updated);
    await syncOrchestrator.enqueue(
      'day-complete',
      {
        planId: currentPlanId,
        dayNumber: day.dayNumber,
        completed: true,
        completedAt: updated.completedAt,
        chaptersRead: updated.chaptersRead,
      },
      1,
    );
  }

  async function syncNow() {
    if (!currentPlanId) return;
    try {
      syncStatus = 'Syncing...';
      await syncOrchestrator.runImmediateSync(currentPlanId, 'manual');
      await syncOrchestrator.processQueue();
      syncStatus = `Synced ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      console.error('Sync failed:', error);
      syncStatus = 'Sync failed';
    }
  }


  function getCompletionTimeline() {
    if (!currentReadingPlan) return [];
    return currentReadingPlan.days.map((day) => {
      const progress = getDayProgress(day.dayNumber);
      return {
        dayNumber: day.dayNumber,
        date: new Date(day.date).toISOString(),
        completedAt: progress?.completedAt ? new Date(progress.completedAt).toISOString() : null,
      };
    });
  }

  function exportProgressJson() {
    if (!currentReadingPlan || !currentPlanId) return;
    const payload = {
      planId: currentPlanId,
      generatedAt: new Date().toISOString(),
      totalDays: currentReadingPlan.totalDays,
      totalChapters: currentReadingPlan.totalChapters,
      verseStats,
      timeline: getCompletionTimeline(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reading-plan-${currentPlanId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportProgressMarkdown() {
    if (!currentReadingPlan || !currentPlanId) return;
    const lines: string[] = [];
    lines.push(`# Reading Plan Report`);
    lines.push('');
    lines.push(`Plan ID: ${currentPlanId}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push(`- Total Days: ${currentReadingPlan.totalDays}`);
    lines.push(`- Total Chapters: ${currentReadingPlan.totalChapters}`);
    lines.push(`- Verses Read: ${verseStats.read}`);
    lines.push(`- Verses Remaining: ${verseStats.remaining}`);
    lines.push(`- Percent Complete: ${verseStats.total > 0 ? Math.round((verseStats.read / verseStats.total) * 100) : 0}%`);
    lines.push('');
    lines.push('## Completion Timeline');
    lines.push('| Day | Scheduled Date | Completed At |');
    lines.push('| --- | -------------- | ------------ |');
    getCompletionTimeline().forEach((entry) => {
      lines.push(`| ${entry.dayNumber} | ${new Date(entry.date).toLocaleDateString()} | ${entry.completedAt ? new Date(entry.completedAt).toLocaleDateString() : '—'} |`);
    });
    lines.push('');

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reading-plan-${currentPlanId}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  
  function savePlanToHistory(plan: ReadingPlan, planId: string) {
    try {
      planHistory.unshift({
        id: planId,
        plan,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
      if (planHistory.length > 10) {
        planHistory = planHistory.slice(0, 10);
      }
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
    } catch (e) {
      console.error('Error saving plan to history:', e);
    }
  }
  
  function deleteCurrentPlan() {
    if (confirm('Are you sure you want to delete the current reading plan?')) {
      localStorage.removeItem(STORAGE_ACTIVE_PLAN);
      currentReadingPlan = null;
      currentPlanId = null;
      dayProgressMap = new Map();
      lastLoadedPlanId = null;
    }
  }
  
  function deletePlanFromHistory(planId: string) {
    if (confirm('Are you sure you want to delete this plan from history?')) {
      planHistory = planHistory.filter(p => p.id !== planId);
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
    }
  }
  
  function selectAllBooks() {
    selectedBooks = new Set(BIBLE_BOOKS.map(b => b.name));
  }
  
  function selectNone() {
    selectedBooks = new Set();
  }
  
  function selectOT() {
    selectedBooks = new Set(OT_BOOKS);
  }
  
  function selectNT() {
    selectedBooks = new Set(NT_BOOKS);
  }
  
  function toggleBook(bookName: string) {
    if (selectedBooks.has(bookName)) {
      selectedBooks.delete(bookName);
    } else {
      selectedBooks.add(bookName);
    }
    selectedBooks = selectedBooks;
  }
  
  async function generatePlan() {
    planGenerationStatus = 'Generating plan...';
    
    try {
      const config: ReadingPlanConfig = planPreset === '' 
        ? buildCustomPlanConfig() 
        : buildPresetPlanConfig(planPreset);
      
      planGenerationStatus = 'Calculating reading schedule...';
      currentReadingPlan = generateReadingPlan(config);
      currentPlanId = `plan_${Date.now()}`;
      
      saveActivePlan();
      savePlanToHistory(currentReadingPlan, currentPlanId);
      
      planGenerationStatus = `✓ Plan created! ${currentReadingPlan.totalDays} days, ${currentReadingPlan.totalChapters} chapters`;
      
      setTimeout(() => {
        currentTab = 'active';
      }, 1000);
      
    } catch (error) {
      planGenerationStatus = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  
  function buildCustomPlanConfig(): ReadingPlanConfig {
    const startDate = new Date(planStartDate);
    const endDate = new Date(planEndDate);
    
    const excludedWeekdays: number[] = [];
    dayChecks.forEach((checked, i) => {
      if (!checked) excludedWeekdays.push(i);
    });
    
    const books = Array.from(selectedBooks).map(book => ({ book }));
    
    if (books.length === 0) {
      throw new Error('Please select at least one book');
    }
    
    return {
      startDate,
      endDate,
      excludedWeekdays: excludedWeekdays.length > 0 ? excludedWeekdays : undefined,
      books,
      ordering,
      dailyPsalm: optDailyPsalm,
      randomizePsalms: optRandomizePsalms,
      dailyProverb: optDailyProverb,
      randomizeProverbs: optRandomizeProverbs,
      reverseOrder: optReverseOrder,
      showOverallStats: optShowOverallStats,
      showDailyStats: optShowDailyStats
    };
  }
  
  function buildPresetPlanConfig(preset: string): ReadingPlanConfig {
    const today = new Date();
    const oneYearLater = new Date(today);
    oneYearLater.setFullYear(today.getFullYear() + 1);
    
    const ninetyDaysLater = new Date(today);
    ninetyDaysLater.setDate(today.getDate() + 90);
    
    const thirtyDaysLater = new Date(today);
    thirtyDaysLater.setDate(today.getDate() + 30);
    
    switch (preset) {
      case 'bible-1-year':
        return {
          startDate: today,
          endDate: oneYearLater,
          books: BIBLE_BOOKS.map(b => ({ book: b.name })),
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'nt-90-days':
        return {
          startDate: today,
          endDate: ninetyDaysLater,
          books: BIBLE_BOOKS.filter(b => b.testament === 'NT').map(b => ({ book: b.name })),
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'gospels-30-days':
        return {
          startDate: today,
          endDate: thirtyDaysLater,
          books: ['Matthew', 'Mark', 'Luke', 'John'].map(book => ({ book })),
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'chronological-1-year':
        return {
          startDate: today,
          endDate: oneYearLater,
          books: BIBLE_BOOKS.map(b => ({ book: b.name })),
          ordering: 'chronological',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'psalms-proverbs':
        return {
          startDate: today,
          endDate: new Date(today.getTime() + 150 * 24 * 60 * 60 * 1000),
          books: [{ book: 'Psalms' }, { book: 'Proverbs' }],
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      default:
        throw new Error('Unknown preset: ' + preset);
    }
  }
  
  function getTodayReading() {
    if (!currentReadingPlan) return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return currentReadingPlan.days.find(day => {
      const dayDate = new Date(day.date);
      dayDate.setHours(0, 0, 0, 0);
      return dayDate.getTime() === today.getTime();
    });
  }
  
  function navigateToChapter(book: string, chapter: number) {
    navigationStore.setBook(book);
    navigationStore.setChapter(chapter);
    isOpen = false;
  }
  
  function close() {
    isOpen = false;
  }
  
  $: todayReading = getTodayReading();
</script>

{#if isOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={close}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2><span class="emoji">📖</span> {userName ? `${userName}'s Reading Plan` : 'Reading Plan'}</h2>
        <button class="close-btn" on:click={close}>&times;</button>
      </div>
      
      <div class="tabs">
        <button 
          class="tab" 
          class:active={currentTab === 'create'}
          on:click={() => currentTab = 'create'}
        >
          Create Plan
        </button>
        <button 
          class="tab" 
          class:active={currentTab === 'active'}
          on:click={() => currentTab = 'active'}
        >
          Active Plan
        </button>
        <button 
          class="tab" 
          class:active={currentTab === 'history'}
          on:click={() => { currentTab = 'history'; loadPlanHistory(); }}
        >
          History
        </button>
      </div>
      
      <div class="tab-content">
        {#if currentTab === 'create'}
          <div class="create-plan-tab">
            <div class="form-group">
              <label for="preset">Preset Plan:</label>
              <select id="preset" bind:value={planPreset}>
                <option value="">Custom...</option>
                <option value="bible-1-year">Bible in 1 Year</option>
                <option value="nt-90-days">New Testament in 90 Days</option>
                <option value="gospels-30-days">Gospels in 30 Days</option>
                <option value="chronological-1-year">Chronological Bible in 1 Year</option>
                <option value="psalms-proverbs">Psalms & Proverbs</option>
              </select>
            </div>
            
            {#if planPreset === ''}
              <div class="custom-options">
                <h3>Date Range</h3>
                <div class="form-group">
                  <label for="startDate">Start Date:</label>
                  <input type="date" id="startDate" bind:value={planStartDate} />
                </div>
                <div class="form-group">
                  <label for="endDate">End Date:</label>
                  <input type="date" id="endDate" bind:value={planEndDate} />
                </div>
                
                <h3>Reading Days</h3>
                <div class="days-grid">
                  <label><input type="checkbox" bind:checked={dayChecks[0]} /> Sunday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[1]} /> Monday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[2]} /> Tuesday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[3]} /> Wednesday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[4]} /> Thursday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[5]} /> Friday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[6]} /> Saturday</label>
                </div>
                
                <h3>Book Selection</h3>
                <div class="book-buttons">
                  <button on:click={selectAllBooks}>Select All</button>
                  <button on:click={selectNone}>Select None</button>
                  <button on:click={selectOT}>OT Only</button>
                  <button on:click={selectNT}>NT Only</button>
                </div>
                <div class="book-grid">
                  {#each BIBLE_BOOKS as book}
                    <label>
                      <input 
                        type="checkbox" 
                        checked={selectedBooks.has(book.name)}
                        on:change={() => toggleBook(book.name)}
                      />
                      {book.name}
                    </label>
                  {/each}
                </div>
                
                <h3>Reading Order</h3>
                <div class="radio-group">
                  <label><input type="radio" bind:group={ordering} value="canonical" /> Canonical (Traditional)</label>
                  <label><input type="radio" bind:group={ordering} value="chronological" /> Chronological (Historical Order)</label>
                  <label><input type="radio" bind:group={ordering} value="shuffled" /> Shuffled (Random)</label>
                </div>
                
                <h3>Advanced Options</h3>
                <div class="options-group">
                  <label>
                    <input type="checkbox" bind:checked={optDailyPsalm} />
                    Add one Psalm per day
                    {#if optDailyPsalm}
                      <div class="sub-option">
                        <label><input type="checkbox" bind:checked={optRandomizePsalms} /> Randomize Psalms?</label>
                      </div>
                    {/if}
                  </label>
                  <label>
                    <input type="checkbox" bind:checked={optDailyProverb} />
                    Add one Proverb per day
                    {#if optDailyProverb}
                      <div class="sub-option">
                        <label><input type="checkbox" bind:checked={optRandomizeProverbs} /> Randomize Proverbs?</label>
                      </div>
                    {/if}
                  </label>
                  <label><input type="checkbox" bind:checked={optReverseOrder} /> Reverse Order</label>
                  <label><input type="checkbox" bind:checked={optShowOverallStats} /> Show Overall Statistics</label>
                  <label><input type="checkbox" bind:checked={optShowDailyStats} /> Show Daily Statistics</label>
                </div>
              </div>
            {/if}
            
            <button class="generate-btn" on:click={generatePlan}>Generate Plan</button>
            {#if planGenerationStatus}
              <div class="status">{planGenerationStatus}</div>
            {/if}
          </div>
        {:else if currentTab === 'active'}
          <div class="active-plan-tab">
            {#if currentReadingPlan}
              <div class="plan-overview">
                <div class="overview-header">
                  <h3><span class="emoji">📊</span> Plan Overview</h3>
                  <button class="delete-btn" on:click={deleteCurrentPlan}><span class="emoji">🗑️</span> Delete Plan</button>
                </div>
                <div class="stats-grid">
                  <div><strong>Total Days:</strong> {currentReadingPlan.totalDays}</div>
                  <div><strong>Total Chapters:</strong> {currentReadingPlan.totalChapters}</div>
                  <div><strong>Avg/Day:</strong> {currentReadingPlan.avgChaptersPerDay.toFixed(1)} chapters</div>
                  <div><strong>Start:</strong> {new Date(currentReadingPlan.config.startDate).toLocaleDateString()}</div>
                  <div><strong>End:</strong> {new Date(currentReadingPlan.config.endDate).toLocaleDateString()}</div>
                </div>
              </div>
              
              {#if todayReading}
                <div class="today-reading">
                  <h3><span class="emoji">📖</span> Today's Reading (Day {todayReading.dayNumber})</h3>
                  <p class="chapters-list">
                    {#each todayReading.chapters as chapter, i}
                      <button 
                        class="chapter-link" 
                        on:click={() => handleChapterClick(todayReading, chapter)}
                      >
                        {chapter.book} {chapter.chapter}
                      </button>{#if i < todayReading.chapters.length - 1}, {/if}
                    {/each}
                  </p>
                  <p class="chapter-count">{todayReading.chapters.length} chapters</p>
                  <button 
                    class="start-reading-btn" 
                    on:click={() => handleChapterClick(todayReading, todayReading.chapters[0])}
                  >
                    Start Reading →
                  </button>
                </div>
              {:else}
                <div class="no-reading">
                  <p>Today is not a reading day in this plan.</p>
                </div>
              {/if}

              <div class="plan-progress">
                <div class="progress-header">
                  <h3>Progress</h3>
                  <span class="progress-percent">
                    {verseStats.total > 0 ? Math.round((verseStats.read / verseStats.total) * 100) : 0}%
                  </span>
                </div>
                <div class="progress-bar">
                  <div
                    class="progress-fill"
                    style={`width: ${verseStats.total > 0 ? (verseStats.read / verseStats.total) * 100 : 0}%`}
                  ></div>
                </div>
                <div class="progress-stats">
                  <div><strong>Verses read today:</strong> {verseStats.todayRead}</div>
                  <div><strong>Total verses read:</strong> {verseStats.read}</div>
                  <div><strong>Verses remaining:</strong> {verseStats.remaining}</div>
                  <div><strong>Days ahead/behind:</strong> {currentReadingPlan ? getDaysAheadBehind(currentReadingPlan, getProgressEntries()) : 0}</div>
                  <div><strong>Streak:</strong> {calculateStreak(getProgressEntries())} days</div>
                </div>
                {#if userName}
                  <div class="progress-message">Congrats {userName}, today you read {verseStats.todayRead} verses!</div>
                {/if}
                <div class="progress-actions">
                  <button class="export-btn" on:click={exportProgressJson}>Export JSON</button>
                  <button class="export-btn" on:click={exportProgressMarkdown}>Export Markdown</button>
                  <button class="export-btn" on:click={syncNow}>Sync Now</button>
                  <span class="sync-status">{syncStatus}</span>
                </div>
                {#if syncStats.failed > 0}
                  <div class="sync-actions">
                    <button class="export-btn" on:click={() => syncOrchestrator.retryFailed()}>
                      Retry failed
                    </button>
                  </div>
                {/if}
                {#if syncError}
                  <div class="sync-error">{syncError}</div>
                {/if}
              </div>
              
              <div class="view-toggle">
                <button 
                  class:active={viewMode === 'calendar'}
                  on:click={() => viewMode = 'calendar'}
                >
                  Calendar View
                </button>
                <button 
                  class:active={viewMode === 'list'}
                  on:click={() => viewMode = 'list'}
                >
                  List View
                </button>
                <button
                  class:active={viewMode === 'catchup'}
                  on:click={() => viewMode = 'catchup'}
                >
                  Catch-up
                </button>
                <label class="catchup-toggle">
                  <input type="checkbox" bind:checked={showCatchUpDays} />
                  Show catch-up days
                </label>
              </div>
              
              {#if viewMode === 'calendar'}
                <div class="calendar-view">
                  {#each getDisplayedDays().slice(0, 30) as day}
                    <div
                      class="day-card"
                      class:today={todayReading && day.dayNumber === todayReading.dayNumber}
                      class:status-unread={getDayStatus(day) === 'unread'}
                      class:status-current={getDayStatus(day) === 'current'}
                      class:status-completed={getDayStatus(day) === 'completed'}
                      class:status-ahead={getDayStatus(day) === 'ahead'}
                      class:status-overdue={getDayStatus(day) === 'overdue'}
                      class:catchup-day={day.isCatchUp}
                    >
                      <div class="day-header">
                        <strong>{day.isCatchUp ? 'Catch-up Day' : 'Day'} {day.dayNumber}</strong>
                        <span class="day-date">{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {#if day.isCatchUp}
                          <span class="catchup-badge">Catch-up</span>
                        {/if}
                        <span class="day-progress">
                          {getDayProgressCounts(day).checked}/{getDayProgressCounts(day).total}
                        </span>
                      </div>
                      <div class="day-chapters">
                        {#each day.chapters as chapter}
                          <div class="chapter-row">
                            <label class="chapter-checkbox">
                              <input
                                type="checkbox"
                                checked={isChapterChecked(getDayProgress(day.dayNumber), chapter.book, chapter.chapter)}
                                on:change={() => toggleChapter(day, chapter)}
                              />
                              <button
                                class="chapter-link"
                                on:click={() => handleChapterClick(day, chapter)}
                              >
                                {chapter.book} {chapter.chapter}
                              </button>
                            </label>
                          </div>
                        {/each}
                      </div>
                      <button class="mark-day-btn" on:click={() => markDayComplete(day)}>
                        Mark Day Complete
                      </button>
                    </div>
                  {/each}
                </div>
              {:else if viewMode === 'list'}
                <div class="list-view">
                  {#each getDisplayedDays() as day}
                    <div
                      class="list-day"
                      class:today={todayReading && day.dayNumber === todayReading.dayNumber}
                      class:status-unread={getDayStatus(day) === 'unread'}
                      class:status-current={getDayStatus(day) === 'current'}
                      class:status-completed={getDayStatus(day) === 'completed'}
                      class:status-ahead={getDayStatus(day) === 'ahead'}
                      class:status-overdue={getDayStatus(day) === 'overdue'}
                      class:catchup-day={day.isCatchUp}
                    >
                      <div class="list-day-header">
                        <strong>{day.isCatchUp ? 'Catch-up Day' : 'Day'} {day.dayNumber}</strong> - {new Date(day.date).toLocaleDateString()}
                        {#if day.isCatchUp}
                          <span class="catchup-badge">Catch-up</span>
                        {/if}
                        <span class="day-progress">
                          {getDayProgressCounts(day).checked}/{getDayProgressCounts(day).total}
                        </span>
                      </div>
                      <div class="list-day-chapters">
                        {#each day.chapters as chapter, i}
                          <label class="chapter-checkbox">
                            <input
                              type="checkbox"
                              checked={isChapterChecked(getDayProgress(day.dayNumber), chapter.book, chapter.chapter)}
                              on:change={() => toggleChapter(day, chapter)}
                            />
                            <button
                              class="chapter-link"
                              on:click={() => handleChapterClick(day, chapter)}
                            >
                              {chapter.book} {chapter.chapter}
                            </button>
                          </label>
                          {#if i < day.chapters.length - 1}
                            <span class="chapter-separator">,</span>
                          {/if}
                        {/each}
                      </div>
                      <button class="mark-day-btn" on:click={() => markDayComplete(day)}>
                        Mark Day Complete
                      </button>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="catchup-view">
                  <div class="catchup-summary">
                    <div><strong>Overdue days:</strong> {getOverdueDays().length}</div>
                    <div><strong>Overdue chapters:</strong> {getOverdueChapters().length}</div>
                    <div><strong>Max per day:</strong> {maxCatchUpPerDay}</div>
                  </div>

                  <div class="catchup-controls">
                    <label>
                      Catch-up Mode
                      <select bind:value={catchUpMode}>
                        <option value="spread">Even spread</option>
                        <option value="dedicated">Dedicated catch-up days</option>
                      </select>
                    </label>
                    <label>
                      Max chapters per day
                      <input type="number" min="1" max="10" bind:value={maxCatchUpPerDay} />
                    </label>
                  </div>

                  {#if catchUpMode === 'spread'}
                    <div class="catchup-preview">
                      <h4>Even spread preview</h4>
                      {#if getEvenSpreadSuggestions().length === 0}
                        <p class="muted">No catch-up needed. You are on schedule.</p>
                      {:else}
                        {#each getEvenSpreadSuggestions() as suggestion}
                          <div class="catchup-item">
                            <strong>Day {suggestion.dayNumber}:</strong>
                            {#each suggestion.addedChapters as chapter, i}
                              <span>{chapter.book} {chapter.chapter}</span>{#if i < suggestion.addedChapters.length - 1}, {/if}
                            {/each}
                          </div>
                        {/each}
                        <button class="apply-catchup" on:click={applyEvenSpread}>
                          Apply even spread
                        </button>
                      {/if}
                    </div>
                  {:else}
                    <div class="catchup-preview">
                      <h4>Dedicated catch-up days</h4>
                      {#if getDedicatedCatchUpDays().length === 0}
                        <p class="muted">No catch-up needed. You are on schedule.</p>
                      {:else}
                        {#each getDedicatedCatchUpDays() as day}
                          <div class="catchup-item">
                            <strong>Catch-up Day {day.dayNumber}:</strong>
                            {#each day.chapters as chapter, i}
                              <span>{chapter.book} {chapter.chapter}</span>{#if i < day.chapters.length - 1}, {/if}
                            {/each}
                          </div>
                        {/each}
                        <button class="apply-catchup" on:click={applyDedicatedCatchUp}>
                          Save catch-up days
                        </button>
                      {/if}
                    </div>

                    {#if catchUpDays.length > 0}
                      <div class="catchup-saved">
                        <h4>Saved catch-up days</h4>
                        {#each catchUpDays as day}
                          <div class="catchup-item">
                            <strong>Catch-up Day {day.dayNumber}:</strong>
                            {#each day.chapters as chapter, i}
                              <span>{chapter.book} {chapter.chapter}</span>{#if i < day.chapters.length - 1}, {/if}
                            {/each}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                </div>
              {/if}
            {:else}
              <p>No active plan. Create one to get started!</p>
            {/if}
          </div>
        {:else}
          <div class="history-tab">
            {#if planHistory.length > 0}
              {#each planHistory as item}
                <div class="history-item">
                  <div class="history-header">
                    <div>
                      <div class="history-title">
                        {item.plan.config.ordering.charAt(0).toUpperCase() + item.plan.config.ordering.slice(1)} Plan
                      </div>
                      <div class="history-date">Created {new Date(item.createdAt).toLocaleDateString()}</div>
                    </div>
                    <button class="delete-btn" on:click={() => deletePlanFromHistory(item.id)}>Delete</button>
                  </div>
                  <div class="history-stats">
                    <strong>{item.plan.totalDays}</strong> days • <strong>{item.plan.totalChapters}</strong> chapters
                  </div>
                  <div class="history-dates">
                    {new Date(item.plan.config.startDate).toLocaleDateString()} → {new Date(item.plan.config.endDate).toLocaleDateString()}
                  </div>
                </div>
              {/each}
            {:else}
              <p>No past plans yet.</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  
  .modal-content {
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 12px;
    max-width: 800px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 2px solid #3a3a3a;
  }
  
  .modal-header h2 {
    margin: 0;
    font-size: 24px;
    color: #e0e0e0;
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 28px;
    cursor: pointer;
    color: #888;
    padding: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    background: #2a2a2a;
    color: #e0e0e0;
  }
  
  .tabs {
    display: flex;
    border-bottom: 2px solid #3a3a3a;
    padding: 0 20px;
    background: #0f0f0f;
  }
  
  .tab {
    padding: 12px 20px;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: #888;
    transition: all 0.2s;
  }
  
  .tab:hover {
    color: #aaa;
    background: #1a1a1a;
  }
  
  .tab.active {
    color: #4caf50;
    border-bottom-color: #4caf50;
    background: #1a1a1a;
  }
  
  .tab-content {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }
  
  .form-group {
    margin-bottom: 15px;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: 600;
    color: #e0e0e0;
  }
  
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 8px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    font-size: 14px;
    background: #0f0f0f;
    color: #e0e0e0;
  }
  
  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #4caf50;
  }
  
  h3 {
    font-size: 16px;
    margin: 20px 0 10px 0;
    color: #e0e0e0;
  }
  
  .days-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 15px;
  }
  
  .days-grid label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #ccc;
  }
  
  .book-buttons {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
  }
  
  .book-buttons button {
    padding: 6px 12px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    background: #2a2a2a;
    color: #e0e0e0;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .book-buttons button:hover {
    background: #3a3a3a;
    border-color: #4a4a4a;
  }
  
  .book-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    max-height: 300px;
    overflow-y: auto;
    padding: 10px;
    background: #0f0f0f;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    margin-bottom: 15px;
  }
  
  .book-grid label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    color: #ccc;
  }
  
  .book-grid input[type="checkbox"] {
    width: auto;
  }
  
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 15px;
  }
  
  .radio-group label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #ccc;
  }
  
  .options-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .options-group label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #ccc;
  }
  
  .sub-option {
    margin-left: 25px;
    margin-top: 5px;
  }
  
  .generate-btn {
    padding: 12px 24px;
    background: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    margin-top: 20px;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
  }
  
  .generate-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
  }
  
  .status {
    margin-top: 10px;
    padding: 10px;
    border-radius: 4px;
    background: #2a2a2a;
    color: #e0e0e0;
    border: 1px solid #3a3a3a;
  }
  
  .plan-overview {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 20px;
  }
  
  .overview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  
  .overview-header h3 {
    margin: 0;
  }
  
  .delete-btn {
    padding: 6px 12px;
    background: linear-gradient(135deg, #ef5350 0%, #c62828 100%);
    color: #fff;
    border: 1px solid #ef5350;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    box-shadow: 0 2px 6px rgba(239, 83, 80, 0.3);
  }
  
  .delete-btn:hover {
    background: linear-gradient(135deg, #ff6f60 0%, #d32f2f 100%);
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    font-size: 14px;
    color: #ccc;
  }
  
  .today-reading {
    background: #1a2e1a;
    border: 1px solid #2e5d2e;
    padding: 15px;
    border-radius: 8px;
    border-left: 4px solid #4caf50;
    margin-bottom: 20px;
  }
  
  .today-reading h3 {
    margin: 0 0 10px 0;
    color: #8bc34a;
  }
  
  .chapters-list {
    margin: 5px 0;
    font-size: 15px;
    color: #aed581;
  }
  
  .chapter-link {
    background: none;
    border: none;
    color: #4caf50;
    font-weight: 500;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
  
  .chapter-link:hover {
    color: #66bb6a;
  }
  
  .chapter-count {
    margin: 5px 0;
    font-size: 13px;
    color: #9ccc65;
  }
  
  .start-reading-btn {
    margin-top: 10px;
    padding: 8px 16px;
    background: #4caf50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .start-reading-btn:hover {
    background: #66bb6a;
  }
  
  .no-reading {
    padding: 15px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    margin-bottom: 20px;
    color: #888;
  }

  .plan-progress {
    background: #1f1f1f;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 20px;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .progress-header h3 {
    margin: 0;
    font-size: 16px;
    color: #e0e0e0;
  }

  .progress-percent {
    font-size: 14px;
    color: #8bc34a;
    font-weight: 600;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: #2a2a2a;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4caf50, #8bc34a);
    transition: width 0.3s ease;
  }

  .progress-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
    font-size: 13px;
    color: #bbb;
  }

  .progress-actions {
    margin-top: 12px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .export-btn {
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid #3a3a3a;
    background: #1f1f1f;
    color: #e0e0e0;
    cursor: pointer;
    font-size: 12px;
  }

  .export-btn:hover {
    background: #2a2a2a;
  }

  .sync-status {
    font-size: 12px;
    color: #9ccc65;
    align-self: center;
  }

  .sync-actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
  }

  .sync-error {
    margin-top: 6px;
    font-size: 12px;
    color: #e57373;
  }

  .progress-message {
    margin-top: 8px;
    font-size: 12px;
    color: #c8e6c9;
  }
  
  .view-toggle {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }
  
  .view-toggle button {
    padding: 8px 16px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    background: #2a2a2a;
    color: #ccc;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .view-toggle button:hover {
    background: #3a3a3a;
  }
  
  .view-toggle button.active {
    background: #4caf50;
    color: white;
    border-color: #4caf50;
  }

  .catchup-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #bbb;
    padding: 6px 10px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    background: #1f1f1f;
  }

  .catchup-toggle input {
    accent-color: #ffc107;
  }

  .catchup-badge {
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 10px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: #111;
    background: #ffc107;
  }

  .catchup-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .catchup-summary {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    background: #1f1f1f;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 12px;
    font-size: 13px;
    color: #ccc;
  }

  .catchup-controls {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .catchup-controls label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: #ccc;
  }

  .catchup-controls select,
  .catchup-controls input {
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid #3a3a3a;
    background: #1a1a1a;
    color: #e0e0e0;
  }

  .catchup-preview,
  .catchup-saved {
    background: #1f1f1f;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 12px;
  }

  .catchup-preview h4,
  .catchup-saved h4 {
    margin: 0 0 10px 0;
    color: #e0e0e0;
  }

  .catchup-item {
    font-size: 13px;
    color: #ccc;
    margin-bottom: 6px;
  }

  .apply-catchup {
    margin-top: 10px;
    padding: 8px 14px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #e0e0e0;
    cursor: pointer;
  }

  .apply-catchup:hover {
    background: #3a3a3a;
  }

  .muted {
    color: #888;
    margin: 0;
  }
  
  .calendar-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 15px;
  }
  
  .day-card {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 12px;
    transition: all 0.2s;
  }

  .day-card.status-unread {
    background: #2a2a2a;
  }

  .day-card.status-current {
    background: #1a3d1a;
    border-left: 4px solid #4caf50;
  }

  .day-card.status-completed {
    background: #1a2a1a;
    border-left: 4px solid #8bc34a;
  }

  .day-card.status-ahead {
    background: #2a2010;
    border-left: 4px solid #ffc107;
  }

  .day-card.status-overdue {
    background: #2a1a1a;
    border-left: 4px solid #d32f2f;
  }

  .day-card.catchup-day {
    border-style: dashed;
  }
  
  .day-card:hover {
    border-color: #4a4a4a;
  }
  
  .day-card.today {
    border-color: #4caf50;
    background: #1a2e1a;
  }
  
  .day-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #3a3a3a;
    color: #e0e0e0;
  }

  .day-progress {
    font-size: 12px;
    color: #bbb;
  }
  
  .day-date {
    font-size: 12px;
    color: #888;
  }
  
  .day-chapters {
    font-size: 13px;
    color: #ccc;
  }
  
  .chapter-row {
    margin: 4px 0;
  }

  .chapter-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .chapter-checkbox input {
    accent-color: #4caf50;
    width: 14px;
    height: 14px;
  }

  .mark-day-btn {
    margin-top: 10px;
    padding: 6px 10px;
    border: 1px solid #3a3a3a;
    background: #1f1f1f;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .mark-day-btn:hover {
    background: #2a2a2a;
  }
  
  .list-view {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .list-day {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    padding: 12px;
    border-radius: 8px;
    border-left: 3px solid transparent;
  }

  .list-day.status-unread {
    background: #2a2a2a;
  }

  .list-day.status-current {
    background: #1a3d1a;
    border-left-color: #4caf50;
  }

  .list-day.status-completed {
    background: #1a2a1a;
    border-left-color: #8bc34a;
  }

  .list-day.status-ahead {
    background: #2a2010;
    border-left-color: #ffc107;
  }

  .list-day.status-overdue {
    background: #2a1a1a;
    border-left-color: #d32f2f;
  }

  .list-day.catchup-day {
    border-style: dashed;
  }
  
  .list-day.today {
    border-left-color: #4caf50;
    background: #1a2e1a;
  }
  
  .list-day-header {
    font-weight: 600;
    margin-bottom: 5px;
    color: #e0e0e0;
  }
  
  .list-day-chapters {
    font-size: 14px;
    color: #aaa;
  }

  .chapter-separator {
    margin: 0 6px;
    color: #555;
  }
  
  .history-item {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 15px;
    transition: all 0.2s;
  }
  
  .history-item:hover {
    border-color: #4a4a4a;
  }
  
  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10px;
  }
  
  .history-title {
    font-weight: 600;
    margin-bottom: 5px;
    color: #e0e0e0;
  }
  
  .history-date {
    font-size: 13px;
    color: #888;
  }
  
  .history-stats {
    font-size: 13px;
    margin-bottom: 5px;
    color: #ccc;
  }
  
  .history-dates {
    font-size: 13px;
    color: #888;
  }
</style>

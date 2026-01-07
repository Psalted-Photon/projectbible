# Reading History and Plan Tracking System

## Overview

The reading history system provides comprehensive tracking of Bible reading progress, including:

- **Reading history** - Record every chapter read with timestamps
- **Reading streaks** - Track consecutive days of Bible reading
- **Reading plans** - Create and manage structured reading schedules
- **Progress tracking** - Monitor completion of daily assignments
- **Plan integration** - Seamless connection with the reading plan generator

## Architecture

### Core Interfaces

Located in `packages/core/src/interfaces.ts`:

```typescript
interface ReadingHistoryEntry {
  id: string;
  book: string;
  chapter: number;
  readAt: Date;
  planId?: string; // Links to a reading plan if applicable
}

interface ActiveReadingPlan {
  id: string;
  name: string;
  config: any; // ReadingPlanConfig from reading-plan.ts
  startedAt: Date;
  completedAt?: Date;
  currentDayNumber: number;
}

interface ReadingPlanDay {
  planId: string;
  dayNumber: number;
  date: Date;
  chapters: { book: string; chapter: number }[];
  completed: boolean;
  completedAt?: Date;
}
```

### ReadingHistoryStore Interface

```typescript
interface ReadingHistoryStore {
  // Reading History
  recordReading(
    book: string,
    chapter: number,
    planId?: string
  ): Promise<ReadingHistoryEntry>;
  getReadingHistory(
    book?: string,
    chapter?: number
  ): Promise<ReadingHistoryEntry[]>;
  hasRead(book: string, chapter: number, planId?: string): Promise<boolean>;
  getReadingStreak(): Promise<number>;
  getTotalChaptersRead(): Promise<number>;

  // Reading Plan Management
  startReadingPlan(name: string, config: any): Promise<ActiveReadingPlan>;
  getActiveReadingPlan(): Promise<ActiveReadingPlan | null>;
  getReadingPlan(planId: string): Promise<ActiveReadingPlan | null>;
  getAllReadingPlans(): Promise<ActiveReadingPlan[]>;
  completeReadingPlan(planId: string): Promise<void>;
  deleteReadingPlan(planId: string): Promise<void>;

  // Daily Progress
  getDayReading(
    planId: string,
    dayNumber: number
  ): Promise<ReadingPlanDay | null>;
  getAllDayReadings(planId: string): Promise<ReadingPlanDay[]>;
  completeDayReading(planId: string, dayNumber: number): Promise<void>;
  getPlanProgress(planId: string): Promise<number>;
  getTodaysReading(): Promise<ReadingPlanDay | null>;
}
```

### IndexedDB Implementation

**Database Version:** 5

**Object Stores:**

1. **reading_history** (keyPath: `id`)

   - Indexes: `book_chapter`, `planId`, `readAt`
   - Stores: Individual chapter read events

2. **reading_plans** (keyPath: `id`)

   - Indexes: `completedAt`
   - Stores: Active and completed reading plans

3. **reading_plan_days** (keyPath: `id` = "planId-dayNumber")
   - Indexes: `planId`, `planId_dayNumber` (unique), `date`
   - Stores: Daily reading assignments

## Usage Examples

### Record Reading Activity

```typescript
import { IndexedDBReadingHistoryStore } from "./adapters";

const historyStore = new IndexedDBReadingHistoryStore();

// Record reading a chapter (standalone)
await historyStore.recordReading("Matthew", 5);

// Record reading as part of a plan
await historyStore.recordReading("Genesis", 1, "plan-123");
```

### Check Reading History

```typescript
// Get all reading history
const allHistory = await historyStore.getReadingHistory();

// Get history for a specific book
const matthewHistory = await historyStore.getReadingHistory("Matthew");

// Get history for a specific chapter
const sermomOnMount = await historyStore.getReadingHistory("Matthew", 5);

// Check if a chapter has been read
const hasRead = await historyStore.hasRead("John", 3, 16);
```

### Track Reading Stats

```typescript
// Get current reading streak
const streak = await historyStore.getReadingStreak();
console.log(`${streak} days in a row!`);

// Get total unique chapters read
const total = await historyStore.getTotalChaptersRead();
console.log(`${total} chapters read`);
```

### Start a Reading Plan

```typescript
import { generateReadingPlan, createWholeBiblePlan } from "@projectbible/core";

// Generate a plan using the reading plan generator
const planConfig = createWholeBiblePlan({
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-12-31"),
  excludedWeekdays: [0], // Skip Sundays
});

const plan = generateReadingPlan(planConfig);

// Start tracking this plan
const activePlan = await historyStore.startReadingPlan(
  "Whole Bible in 2026",
  plan
);

console.log(`Started plan: ${activePlan.name}`);
console.log(`Total days: ${plan.totalDays}`);
console.log(`Avg chapters/day: ${plan.avgChaptersPerDay}`);
```

### Get Today's Reading

```typescript
// Get today's assignment from active plan
const todaysReading = await historyStore.getTodaysReading();

if (todaysReading) {
  console.log(`Day ${todaysReading.dayNumber}:`);
  for (const chapter of todaysReading.chapters) {
    console.log(`  ${chapter.book} ${chapter.chapter}`);
  }

  // Mark as completed when done
  await historyStore.completeDayReading(
    todaysReading.planId,
    todaysReading.dayNumber
  );
}
```

### Track Plan Progress

```typescript
// Get active plan
const plan = await historyStore.getActiveReadingPlan();

if (plan) {
  // Get progress percentage
  const progress = await historyStore.getPlanProgress(plan.id);
  console.log(`${progress}% complete`);

  // Get all days
  const allDays = await historyStore.getAllDayReadings(plan.id);
  const completedDays = allDays.filter((d) => d.completed);
  console.log(`${completedDays.length} of ${allDays.length} days complete`);

  // Check if plan is complete
  if (progress === 100) {
    await historyStore.completeReadingPlan(plan.id);
    console.log("Congratulations! Plan completed! 🎉");
  }
}
```

### Auto-Complete Days

The system automatically marks days as complete when all chapters are read:

```typescript
// Start a plan
const plan = await historyStore.startReadingPlan("My Plan", planConfig);

// Read the assigned chapters
const todaysReading = await historyStore.getTodaysReading();

for (const chapter of todaysReading.chapters) {
  // As you read each chapter, record it
  await historyStore.recordReading(chapter.book, chapter.chapter, plan.id);
}

// The day is automatically marked complete when the last chapter is recorded!
```

## Integration with Reading Plan Generator

The system seamlessly integrates with `packages/core/src/reading-plan.ts`:

```typescript
import {
  generateReadingPlan,
  createWholeBiblePlan,
  createNTPlan,
  createPsalmsProverbsPlan,
} from "@projectbible/core";
import { IndexedDBReadingHistoryStore } from "./adapters";

const historyStore = new IndexedDBReadingHistoryStore();

// Example: One year Bible plan
const config = createWholeBiblePlan({
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-12-31"),
});

const plan = generateReadingPlan(config);
const activePlan = await historyStore.startReadingPlan("Bible in a Year", plan);

// Example: 90-day NT plan
const ntConfig = createNTPlan({
  startDate: new Date(),
  daysToComplete: 90,
});

const ntPlan = generateReadingPlan(ntConfig);
const ntActivePlan = await historyStore.startReadingPlan(
  "NT in 90 Days",
  ntPlan
);

// Example: Psalms and Proverbs in 30 days
const wisdomConfig = createPsalmsProverbsPlan({
  startDate: new Date(),
  daysToComplete: 30,
});

const wisdomPlan = generateReadingPlan(wisdomConfig);
const wisdomActivePlan = await historyStore.startReadingPlan(
  "Wisdom in 30",
  wisdomPlan
);
```

## UI Integration Ideas

### 1. Reading Plan Dashboard

```typescript
const plan = await historyStore.getActiveReadingPlan();
const progress = await historyStore.getPlanProgress(plan.id);
const streak = await historyStore.getReadingStreak();
const todaysReading = await historyStore.getTodaysReading();

// Display:
// - Plan name and progress bar (45% complete)
// - Current streak (7 days 🔥)
// - Today's assignment with checkboxes
// - Calendar view with completed days marked
```

### 2. Chapter Completion Indicator

```typescript
// Show checkmark if chapter already read
const hasRead = await historyStore.hasRead("Matthew", 5);

// Display: "Matthew 5 ✓" or "Matthew 5"
```

### 3. Statistics View

```typescript
const totalChapters = await historyStore.getTotalChaptersRead();
const allHistory = await historyStore.getReadingHistory();
const allPlans = await historyStore.getAllReadingPlans();

// Display:
// - Total chapters read: 437
// - Reading streak: 14 days
// - Completed plans: 3
// - Current plan: "Bible in a Year" (45% complete)
// - Reading history chart/heatmap
```

### 4. Plan Selector

```typescript
const allPlans = await historyStore.getAllReadingPlans();
const activePlan = await historyStore.getActiveReadingPlan();

// Display list of plans:
// - Active plan (highlighted)
// - Completed plans (with ✓)
// - Option to start new plan
```

## Advanced Features

### Reading Heatmap

Track reading activity over time:

```typescript
const history = await historyStore.getReadingHistory();

// Group by date
const heatmap = {};
for (const entry of history) {
  const date = entry.readAt.toISOString().split("T")[0];
  heatmap[date] = (heatmap[date] || 0) + 1;
}

// Display GitHub-style contribution graph
```

### Catch-Up Mode

Find missed days in a plan:

```typescript
const allDays = await historyStore.getAllDayReadings(plan.id);
const today = new Date();

const missedDays = allDays.filter((day) => {
  return !day.completed && day.date < today;
});

// Display: "You're behind by 3 days"
// Show accumulated readings
```

### Reading Velocity

Calculate reading pace:

```typescript
const plan = await historyStore.getActiveReadingPlan();
const days = await historyStore.getAllDayReadings(plan.id);

const completedDays = days.filter((d) => d.completed);
const elapsedDays = Math.floor(
  (Date.now() - plan.startedAt.getTime()) / (1000 * 60 * 60 * 24)
);

const velocity = completedDays.length / elapsedDays;

// Display: "Reading at 1.2x pace" or "0.8x (falling behind)"
```

## Performance Notes

- **Indexes:** Critical for fast queries

  - `book_chapter` enables fast chapter lookup
  - `planId` enables fast plan filtering
  - `readAt` enables fast date-based queries
  - `planId_dayNumber` unique index prevents duplicate days

- **Auto-completion:** Days are automatically marked complete when all chapters are read (checked on each `recordReading`)

- **Caching:** Consider caching active plan and today's reading in memory

## Future Enhancements

1. **Reading Goals**

   - Set daily/weekly/monthly goals
   - Track against goals
   - Achievement badges

2. **Social Features**

   - Share reading plans
   - Group reading plans
   - Accountability partners

3. **Analytics**

   - Reading time tracking
   - Favorite books/chapters
   - Reading patterns (morning vs evening)

4. **Reminders**

   - Daily reading reminders
   - Catch-up notifications
   - Streak preservation alerts

5. **Import/Export**
   - Export reading history as CSV
   - Import from other apps
   - Backup/restore plans

## Related Documentation

- [READING-PLANS.md](./READING-PLANS.md) - Reading plan generation algorithm
- [USER-DATA.md](./USER-DATA.md) - Notes, highlights, bookmarks
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system design

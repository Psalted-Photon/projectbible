# Reading Plan Generator

The reading plan generator creates personalized Bible reading schedules with advanced features.

## Features

✅ **Even Distribution** - Chapters are distributed so the difference between lightest and heaviest day is ≤ 1 chapter  
✅ **Multipliers** - Read specific books multiple times (e.g., Psalms x3)  
✅ **Excluded Days** - Skip weekends or specific weekdays  
✅ **Ordering Modes** - Canonical, shuffled, or chronological order  
✅ **Custom Selections** - Choose specific books or chapters

## Quick Start

```typescript
import { createWholeBiblePlan } from "@projectbible/core";

// Read the whole Bible in 2026
const plan = createWholeBiblePlan(
  new Date("2026-01-01"),
  new Date("2026-12-31")
);

console.log(`Total chapters: ${plan.totalChapters}`);
console.log(`Avg chapters/day: ${plan.avgChaptersPerDay.toFixed(2)}`);

// Access daily readings
plan.days.forEach((day) => {
  console.log(`Day ${day.dayNumber} (${day.date.toLocaleDateString()}):`);
  day.chapters.forEach((ch) => {
    console.log(`  - ${ch.book} ${ch.chapter}`);
  });
});
```

## Preset Plans

### Whole Bible

```typescript
const plan = createWholeBiblePlan(startDate, endDate, [0, 6]); // Exclude weekends
```

### New Testament Only

```typescript
const plan = createNTPlan(startDate, endDate);
```

### Psalms & Proverbs

```typescript
const plan = createPsalmsProverbsPlan(
  startDate,
  endDate,
  3 // Read Psalms 3 times
);
```

## Custom Plans

```typescript
import { generateReadingPlan } from "@projectbible/core";

const plan = generateReadingPlan({
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-03-31"),

  // Exclude Sunday (0) and Saturday (6)
  excludedWeekdays: [0, 6],

  books: [
    { book: "Matthew" },
    { book: "Mark" },
    { book: "Luke" },
    { book: "John" },
    { book: "Psalms", multiplier: 2 }, // Read Psalms twice
    { book: "Proverbs", chapters: [1, 2, 3] }, // Only chapters 1-3
  ],

  ordering: "shuffled", // or 'canonical' or 'chronological'
});
```

## Testing

Run the test examples to see various plans:

```bash
cd packages/core
npx tsx test/reading-plan.test.ts
```

This will generate and display:

- Whole Bible in 1 year
- Whole Bible in 1 year (weekdays only)
- New Testament in 90 days
- Psalms (3x) + Proverbs
- Gospels + Acts (shuffled)
- And more...

## Algorithm Details

### Even Distribution

The algorithm ensures fair distribution:

- Calculates base chapters per day: `floor(totalChapters / totalDays)`
- Determines how many days need an extra chapter: `totalChapters % totalDays`
- First N days get the extra chapter, rest get base amount
- Result: difference between any two days is at most 1 chapter

Example: 100 chapters over 7 days

- Days 1-2: 15 chapters each
- Days 3-7: 14 chapters each

### Ordering Modes

**Canonical**: Books in traditional Bible order (Genesis → Revelation)  
**Shuffled**: Random order using Fisher-Yates shuffle  
**Chronological**: Books in approximate historical/chronological order

## Data Structure

All Bible books with chapter counts are built-in:

```typescript
export const BIBLE_BOOKS: BookInfo[] = [
  { name: "Genesis", testament: "OT", chapters: 50 },
  { name: "Exodus", testament: "OT", chapters: 40 },
  // ... all 66 books
];
```

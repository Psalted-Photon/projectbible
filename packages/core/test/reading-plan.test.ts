/**
 * Reading Plan Generator - Test Examples
 * 
 * Run this file to see example reading plans generated
 */

import {
  generateReadingPlan,
  createWholeBiblePlan,
  createNTPlan,
  createPsalmsProverbsPlan,
  type ReadingPlan
} from '../src/reading-plan.js';

function printPlan(plan: ReadingPlan, title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
  console.log(`Total Days: ${plan.totalDays}`);
  console.log(`Total Chapters: ${plan.totalChapters}`);
  console.log(`Avg Chapters/Day: ${plan.avgChaptersPerDay.toFixed(2)}`);
  console.log(`Date Range: ${plan.config.startDate.toLocaleDateString()} - ${plan.config.endDate.toLocaleDateString()}`);
  
  if (plan.config.excludedWeekdays && plan.config.excludedWeekdays.length > 0) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const excluded = plan.config.excludedWeekdays.map(d => days[d]).join(', ');
    console.log(`Excluded Days: ${excluded}`);
  }
  
  console.log('\nFirst 5 days:');
  for (let i = 0; i < Math.min(5, plan.days.length); i++) {
    const day = plan.days[i];
    const chapters = day.chapters.map(c => `${c.book} ${c.chapter}`).join(', ');
    console.log(`  Day ${day.dayNumber} (${day.date.toLocaleDateString()}): ${chapters}`);
  }
  
  if (plan.days.length > 5) {
    console.log('  ...');
    const lastDay = plan.days[plan.days.length - 1];
    const lastChapters = lastDay.chapters.map(c => `${c.book} ${c.chapter}`).join(', ');
    console.log(`  Day ${lastDay.dayNumber} (${lastDay.date.toLocaleDateString()}): ${lastChapters}`);
  }
}

// Example 1: Read the whole Bible in a year
console.log('\n📖 READING PLAN GENERATOR EXAMPLES 📖\n');

const startDate = new Date('2026-01-01');
const endDate = new Date('2026-12-31');

const wholeBiblePlan = createWholeBiblePlan(startDate, endDate);
printPlan(wholeBiblePlan, 'Example 1: Whole Bible in 1 Year');

// Example 2: Read the whole Bible in a year, excluding weekends
const weekdaysPlan = createWholeBiblePlan(
  startDate,
  endDate,
  [0, 6] // Exclude Sunday (0) and Saturday (6)
);
printPlan(weekdaysPlan, 'Example 2: Whole Bible in 1 Year (Weekdays Only)');

// Example 3: New Testament only in 90 days
const ntEndDate = new Date('2026-03-31');
const ntPlan = createNTPlan(startDate, ntEndDate);
printPlan(ntPlan, 'Example 3: New Testament in 90 Days');

// Example 4: Psalms (3x) and Proverbs in 1 year
const psalmsProverbsPlan = createPsalmsProverbsPlan(
  startDate,
  endDate,
  3 // Read Psalms 3 times
);
printPlan(psalmsProverbsPlan, 'Example 4: Psalms (3x) + Proverbs in 1 Year');

// Example 5: Custom plan - Gospels + Acts, shuffled
const customPlan = generateReadingPlan({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-03-31'),
  books: [
    { book: 'Matthew' },
    { book: 'Mark' },
    { book: 'Luke' },
    { book: 'John' },
    { book: 'Acts' }
  ],
  ordering: 'shuffled'
});
printPlan(customPlan, 'Example 5: Gospels + Acts (Shuffled) in 90 Days');

// Example 6: Proverbs - one chapter per day for a month
const proverbsPlan = generateReadingPlan({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  books: [{ book: 'Proverbs' }],
  ordering: 'canonical'
});
printPlan(proverbsPlan, 'Example 6: Proverbs - One Chapter Per Day');

// Example 7: Read Genesis twice in a month
const genesisDoublePlan = generateReadingPlan({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  books: [{ book: 'Genesis', multiplier: 2 }],
  ordering: 'canonical'
});
printPlan(genesisDoublePlan, 'Example 7: Genesis (2x) in 31 Days');

console.log('\n' + '='.repeat(60));
console.log('✅ Reading Plan Generator Tests Complete!');
console.log('='.repeat(60) + '\n');

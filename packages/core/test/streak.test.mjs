// Streak + day-status tests for ReadingPlanEngine.
// Runs against the built package: `npm run build && npm test` in packages/core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStreak, computeDayStatus, getDaysAheadBehind } from '../dist/ReadingPlanEngine.js';

// Day dates as plain calendar strings (the timezone-free form planDayDateStr
// passes through untouched). completedAt instants are local-noon epochs so
// the default device decoder maps them to the intended calendar day.
const day = (dayNumber, date, chapters = [{ book: 'Genesis', chapter: dayNumber }]) =>
  ({ dayNumber, date, chapters });
const doneOn = (dayNumber, y, m, d) => ({
  planId: 'p', dayNumber, completed: true,
  completedAt: new Date(y, m - 1, d, 12).getTime(), chaptersRead: [],
});

test('scheduled rest days never break the streak', () => {
  // Wed Jul 15 is a rest day (not scheduled)
  const plan = { days: [day(1, '2026-07-13'), day(2, '2026-07-14'), day(3, '2026-07-16'), day(4, '2026-07-17')] };
  const entries = [doneOn(1, 2026, 7, 13), doneOn(2, 2026, 7, 14), doneOn(3, 2026, 7, 16), doneOn(4, 2026, 7, 17)];
  assert.equal(calculateStreak(plan, entries, '2026-07-17'), 4);
});

test('completing a day late fills the reading but resets the streak', () => {
  const plan = { days: [day(1, '2026-07-15'), day(2, '2026-07-16'), day(3, '2026-07-17')] };
  const entries = [doneOn(1, 2026, 7, 16), doneOn(2, 2026, 7, 16), doneOn(3, 2026, 7, 17)];
  // Day 1 was completed a day late → streak counts only days 3 and 2.
  assert.equal(calculateStreak(plan, entries, '2026-07-17'), 2);
});

test("today's unfinished reading doesn't break the streak", () => {
  const plan = { days: [day(1, '2026-07-15'), day(2, '2026-07-16'), day(3, '2026-07-17')] };
  const entries = [doneOn(1, 2026, 7, 15), doneOn(2, 2026, 7, 16)];
  assert.equal(calculateStreak(plan, entries, '2026-07-17'), 2);
});

test('a weeks-old completion no longer reports a live streak', () => {
  const plan = { days: [day(1, '2026-07-01'), day(2, '2026-07-02'), day(3, '2026-07-16')] };
  const entries = [doneOn(1, 2026, 7, 1), doneOn(2, 2026, 7, 2)];
  // Day 3 (Jul 16) was missed and today is Jul 17 → streak is dead.
  assert.equal(calculateStreak(plan, entries, '2026-07-17'), 0);
});

test('reading ahead counts toward the streak', () => {
  const plan = { days: [day(1, '2026-07-16'), day(2, '2026-07-17')] };
  const entries = [doneOn(1, 2026, 7, 16), doneOn(2, 2026, 7, 16)]; // day 2 done a day early
  assert.equal(calculateStreak(plan, entries, '2026-07-17'), 2);
});

test('completed entry without a timestamp gets the benefit of the doubt', () => {
  const plan = { days: [day(1, '2026-07-16'), day(2, '2026-07-17')] };
  const entries = [
    { planId: 'p', dayNumber: 1, completed: true, chaptersRead: [] },
    doneOn(2, 2026, 7, 17),
  ];
  assert.equal(calculateStreak(plan, entries, '2026-07-17'), 2);
});

test('computeDayStatus uses calendar-string comparisons', () => {
  const today = '2026-07-17';
  assert.equal(computeDayStatus(day(1, '2026-07-16'), undefined, today), 'overdue');
  assert.equal(computeDayStatus(day(1, '2026-07-17'), undefined, today), 'current');
  assert.equal(computeDayStatus(day(1, '2026-07-18'), undefined, today), 'unread');
  assert.equal(computeDayStatus(day(1, '2026-07-18'), { completed: true, chaptersRead: [] }, today), 'ahead');
  assert.equal(computeDayStatus(day(1, '2026-07-16'), { completed: true, chaptersRead: [] }, today), 'completed');
});

test('getDaysAheadBehind counts scheduled days by calendar date', () => {
  const plan = { days: [day(1, '2026-07-15'), day(2, '2026-07-16'), day(3, '2026-07-17'), day(4, '2026-07-18')] };
  const entries = [doneOn(1, 2026, 7, 15), doneOn(2, 2026, 7, 16)];
  // 3 scheduled through today, 2 completed → 1 behind.
  assert.equal(getDaysAheadBehind(plan, entries, '2026-07-17'), -1);
});

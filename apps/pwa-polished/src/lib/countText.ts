/** "1 day", "3 days" — a count with its noun agreeing. */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** A reading plan's lead or lag, from getDaysAheadBehind (positive = ahead). */
export function scheduleText(daysAheadBehind: number): string {
  if (daysAheadBehind === 0) return 'On schedule';
  const n = Math.abs(daysAheadBehind);
  return `${countOf(n, 'day')} ${daysAheadBehind > 0 ? 'ahead' : 'behind'}`;
}

/** The one way a reading plan shows a date on screen: "Oct 10, 2026". */
export function planDateText(date: string | number | Date): string {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

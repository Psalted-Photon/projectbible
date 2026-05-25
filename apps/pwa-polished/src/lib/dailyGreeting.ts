/**
 * Daily Greeting Utility
 *
 * Returns a friendly greeting string for a given date string (YYYY-MM-DD).
 * Floating Christian holidays (Easter, Good Friday, etc.) and Thanksgiving
 * are computed algorithmically per year so they always land on the correct
 * calendar day, regardless of timezone or year.
 *
 * Usage:
 *   import { getDailyGreeting } from '$lib/dailyGreeting';
 *   const greeting = getDailyGreeting(localDateStr(new Date()));
 */

import greetings from '../data/daily-greeting.json';

// ---------------------------------------------------------------------------
// Easter — Meeus/Jones/Butcher algorithm (works 1900–2099)
// ---------------------------------------------------------------------------
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// ---------------------------------------------------------------------------
// Thanksgiving — 4th Thursday of November
// ---------------------------------------------------------------------------
function computeThanksgiving(year: number): Date {
  const nov1 = new Date(year, 10, 1); // month 10 = November (0-indexed)
  const dow = nov1.getDay(); // 0=Sun … 6=Sat; Thursday=4
  const firstThursday = dow <= 4 ? 1 + (4 - dow) : 1 + (11 - dow);
  return new Date(year, 10, firstThursday + 21);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Floating holiday greetings (keyed by holiday name)
// ---------------------------------------------------------------------------
const FLOATING_GREETINGS: Record<string, string> = {
  ashWednesday:
    "Ash Wednesday — a holy season begins today. May Lent draw you closer to God.",
  palmSunday:
    "Hosanna! Happy Palm Sunday. Today we remember Jesus' triumphant entry into Jerusalem.",
  goodFriday:
    "Good Friday. Today we pause and remember the cross — his suffering was for our redemption.",
  easterSunday:
    "He is risen! Wishing you a joyful and blessed Easter Sunday. Alleluia!",
  pentecost:
    "Happy Pentecost! Come, Holy Spirit. Today we celebrate the birth of the Church.",
  thanksgiving:
    "Happy Thanksgiving! May your heart overflow with gratitude for every good gift.",
};

// ---------------------------------------------------------------------------
// Build a map of YYYY-MM-DD → greeting for all floating holidays in a year
// ---------------------------------------------------------------------------
function buildFloatingMap(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const easter = computeEaster(year);

  map.set(toYMD(addDays(easter, -46)), FLOATING_GREETINGS.ashWednesday);
  map.set(toYMD(addDays(easter, -7)),  FLOATING_GREETINGS.palmSunday);
  map.set(toYMD(addDays(easter, -2)),  FLOATING_GREETINGS.goodFriday);
  map.set(toYMD(easter),               FLOATING_GREETINGS.easterSunday);
  map.set(toYMD(addDays(easter, 49)),  FLOATING_GREETINGS.pentecost);
  map.set(toYMD(computeThanksgiving(year)), FLOATING_GREETINGS.thanksgiving);

  return map;
}

// Cache the floating map so it's only computed once per year per session
let _cachedYear = -1;
let _cachedMap: Map<string, string> = new Map();

function getFloatingMap(year: number): Map<string, string> {
  if (year !== _cachedYear) {
    _cachedMap = buildFloatingMap(year);
    _cachedYear = year;
  }
  return _cachedMap;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Returns the daily greeting for a given date string.
 * @param dateStr - YYYY-MM-DD string (use localDateStr() from clockStore)
 */
export function getDailyGreeting(dateStr: string): string {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const mmdd = dateStr.slice(5); // "MM-DD"

  // 1. Check floating holidays first
  const floating = getFloatingMap(year);
  if (floating.has(dateStr)) {
    return floating.get(dateStr)!;
  }

  // 2. Fall back to fixed MM-DD JSON
  const fixed = (greetings as Record<string, string>)[mmdd];
  if (fixed) return fixed;

  // 3. Fallback (should never happen with a complete JSON)
  return "Good day! May this moment find you well.";
}

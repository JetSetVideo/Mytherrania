// The Mytherrania calendar (G12): twelve named months over a 365-day year and the astronomical
// seasons. Pure: no THREE, no DOM.
//
// The calendar's day of year is the SAME number Environment.solarPosition(dayOfYear, ...) feeds
// into the solar declination (23.44 deg sin(2 pi (284 + doy) / 365)), so turning the calendar
// turns the sun: day 172 (Highsun 21) is the northern solstice, day 355 (Longdark 21) the winter one.
// Month lengths mirror the Gregorian year so the real-world climate normals line up month by month.

import type { CalendarDate, Season } from "./contracts.ts";

export interface MonthDef { name: string; days: number; note: string }

export const MONTHS: readonly MonthDef[] = [
  { name: "Frostwane", days: 31, note: "the deep cold loosens its grip" },
  { name: "Emberthaw", days: 28, note: "hearth-fires and the first thaw" },
  { name: "Seedwake", days: 31, note: "the spring equinox; seeds wake" },
  { name: "Rainmoot", days: 30, note: "the showers gather" },
  { name: "Bloomtide", days: 31, note: "the hills flower" },
  { name: "Highsun", days: 30, note: "the summer solstice; longest days" },
  { name: "Goldcrest", days: 31, note: "heat, dust and thunderheads" },
  { name: "Harvestfire", days: 31, note: "reaping under red evenings" },
  { name: "Ashfall", days: 30, note: "the autumn equinox; leaves fall" },
  { name: "Mistveil", days: 31, note: "valley fogs at dawn" },
  { name: "Starhollow", days: 30, note: "long clear nights" },
  { name: "Longdark", days: 31, note: "the winter solstice; shortest days" },
];

export const DAYS_PER_YEAR = 365;

/** Northern-hemisphere astronomical season starts (day of year): equinoxes and solstices. */
export const SEASON_STARTS: Readonly<Record<Season, number>> = { spring: 79, summer: 172, autumn: 265, winter: 355 };
const SEASON_ORDER: readonly Season[] = ["spring", "summer", "autumn", "winter"];

/** First day of year (1-based) of each month. */
export const MONTH_START_DAYS: readonly number[] = (() => {
  const out: number[] = [];
  let s = 1;
  for (const m of MONTHS) { out.push(s); s += m.days; }
  if (s - 1 !== DAYS_PER_YEAR) throw new Error(`calendar: months sum to ${s - 1}, not ${DAYS_PER_YEAR}`);
  return out;
})();

/**
 * Wrap a (possibly out-of-range, fractional) day of year into 1..365, carrying whole years.
 * Total: a non-finite day reads as day 1, a non-finite year as year 0.
 */
export function normalizeDay(dayOfYear: number, year: number): { dayOfYear: number; year: number } {
  if (!Number.isFinite(year)) year = 0;
  if (!Number.isFinite(dayOfYear)) return { dayOfYear: 1, year };
  const d0 = Math.floor(dayOfYear) - 1;
  const carry = Math.floor(d0 / DAYS_PER_YEAR);
  return { dayOfYear: d0 - carry * DAYS_PER_YEAR + 1, year: year + carry };
}

/** Season and progress 0..1 through it for a day of year (northern hemisphere). */
export function seasonOf(dayOfYear: number): { season: Season; progress: number } {
  for (let i = SEASON_ORDER.length - 1; i >= 0; i--) {
    const s = SEASON_ORDER[i];
    const start = SEASON_STARTS[s];
    const nextStart = i === SEASON_ORDER.length - 1 ? SEASON_STARTS.spring + DAYS_PER_YEAR : SEASON_STARTS[SEASON_ORDER[i + 1]];
    if (dayOfYear >= start) return { season: s, progress: (dayOfYear - start) / (nextStart - start) };
  }
  // before the spring equinox: still winter (which began on day 355 of the previous year)
  const start = SEASON_STARTS.winter - DAYS_PER_YEAR;
  return { season: "winter", progress: (dayOfYear - start) / (SEASON_STARTS.spring - start) };
}

/** The calendar date for a day of year (wrapped into 1..365, carrying the year). */
export function calendarFromDayOfYear(dayOfYear: number, year: number): CalendarDate {
  const n = normalizeDay(dayOfYear, year);
  let m = 0;
  while (m < 11 && n.dayOfYear >= MONTH_START_DAYS[m + 1]) m++;
  const s = seasonOf(n.dayOfYear);
  return {
    year: n.year, monthIndex: m, monthName: MONTHS[m].name, dayOfMonth: n.dayOfYear - MONTH_START_DAYS[m] + 1,
    dayOfYear: n.dayOfYear, season: s.season, seasonProgress: s.progress,
  };
}

/** Day of year for (month index 0..11, 1-based day of month). */
export function dayOfYearFromCalendar(monthIndex: number, dayOfMonth: number): number {
  return MONTH_START_DAYS[monthIndex] + dayOfMonth - 1;
}

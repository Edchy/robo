/**
 * Local persistence. Two keys, both in localStorage, both on-device only:
 *
 *   robo.me           the chosen initials, e.g. "AN"
 *   robo.schedule     the parsed month, so the PDF need not be re-dropped
 *
 * The cached month is discarded once it is over, so an old schedule cannot
 * linger on a device for months. Nothing here ever leaves the browser.
 */
import type { Schedule } from './schedule';

const ME_KEY = 'robo.me';
const SCHEDULE_KEY = 'robo.schedule';

/** Bump when the Schedule shape changes, so stale cached JSON is dropped. */
const CACHE_VERSION = 1;

type Cached = {
  v: number;
  schedule: Schedule;
};

/**
 * Midnight after the schedule's month ends — the moment everything cached for
 * that month becomes stale.
 *
 * Exported because the PDF is kept in a different store (IndexedDB, see
 * `pdf-storage.ts`) and the two must die together. Computing the date twice,
 * once per file, is how they would drift: the schedule would vanish while the
 * PDF lingered, and "Se PDF" would offer last month's paper against no
 * calendar. One rule, one definition, both stores.
 *
 * `schedule.month` is 1-12 while `Date` counts months from 0, so passing it
 * unadjusted lands on the first of the *following* month, which is exactly the
 * boundary wanted.
 */
export function expiryOf(schedule: Schedule): Date {
  return new Date(schedule.year, schedule.month, 1);
}

export function loadMe(): string | null {
  try {
    return localStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
}

export function saveMe(code: string): void {
  try {
    localStorage.setItem(ME_KEY, code);
  } catch {
    // Private browsing or a full quota — remembering is a convenience, not a
    // requirement, so a failure here must never break the app.
  }
}

/**
 * Return the cached schedule, or null if there is none, it is stale, its month
 * has passed, or it cannot be read. Expired entries are removed on the way out.
 */
export function loadSchedule(now: Date = new Date()): Schedule | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SCHEDULE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let cached: Cached;
  try {
    cached = JSON.parse(raw) as Cached;
  } catch {
    clearSchedule();
    return null;
  }

  if (cached?.v !== CACHE_VERSION || !cached.schedule?.days?.length) {
    clearSchedule();
    return null;
  }

  if (now >= expiryOf(cached.schedule)) {
    clearSchedule();
    return null;
  }

  return cached.schedule;
}

export function saveSchedule(schedule: Schedule): void {
  try {
    const payload: Cached = { v: CACHE_VERSION, schedule };
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled: the app still works, it just asks
    // for the PDF again next time.
  }
}

export function clearSchedule(): void {
  try {
    localStorage.removeItem(SCHEDULE_KEY);
  } catch {
    // nothing to do
  }
}

/** Remove everything this app has stored on the device. */
export function forgetAll(): void {
  try {
    localStorage.removeItem(ME_KEY);
    localStorage.removeItem(SCHEDULE_KEY);
  } catch {
    // nothing to do
  }
}

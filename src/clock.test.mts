/**
 * The page clock. Pure and PDF-free, so this always runs.
 *
 *   node --test src/clock.test.mts
 *
 * Everything dated on the page hangs off one `now`: which day is "idag", which
 * shift is next, which days have receded, whether a shift is running. The app
 * is built to be imported once and left, so the tab that comes back is usually
 * a restored one rather than a fresh load — which is exactly when a clock read
 * at mount is days out of date.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceClock, TICK_MS } from './schedule.ts';

const at = (iso: string) => new Date(iso);

test('holds still while nothing displayable has changed', () => {
  const start = at('2026-08-04T10:00:00');
  // Same object, not merely an equal one: React skips the re-render on
  // identity, so returning a fresh Date here would redraw the whole ledger
  // every tick to paint the same pixels.
  assert.equal(advanceClock(start, start.getTime() + 1_000), start);
  assert.equal(advanceClock(start, start.getTime() + 30_000), start);
  assert.equal(advanceClock(start, start.getTime() + TICK_MS - 1), start);
});

test('advances once the tick boundary is crossed', () => {
  const start = at('2026-08-04T10:00:00');
  const later = advanceClock(start, start.getTime() + TICK_MS + 1_000);
  assert.notEqual(later, start);
  assert.equal(later.getMinutes(), 1);
});

test('a tab restored days later catches up', () => {
  // The reported worry: import a PDF, come back three days on. A clock read
  // once at mount would still be naming Tuesday's finished shift as "nästa
  // pass" and highlighting the wrong day as "idag".
  const mounted = at('2026-08-04T10:00:00');
  const restored = advanceClock(mounted, at('2026-08-07T09:15:00').getTime());
  assert.notEqual(restored, mounted);
  assert.equal(restored.getDate(), 7);
  assert.equal(restored.getMonth(), 7);
});

test('crosses midnight onto the new date', () => {
  // "Idag" is a date comparison, so this boundary is the one that decides
  // whether the whole calendar is labelled correctly overnight.
  const beforeMidnight = at('2026-08-04T23:59:30');
  const after = advanceClock(beforeMidnight, at('2026-08-05T00:00:05').getTime());
  assert.notEqual(after, beforeMidnight);
  assert.equal(after.getDate(), 5);
});

test('a clock that never advances is not mistaken for a stable one', () => {
  // Guards the comparison itself: bucketing on the wrong unit could make every
  // later time land in the previous bucket, freezing the page forever.
  let clock = at('2026-08-04T00:00:00');
  const started = clock;
  for (let minute = 1; minute <= 60 * 24 * 3; minute++) {
    clock = advanceClock(clock, started.getTime() + minute * 60_000);
  }
  assert.equal(clock.getDate(), 7, 'three days of ticks must land on the 7th');
});

test('never runs backwards when given an earlier reading', () => {
  // Clocks do move back — a manual correction, a DST fallback. Whatever it
  // does, it must not be to keep a Date that claims to be in the future.
  const start = at('2026-08-04T10:00:00');
  const earlier = advanceClock(start, start.getTime() - 3 * TICK_MS);
  assert.equal(earlier.getTime(), start.getTime() - 3 * TICK_MS);
});


/**
 * Workdays: days you actually travel in, as opposed to days that merely have
 * hours on them. Pure and PDF-free, so this always runs.
 *
 *   node --test src/workday.test.mts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isContinuation,
  continuesTomorrow,
  workdaysOf,
  type Shift,
} from './schedule.ts';

const shift = (dayNum: number, start: string, end: string, hours: number): Shift => ({
  date: `2026-08-${String(dayNum).padStart(2, '0')}`,
  weekday: 'Måndag',
  dayNum,
  start,
  end,
  endsNextDay: false,
  hours,
  contestedWith: [],
});

test('a 00:00 start after a 24:00 finish is a continuation', () => {
  const all = [shift(1, '09:00', '24:00', 15), shift(2, '00:00', '09:00', 9)];
  assert.equal(isContinuation(all[0], all), false);
  assert.equal(isContinuation(all[1], all), true);
  assert.deepEqual([...workdaysOf(all)], [1]);
});

test('a 00:00 start with no night before it is a real arrival', () => {
  // Nothing on day 1, so day 2 genuinely begins at midnight.
  const all = [shift(2, '00:00', '09:00', 9)];
  assert.equal(isContinuation(all[0], all), false);
  assert.deepEqual([...workdaysOf(all)], [2]);
});

test('a short morning shift is a workday however brief', () => {
  const all = [shift(10, '07:00', '08:00', 1)];
  assert.equal(isContinuation(all[0], all), false);
  assert.deepEqual([...workdaysOf(all)], [10]);
});

test('finishing a night and starting again the same day is a workday', () => {
  // The case that matters: day 2 is a continuation AND a fresh 16:00 start.
  const all = [
    shift(1, '16:00', '24:00', 8),
    shift(2, '00:00', '08:00', 8),
    shift(2, '16:00', '24:00', 8),
  ];
  assert.equal(isContinuation(all[1], all), true);
  assert.equal(isContinuation(all[2], all), false);
  assert.deepEqual([...workdaysOf(all)].sort((a, b) => a - b), [1, 2]);
});

test('two trips on one day still count that day once', () => {
  const all = [shift(11, '08:00', '09:00', 1), shift(11, '16:00', '24:00', 8)];
  assert.deepEqual([...workdaysOf(all)], [11]);
});

test('a previous day ending before midnight does not absorb the next', () => {
  // Day 1 ends at 22:00, so day 2's 00:00 start is its own arrival.
  const all = [shift(1, '16:00', '22:00', 6), shift(2, '00:00', '08:00', 8)];
  assert.equal(isContinuation(all[1], all), false);
  assert.deepEqual([...workdaysOf(all)].sort((a, b) => a - b), [1, 2]);
});

test('the two halves of a night point at each other', () => {
  const all = [shift(1, '16:00', '24:00', 8), shift(2, '00:00', '08:00', 8)];
  // The evening half continues tomorrow; the morning half came from yesterday.
  assert.equal(continuesTomorrow(all[0], all), true);
  assert.equal(isContinuation(all[0], all), false);
  assert.equal(continuesTomorrow(all[1], all), false);
  assert.equal(isContinuation(all[1], all), true);
});

test('a shift ending at 24:00 with nothing after it does not point on', () => {
  // Ends the month, or simply is not picked up the next morning.
  const all = [shift(1, '16:00', '24:00', 8)];
  assert.equal(continuesTomorrow(all[0], all), false);
});

test('a shift ending before midnight never points on', () => {
  const all = [shift(1, '16:00', '22:00', 6), shift(2, '00:00', '08:00', 8)];
  assert.equal(continuesTomorrow(all[0], all), false);
});

/**
 * Time-of-day banding. Pure and PDF-free, so this always runs.
 *
 *   node --test src/band.test.mts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, BAND_LABEL, type Shift } from './schedule.ts';

const shift = (
  start: string,
  end: string,
  hours: number,
  endsNextDay = false
): Shift => ({
  date: '2026-08-03',
  weekday: 'Måndag',
  dayNum: 3,
  start,
  end,
  endsNextDay,
  hours,
  sharedWith: [],
});

test('short shifts band by midpoint, not start hour', () => {
  assert.equal(bandOf(shift('06:30', '14:00', 7.5)), 'day'); // mid 10:15
  assert.equal(bandOf(shift('06:00', '10:00', 4)), 'morning'); // mid 08:00
  assert.equal(bandOf(shift('10:00', '18:00', 8)), 'day'); // mid 14:00
  assert.equal(bandOf(shift('16:00', '22:00', 6)), 'evening'); // mid 19:00
});

test('a shift of 12 h or more is long, not a time of day', () => {
  // The real-schedule case that motivated this: 15 h starting at 09:00 was
  // being called "morgon".
  assert.equal(bandOf(shift('09:00', '24:00', 15)), 'long');
  assert.equal(bandOf(shift('09:00', '22:00', 13)), 'long');
  assert.equal(bandOf(shift('08:00', '20:00', 12)), 'long');
});

test('just under the long threshold still bands by time of day', () => {
  assert.equal(bandOf(shift('08:00', '19:45', 11.75)), 'day');
});

test('crossing midnight is night whatever hour it began or how long', () => {
  assert.equal(bandOf(shift('21:00', '07:00', 10, true)), 'night');
  assert.equal(bandOf(shift('16:00', '08:00', 16, true)), 'night');
  assert.equal(bandOf(shift('06:00', '02:00', 20, true)), 'night');
});

test('band boundaries fall on the later band', () => {
  assert.equal(bandOf(shift('08:00', '11:59', 3.98)), 'morning'); // mid 09:59
  assert.equal(bandOf(shift('08:00', '12:00', 4)), 'day'); // mid 10:00
  assert.equal(bandOf(shift('12:00', '19:58', 7.97)), 'day'); // mid 15:59
  assert.equal(bandOf(shift('12:00', '20:00', 8)), 'evening'); // mid 16:00
});

test('short fragments band sensibly', () => {
  assert.equal(bandOf(shift('07:00', '08:00', 1)), 'morning');
  assert.equal(bandOf(shift('08:00', '09:00', 1)), 'morning');
});

test('every band has a Swedish label', () => {
  for (const b of ['morning', 'day', 'evening', 'night', 'long'] as const) {
    assert.ok(BAND_LABEL[b].length > 0);
  }
});

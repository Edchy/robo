/**
 * Tests for calendar export.
 *
 *   npx tsx --test src/ics.test.mts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs } from './ics.ts';
import type { Shift } from './schedule.ts';

const NOW = new Date(Date.UTC(2026, 6, 30, 12, 0, 0));

const dayShift: Shift = {
  date: '2026-08-01', weekday: 'Lördag', dayNum: 1,
  start: '09:00', end: '24:00', endsNextDay: false, hours: 15, sharedWith: [],
};

const nightShift: Shift = {
  date: '2026-08-03', weekday: 'Måndag', dayNum: 3,
  start: '16:00', end: '08:00', endsNextDay: true, hours: 16, sharedWith: [],
};

const sharedShift: Shift = {
  date: '2026-08-05', weekday: 'Onsdag', dayNum: 5,
  start: '22:00', end: '08:00', endsNextDay: true, hours: 10, sharedWith: ['DV'],
};

const build = (shifts: Shift[], me = 'ES') => buildIcs({ me, shifts, now: NOW });

/** Unfold RFC 5545 continuation lines back into logical lines. */
const logicalLines = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

test('produces a well-formed calendar', () => {
  const ics = build([dayShift]);
  const lines = logicalLines(ics);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-2), 'END:VCALENDAR');
  assert.equal(ics.endsWith('\r\n'), true);
  assert.equal(ics.includes('VERSION:2.0'), true);
});

test('uses CRLF line endings throughout', () => {
  const ics = build([dayShift, nightShift]);
  assert.equal(/[^\r]\n/.test(ics), false, 'found a bare LF');
});

test('a shift ending at 24:00 rolls into the next day', () => {
  const lines = logicalLines(build([dayShift]));
  assert.equal(lines.includes('DTSTART:20260801T090000'), true);
  // 24:00 on the 1st is 00:00 on the 2nd.
  assert.equal(lines.includes('DTEND:20260802T000000'), true);
});

test('a night shift ends the following morning', () => {
  const lines = logicalLines(build([nightShift]));
  assert.equal(lines.includes('DTSTART:20260803T160000'), true);
  assert.equal(lines.includes('DTEND:20260804T080000'), true);
});

test('night shifts are labelled differently from day shifts', () => {
  assert.equal(build([nightShift]).includes('SUMMARY:Nattpass ES'), true);
  assert.equal(build([dayShift]).includes('SUMMARY:Arbetspass ES'), true);
});

test('names the co-worker on a shared shift', () => {
  const ics = build([sharedShift]);
  assert.equal(ics.includes('Delat pass med DV'), true);
});

test('UIDs are stable and unique per shift', () => {
  const first = build([dayShift, nightShift]);
  const again = build([dayShift, nightShift]);
  const uids = (s: string) => logicalLines(s).filter((l) => l.startsWith('UID:'));
  assert.deepEqual(uids(first), uids(again), 're-export must reuse UIDs');
  assert.equal(new Set(uids(first)).size, 2);
});

test('UIDs differ between people', () => {
  const es = build([dayShift], 'ES');
  const ka = build([dayShift], 'KA');
  assert.notDeepEqual(
    logicalLines(es).filter((l) => l.startsWith('UID:')),
    logicalLines(ka).filter((l) => l.startsWith('UID:'))
  );
});

test('contains no reminders', () => {
  const ics = build([dayShift, nightShift]);
  assert.equal(ics.includes('BEGIN:VALARM'), false);
});

test('folds long lines to 75 octets without splitting characters', () => {
  const many: Shift = { ...sharedShift, sharedWith: ['DV', 'BEL', 'KIA', 'MAS', 'NZ', 'RR'] };
  const ics = build(many.sharedWith.length ? [many] : []);
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) {
    assert.ok(enc.encode(line).length <= 75, `line too long: ${line}`);
  }
  // Folding must be reversible: the Swedish text survives intact.
  assert.equal(logicalLines(ics).some((l) => l.includes('Delat pass med DV')), true);
});

test('escapes commas and semicolons in values', () => {
  const ics = build([{ ...sharedShift, sharedWith: ['DV', 'BEL'] }]);
  const desc = logicalLines(ics).find((l) => l.startsWith('DESCRIPTION:'))!;
  // The comma between co-workers must be escaped, not left bare.
  assert.equal(desc.includes('DV\\, BEL'), true);
});

test('one VEVENT per shift', () => {
  const ics = build([dayShift, nightShift, sharedShift]);
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 3);
  assert.equal(ics.split('END:VEVENT').length - 1, 3);
});

test('handles an empty schedule without producing junk', () => {
  const ics = build([]);
  assert.equal(ics.includes('BEGIN:VEVENT'), false);
  assert.equal(ics.includes('BEGIN:VCALENDAR'), true);
});

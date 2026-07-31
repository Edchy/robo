/**
 * Regression tests against the real August 2026 schedule.
 *
 *   node --test src/schedule.test.mts
 *
 * Set ROSENBO_PDF to point at the source PDF; the test skips if absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseSchedule, shiftsFor, workdaysOf, splitHours, continuesTomorrow, type TextItem } from './schedule.ts';

const PDF =
  process.env.ROSENBO_PDF ??
  `${process.env.HOME}/Downloads/Rosenbo-Schema Augusti 2026 x-2.pdf`;

const available = fs.existsSync(PDF);

async function load() {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(PDF)) }).promise;
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const item of content.items as { str?: string; transform?: number[] }[]) {
      if (!item.str?.trim() || !item.transform) continue;
      items.push({ x: item.transform[4], y: item.transform[5], s: item.str });
    }
  }
  return parseSchedule(items);
}

test('parses the full month with no coverage gaps', { skip: !available }, async () => {
  const s = await load();
  assert.equal(s.days.length, 31);
  assert.equal(s.monthLabel, 'Augusti 2026');
  assert.deepEqual(s.warnings, []);
  assert.equal(s.days.every((d) => d.lines.length === 2), true);
});

test('excludes AU from the staff list', { skip: !available }, async () => {
  const s = await load();
  assert.equal(s.people.includes('AU'), false);
  assert.deepEqual(s.people, [
    'AH', 'AZ', 'BEL', 'CT', 'DV', 'ES', 'FF', 'KA', 'KIA', 'LF', 'MAS', 'NZ', 'RR',
  ]);
});

test('ES totals 178 h across 22 shifts', { skip: !available }, async () => {
  const s = await load();
  const shifts = shiftsFor(s, 'ES');
  assert.equal(shifts.reduce((a, x) => a + x.hours, 0), 178);
  // 22, not 18: nights are two rows in the PDF and stay two rows here.
  assert.equal(shifts.length, 22);
});

test('merges adjacent blocks into one shift', { skip: !available }, async () => {
  const s = await load();
  // Aug 1 is three cells in the PDF (09:00–18:00, 18:00–23:30, 23:30–24:00).
  const first = shiftsFor(s, 'ES')[0];
  assert.deepEqual(
    { start: first.start, end: first.end, hours: first.hours },
    { start: '09:00', end: '24:00', hours: 15 }
  );
});

test('never stitches a shift across midnight', { skip: !available }, async () => {
  const s = await load();
  const shifts = shiftsFor(s, 'ES');
  // Every night is two rows in the PDF and stays two rows here, whatever hour
  // it began — so a morning-start (Aug 1) and an evening-start (Aug 3) split
  // the same way. Nothing may run past midnight.
  assert.equal(shifts.every((x) => !x.endsNextDay), true);

  const at = (day: number) => shifts.find((x) => x.dayNum === day)!;
  assert.deepEqual({ start: at(1).start, end: at(1).end }, { start: '09:00', end: '24:00' });
  assert.deepEqual({ start: at(2).start, end: at(2).end }, { start: '00:00', end: '09:00' });
  assert.deepEqual({ start: at(3).start, end: at(3).end }, { start: '16:00', end: '24:00' });
  assert.deepEqual({ start: at(4).start, end: at(4).end }, { start: '00:00', end: '08:00' });
});

test('ES works 14 days, six of which only finish a night', { skip: !available }, async () => {
  const s = await load();
  const shifts = shiftsFor(s, 'ES');
  const work = workdaysOf(shifts);
  assert.equal(work.size, 14);
  // Aug 2, 4, 12, 16, 18 and 21 hold hours but are not days ES travels in.
  for (const d of [2, 4, 12, 16, 18, 21]) {
    assert.equal(work.has(d), false, `day ${d} should not be a workday`);
  }
  // Day 11 is two separate trips; day 10 is a single one-hour trip.
  assert.equal(work.has(10), true);
  assert.equal(work.has(11), true);
});

test('jour is the night half of line 1, not the whole line', { skip: !available }, async () => {
  const s = await load();

  // KA is the month's jour-heavy person: on call 22:00–24:00 and again from
  // 00:00 to the morning handover, night after night.
  const ka = shiftsFor(s, 'KA');
  const kaNight = ka.find((x) => x.dayNum === 6 && x.start === '00:00')!;
  assert.equal(kaNight.standby, true);
  assert.equal(ka.find((x) => x.dayNum === 5 && x.start === '22:00')!.standby, true);

  // Those hours are on call, not worked, so they must not inflate the totals
  // or make a day look like one KA travelled in for.
  const split = splitHours(ka);
  assert.ok(split.standby > split.worked, 'KA is mostly on call');
  assert.equal(workdaysOf(ka).has(6), false, 'a jour-only day is not a workday');

  // Line 1 also carries ordinary daytime work: ES is awake at work 09:00–22:00
  // on the 8th, on the same line KA's jour sits on.
  const es = shiftsFor(s, 'ES');
  assert.equal(es.find((x) => x.dayNum === 8)!.standby, false);
  assert.equal(splitHours(es).standby, 0, 'ES never holds jour');

  // A morning block on line 1 is only a jour tail if a jour night preceded it.
  // ES's lone 07:00–08:00 on the 10th follows nothing, so it is a trip in.
  assert.equal(es.find((x) => x.dayNum === 10)!.standby, false);
  assert.equal(workdaysOf(es).has(10), true);
});

test('an evening worked to 22:00 then jour is not a worked night', { skip: !available }, async () => {
  const s = await load();
  const ah = shiftsFor(s, 'AH');

  // Aug 3: AH is at work 16:00–22:00, then on call. The jour block runs to
  // midnight and picks up at 00:00, so the day does cross midnight — but
  // nobody worked through it, which is what the calendar colours on.
  const worked = ah.find((x) => x.dayNum === 3 && x.start === '16:00')!;
  const onCall = ah.find((x) => x.dayNum === 3 && x.start === '22:00')!;
  assert.equal(worked.standby, false);
  assert.equal(onCall.standby, true);
  assert.equal(continuesTomorrow(onCall, ah), true, 'the jour half does span midnight');
  assert.equal(
    ah.some((x) => x.dayNum === 3 && !x.standby && continuesTomorrow(x, ah)),
    false,
    'no awake shift crosses midnight, so day 3 is not a nattpass'
  );

  // Every block running to midnight from 21:00 or 22:00 is jour, whoever holds
  // it — the awake row only ever hands over at 23:30.
  for (const person of s.people) {
    for (const x of shiftsFor(s, person)) {
      if (x.end === '24:00' && (x.start === '21:00' || x.start === '22:00'))
        assert.equal(x.standby, true, `${person} d${x.dayNum} ${x.start} should be jour`);
    }
  }
});

test('reports co-workers on shared slots', { skip: !available }, async () => {
  const s = await load();
  // DV shares KA's 07:00–08:00 cell on day 6; without midnight stitching that
  // stays on day 6 rather than folding back into day 5's evening.
  const shared = shiftsFor(s, 'KA').find((x) => x.dayNum === 6)!;
  assert.deepEqual(shared.sharedWith, ['DV']);
  // BEL only ever appears in shared KA/BEL cells.
  assert.equal(shiftsFor(s, 'BEL').every((x) => x.sharedWith.includes('KA')), true);
});

test('merging preserves total hours', { skip: !available }, async () => {
  const s = await load();
  for (const person of s.people) {
    const merged = shiftsFor(s, person).reduce((a, x) => a + x.hours, 0);
    let raw = 0;
    for (const day of s.days)
      for (const line of day.lines)
        for (const b of line.blocks)
          if (b.codes.includes(person)) raw += b.hours;
    assert.equal(merged, raw, `${person}: merged ${merged} h != raw ${raw} h`);
  }
});

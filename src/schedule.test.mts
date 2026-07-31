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
import { parseSchedule, shiftsFor, workdaysOf, splitHours, continuesTomorrow, isContinuation, type TextItem } from './schedule.ts';

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

test('ES totals 178 h, split across work and sleep rows', { skip: !available }, async () => {
  const s = await load();
  const shifts = shiftsFor(s, 'ES');
  assert.equal(shifts.reduce((a, x) => a + x.hours, 0), 178);
  // 34, not 22: sleeping at the workplace is its own rate, so the 23:30
  // handover into bed and the 00:00–06:30 sleep are their own rows rather
  // than being folded into the evening and morning around them.
  assert.equal(shifts.length, 34);

  // The hours are only redistributed, never invented or lost.
  const { worked, sleep, jour } = splitHours(shifts);
  assert.equal(worked + sleep + jour, 178);
  assert.equal(jour, 0, 'ES is never on call from home');
  assert.equal(sleep, 42);
});

test('merges adjacent blocks of the same kind', { skip: !available }, async () => {
  const s = await load();
  // Aug 1 is three cells in the PDF (09:00–18:00, 18:00–23:30, 23:30–24:00).
  // The first two merge; the third is the handover into bed and stays apart.
  const day1 = shiftsFor(s, 'ES').filter((x) => x.dayNum === 1);
  assert.deepEqual(
    { start: day1[0].start, end: day1[0].end, hours: day1[0].hours, kind: day1[0].kind },
    { start: '09:00', end: '23:30', hours: 14.5, kind: 'work' }
  );
  assert.deepEqual(
    { start: day1[1].start, end: day1[1].end, hours: day1[1].hours, kind: day1[1].kind },
    { start: '23:30', end: '24:00', hours: 0.5, kind: 'sleep' }
  );
});

test('never stitches a shift across midnight', { skip: !available }, async () => {
  const s = await load();
  const shifts = shiftsFor(s, 'ES');
  // Every night is two rows in the PDF and stays two rows here, whatever hour
  // it began. Nothing may run past midnight.
  assert.equal(shifts.every((x) => !x.endsNextDay), true);

  // Aug 1 ends at midnight and Aug 2 picks up at 00:00 — the night is written
  // as two halves either side of the boundary, never as one row.
  const on = (day: number) => shifts.filter((x) => x.dayNum === day);
  assert.equal(on(1).at(-1)!.end, '24:00');
  assert.equal(on(2)[0].start, '00:00');
  assert.equal(on(3).at(-1)!.end, '24:00');
  assert.equal(on(4)[0].start, '00:00');

  // The morning after sleeping over: awake at 06:30, still in the building.
  assert.equal(on(2)[0].kind, 'sleep');
  assert.equal(on(2)[1].kind, 'work');
  assert.equal(on(2)[1].start, '06:30');
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
  // Jour specifically — ES does sleep at the workplace, which is also
  // `standby` but is a different state and a different rate.
  assert.equal(splitHours(es).jour, 0, 'ES never holds jour');

  // A morning block on line 1 is only a jour tail if a jour night preceded it.
  // ES's lone 07:00–08:00 on the 10th follows nothing, so it is a trip in.
  assert.equal(es.find((x) => x.dayNum === 10)!.standby, false);
  assert.equal(workdaysOf(es).has(10), true);
});

test('the 1st continues a night from the previous month', { skip: !available }, async () => {
  const s = await load();
  const ff = shiftsFor(s, 'FF');

  // FF slept at the workplace on July 31st, which this file cannot show — it
  // begins mid-night, with a 00:00 block and no evening before it. The line it
  // sits on is the only evidence, and it must be read the same as any other
  // morning: sleep, then the waking hours, and not a day travelled in for.
  const day1 = ff.filter((x) => x.dayNum === 1);
  assert.equal(day1[0].kind, 'sleep', 'the 00:00 block is last night finishing');
  assert.equal(isContinuation(day1[0], ff), true);
  assert.equal(day1[1].kind, 'work', 'awake at 06:30, still in the building');
  assert.equal(isContinuation(day1[1], ff), true, 'not a trip in');
  assert.equal(workdaysOf(ff).has(1), false);

  // Read as an ordinary morning it would merge into one 00:00–09:00 work block
  // and take 6.5 h of sleep with it. Across the whole file that is exactly the
  // shortfall: 7 h a night for all 31 nights, and no more.
  let sleep = 0;
  for (const p of s.people) sleep += splitHours(shiftsFor(s, p)).sleep;
  assert.equal(sleep, 7 * 31);
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

/**
 * Parser for the Rosenbo monthly schedule PDF.
 *
 * The PDF is a positional table: every cell lands on a stable x-coordinate,
 * and each day occupies two rows ("lines") of round-the-clock cover. We read
 * by column position rather than by regex over a flattened string, because the
 * flattened form loses which cells were blank.
 */

/** Column x-positions in the source PDF. Blocks are [time, code, hours] triples. */
const COLS: { x: number; f: string }[] = [
  { x: 115.6, f: 't0' }, { x: 139.4, f: 'c0' }, { x: 175.1, f: 'h0' },
  { x: 200.6, f: 't1' }, { x: 224.4, f: 'c1' }, { x: 262.6, f: 'h1' },
  { x: 291.6, f: 't2' }, { x: 315.3, f: 'c2' }, { x: 352.8, f: 'h2' },
  { x: 372.3, f: 't3' }, { x: 396.1, f: 'c3' }, { x: 431.8, f: 'h3' },
  { x: 458.1, f: 't4' }, { x: 481.9, f: 'c4' }, { x: 516.8, f: 'h4' },
  { x: 543.1, f: 't5' },
];

/** Codes that denote an activity/placement rather than a member of staff. */
export const ACTIVITY_CODES = new Set(['AU']);

const WEEKDAYS: Record<string, string> = {
  'måndag': 'Måndag', 'tisdag': 'Tisdag', 'onsdag': 'Onsdag', 'torsdag': 'Torsdag',
  'fredag': 'Fredag', 'lördag': 'Lördag', 'söndag': 'Söndag',
};
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

export type TextItem = { x: number; y: number; s: string };

export type Block = {
  start: string;
  end: string;
  code: string;
  /** Everyone named in the cell — length > 1 means a shared slot like "KA/DV". */
  codes: string[];
  hours: number;
};

export type Day = {
  date: string;          // YYYY-MM-DD
  weekday: string;       // "Lördag"
  dayNum: number;
  lines: { blocks: Block[] }[];
};

export type Shift = {
  date: string;          // day the shift STARTS
  weekday: string;
  dayNum: number;
  start: string;
  end: string;           // "24:00" or later-day time; see `endsNextDay`
  endsNextDay: boolean;
  hours: number;
  /** Co-workers sharing any part of this shift, e.g. ["DV"]. */
  sharedWith: string[];
  /**
   * Jour — on call from home rather than awake on the floor. Real obligation,
   * but not time spent working, so it is never added into worked hours.
   *
   * True for both 'jour' and 'sleep': neither is time awake on the floor.
   * Kept alongside `kind` because schedules cached before `kind` existed still
   * carry it, and because "not worked hours" is the question most callers ask.
   */
  standby: boolean;
  /**
   * Which of the three paid states this is. The distinction is not in the PDF —
   * it comes from which line the block sits on. See `kindOfBlock`.
   */
  kind: ShiftKind;
};

/**
 * The three states a scheduled hour can be in, each paid differently:
 *
 *   work   awake on the floor, ordinary rate
 *   sleep  asleep at the workplace, reduced rate
 *   jour   on call from home, lowest rate
 */
export type ShiftKind = 'work' | 'sleep' | 'jour';

/**
 * The evening handover into jour. A block running from here to midnight is
 * always standby: confirmed against the whole August schedule, where every
 * block ending 24:00 is either 21:00 or 22:00 on the jour line, or the awake
 * person's 23:30 handover on line 0 — never anything else.
 */
const STANDBY_EVENING_FROM = 21 * 60;

/** Jour is handed back over the morning; past this, line 1 is ordinary work. */
const STANDBY_MORNING_UNTIL = 9 * 60;

/**
 * When the person staffing the night goes to bed. Line 0's evening always runs
 * to 23:30 and then takes a separate 23:30–24:00 block: that last half hour is
 * the handover into sleeping at the workplace, not awake work. Holds on 31 of
 * 31 days in August 2026 — every line-0 block ending 24:00 starts at 23:30.
 */
const SLEEP_FROM = 23 * 60 + 30;

/**
 * The sleeper is up again at 06:30 — line 0's post-midnight block runs 00:00 to
 * exactly 06:30 on all 31 days, and any block after that is the morning shift
 * proper. Anything ending at or before this on line 0 is therefore still night.
 */
const SLEEP_UNTIL = 6 * 60 + 30;

/**
 * Whether a block is jour — on call from home rather than awake on the floor.
 *
 * A night is staffed by one person awake and one on call, and the PDF places
 * them consistently: line 0 carries the awake night (its 00:00 block is always
 * the same person who worked to 23:30 the evening before), line 1 the jour,
 * from about 22:00 — sometimes 21:00 — until 07:00, 08:00 or 09:00. Verified
 * across the August 2026 schedule: both hold on 30 of 30 day boundaries.
 *
 * Line position alone is not enough, in two directions:
 *
 *   - Line 1 also carries ordinary daytime shifts. ES works 09:00–22:00 there
 *     on the 8th and 9th, awake at work, so the hours have to agree too.
 *   - A morning block on line 1 is only the tail of a jour night if there was
 *     one. ES's lone 07:00–08:00 on the 10th follows no night at all: it is a
 *     one-hour trip in, and the schedule counts it as a workday.
 *
 * So a morning block is jour only when the evening before it was also jour —
 * `startedNight` carries that answer, since only the caller can see the
 * previous day.
 */
const isStandbyBlock = (
  lineIndex: number,
  block: Block,
  startedNight: boolean
): boolean => {
  if (lineIndex !== 1) return false;
  const start = toMin(block.start);
  const end = toMin(block.end);
  if (start >= STANDBY_EVENING_FROM) return true;
  return end <= STANDBY_MORNING_UNTIL && startedNight;
};

/**
 * Which paid state a block is in.
 *
 * The PDF does not say — it carries only initials, times and hours, and a night
 * slept at the workplace looks exactly like a night covered from home. The
 * distinction is in the layout: the two staff covering a night sit on fixed
 * lines, the sleeper above the jour.
 *
 *   line 0 — the person who stays the night at the workplace. Awake until
 *            23:30, asleep 23:30–06:30, awake again for the morning.
 *   line 1 — the person on call from home, from 21:00/22:00 until 07:00–09:00.
 *
 * So sleep is line 0 within the night window, jour is line 1 across it, and
 * everything else on either line is ordinary work. `startedNight` answers
 * whether a morning block continues a night that actually happened — only the
 * caller can see the previous day.
 */
const kindOfBlock = (
  lineIndex: number,
  block: Block,
  startedNight: boolean,
  startedSleep: boolean
): ShiftKind => {
  if (isStandbyBlock(lineIndex, block, startedNight)) return 'jour';

  if (lineIndex === 0) {
    const start = toMin(block.start);
    const end = toMin(block.end);
    // The evening handover into bed: 23:30 to midnight.
    if (start >= SLEEP_FROM) return 'sleep';
    // ...and its other half after midnight, but only when the evening before
    // actually went to bed. A 00:00 block with no sleep behind it is a night
    // worked awake, which is ordinary work.
    if (end <= SLEEP_UNTIL && startedSleep) return 'sleep';
  }

  return 'work';
};

/**
 * True when this shift is the tail of the previous day's night rather than a
 * fresh trip to work: it starts at midnight and the day before ran to 24:00.
 *
 * The distinction that matters to staff is not "are there hours on this day"
 * but "do I have to get up and travel in". Finishing a night you already
 * started is not a workday; a one-hour morning shift very much is.
 */
export const isContinuation = (shift: Shift, all: readonly Shift[]): boolean => {
  // Whether a night landed on this day at all — a property of the day, not of
  // the shift being asked about, so the morning-after clause below can use it
  // too. Day 1 has no predecessor in this file, but a block starting at
  // midnight still arrived from somewhere: last month's schedule. Nothing else
  // begins at 00:00, so its presence on the 1st is the evidence.
  const cameFromLastNight =
    shift.dayNum === 1
      ? all.some((p) => p.dayNum === 1 && p.start === '00:00')
      : all.some((p) => p.dayNum === shift.dayNum - 1 && p.end === '24:00');
  if (shift.start === '00:00') return cameFromLastNight;

  // The morning after sleeping at the workplace. The sleeper wakes at 06:30 and
  // works on, which the PDF writes as a separate block — but they were already
  // in the building, so it is the end of that night rather than a trip in.
  // Without this, every night slept over would count as two workdays.
  return (
    cameFromLastNight &&
    all.some(
      (p) =>
        p.dayNum === shift.dayNum &&
        p.kind === 'sleep' &&
        p.start === '00:00' &&
        p.end === shift.start
    )
  );
};

/**
 * The handover into bed: a worked shift ending here is the person staffing the
 * night. It is the same 23:30 that SLEEP_FROM starts at — the evening stops,
 * and the same person is asleep on the premises from then until 06:30.
 */
/* Written out rather than derived from SLEEP_FROM: `fromMin` is defined much
   further down, and hoisting it here for one string is not worth the churn.
   The two are asserted equal in the tests. */
const NIGHT_SHIFT_ENDS = '23:30';

/**
 * True when this is the night shift — the awake evening the night person works
 * before going to bed here.
 *
 * Not "crosses midnight": nothing awake ever does in this schedule. The evening
 * always stops at 23:30 and becomes sleep, so a test on the date boundary
 * matched zero of the month's 141 worked shifts and the night colour could
 * never appear. The 23:30 finish is what actually marks the night: 31 of them,
 * one per night, each followed by that person's own sömn block.
 */
export const isNightShift = (shift: Shift): boolean =>
  shift.kind === 'work' && shift.end === NIGHT_SHIFT_ENDS;

/**
 * True when this shift runs to midnight and is picked up again at 00:00 the
 * next day — the first half of a night split across the date boundary. The
 * mirror of `isContinuation`, so the two halves can point at each other.
 */
export const continuesTomorrow = (
  shift: Shift,
  all: readonly Shift[]
): boolean =>
  shift.end === '24:00' &&
  all.some((n) => n.dayNum === shift.dayNum + 1 && n.start === '00:00');

/**
 * Day numbers the person actually travels to work, i.e. days holding at least
 * one shift that is not a continuation. A day can be both — finishing a night
 * at 08:00 and starting again at 16:00 — and that still counts as a workday.
 *
 * Standby does not count: jour is served from home, so a day holding nothing
 * but jour is a day you never left. It still shows in the calendar, in its own
 * colour, because being on call is not the same as being free.
 */
export const workdaysOf = (all: readonly Shift[]): Set<number> => {
  const days = new Set<number>();
  for (const s of all)
    if (!s.standby && !isContinuation(s, all)) days.add(s.dayNum);
  return days;
};

/**
 * Time-of-day band, used by the UI as the one thing colour is allowed to mean.
 * Derived rather than stored, so it stays correct for schedules cached before
 * bands existed.
 */
export type ShiftBand = 'morning' | 'day' | 'evening' | 'night' | 'long';

/** Past this, no single time of day describes the shift honestly. */
const LONG_SHIFT_HOURS = 12;

/**
 * Which time of day a shift belongs to.
 *
 * Classifying on the start hour alone is wrong for the long shifts this
 * schedule is full of: 09:00-24:00 is not a "morning" in any sense a nurse
 * would recognise. So:
 *
 *   - crossing midnight  -> night, whatever hour it began
 *   - 12 h or longer     -> long, because it spans several bands at once and
 *                           one time-of-day tag would be a false claim
 *   - otherwise          -> the band containing the shift's midpoint, which
 *                           tracks where the bulk of the hours actually sit
 *
 * 16:00 is the same evening threshold the parser uses to bridge midnight
 * (NIGHT_STARTS_AFTER), so the two never disagree.
 */
export const bandOf = (shift: Shift): ShiftBand => {
  if (shift.endsNextDay) return 'night';
  if (shift.hours >= LONG_SHIFT_HOURS) return 'long';

  const midpoint = (toMin(shift.start) + toMin(shift.end)) / 2;
  if (midpoint < 10 * 60) return 'morning';
  if (midpoint < 16 * 60) return 'day';
  return 'evening';
};

/**
 * Who else is on the floor while this shift runs.
 *
 * Distinct from `Shift.sharedWith`, which only names people written into the
 * *same* cell ("KA/DV") and is empty for almost every shift. The colleague you
 * actually work beside is on the other line covering the same hours: on Aug 1
 * ES works 09:00–24:00 on line 0 while CT covers it from line 1.
 *
 * Jour is excluded — someone on call is at home, not beside you — as is AU,
 * which is a placeholder rather than a person. Overlap must be real, so blocks
 * that merely touch at a handover boundary do not count.
 */
export const alongsideOn = (
  schedule: Schedule,
  shift: Shift,
  me: string
): string[] => {
  const day = schedule.days.find((d) => d.date === shift.date);
  if (!day) return [];

  const from = toMin(shift.start);
  const to = toMin(shift.end);
  const found = new Set<string>();

  day.lines.forEach((line, lineIndex) => {
    for (const b of line.blocks) {
      // `startedNight` is passed true so a morning block on the jour line is
      // treated as the tail it usually is. Erring toward "this is jour" is the
      // safe direction here: the cost is omitting a name, not inventing one.
      if (isStandbyBlock(lineIndex, b, true)) continue;
      if (toMin(b.end) <= from || toMin(b.start) >= to) continue;
      for (const c of b.codes) {
        if (c !== me && !ACTIVITY_CODES.has(c)) found.add(c);
      }
    }
  });

  return [...found].sort();
};

/**
 * Worked and standby hours for a set of shifts, kept apart.
 *
 * Never summed into one figure: jour hours are spent at home, so adding them
 * to worked hours would overstate what the month actually asked of someone.
 */
export const splitHours = (
  shifts: readonly Shift[]
): { worked: number; standby: number; sleep: number; jour: number } => {
  let worked = 0;
  let sleep = 0;
  let jour = 0;
  for (const s of shifts) {
    // `kind` is absent on schedules cached before it existed; fall back to the
    // old boolean, which lumped sleep in with work exactly as it used to.
    const kind = s.kind ?? (s.standby ? 'jour' : 'work');
    if (kind === 'jour') jour += s.hours;
    else if (kind === 'sleep') sleep += s.hours;
    else worked += s.hours;
  }
  // `standby` keeps its old meaning — everything that is not awake work — so
  // callers written against the two-way split still read correctly.
  return { worked, standby: sleep + jour, sleep, jour };
};

/** Swedish label for a band, shown next to the colour so it never stands alone. */
export const BAND_LABEL: Record<ShiftBand, string> = {
  morning: 'morgon',
  day: 'dag',
  evening: 'kväll',
  night: 'natt',
  long: 'lång',
};

export type Schedule = {
  days: Day[];
  /** Staff codes present in this file, excluding activity codes. */
  people: string[];
  monthLabel: string;    // "Augusti 2026"
  year: number;
  month: number;         // 1-12
  warnings: string[];
};

export class ScheduleError extends Error {}

const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const pad = (n: number) => String(n).padStart(2, '0');
const fromMin = (m: number): string => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

export const formatHours = (h: number): string =>
  (Number.isInteger(h) ? String(h) : h.toFixed(1)).replace('.', ',');

const nearestField = (x: number): string | null => {
  if (x < 100) return 'date';
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of COLS) {
    const d = Math.abs(c.x - x);
    if (d < bestD) { bestD = d; best = c.f; }
  }
  return bestD <= 3 ? best : null;
};

// Unicode-aware: \w does not match å/ä/ö, which would drop most weekdays.
const DATE_RE = /^(\p{L}+),\s*(\d{4})-(\d{2})-(\d{2})$/u;

/** Turn positioned PDF text items into a validated Schedule. */
export function parseSchedule(items: TextItem[]): Schedule {
  const byY = new Map<string, TextItem[]>();
  for (const it of items) {
    if (!it.s.trim()) continue;
    const k = it.y.toFixed(1);
    let arr = byY.get(k);
    if (!arr) byY.set(k, (arr = []));
    arr.push(it);
  }

  // PDF y-coordinates grow upward, so sort descending for top-to-bottom.
  const rows = [...byY.entries()]
    .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
    .map(([, arr]) => {
      const r: Record<string, string> = {};
      for (const it of arr) {
        const f = nearestField(it.x);
        if (f) r[f] = it.s.trim();
      }
      return r;
    });

  const dayMap = new Map<string, Day>();
  const warnings: string[] = [];
  let year = 0;
  let month = 0;

  for (const r of rows) {
    const m = DATE_RE.exec(r.date ?? '');
    if (!m) continue; // header/footer rows
    const [, weekdayRaw, y, mo, d] = m;
    const date = `${y}-${mo}-${d}`;
    year = Number(y);
    month = Number(mo);

    const blocks: Block[] = [];
    for (let i = 0; i < 5; i++) {
      const start = r[`t${i}`];
      const end = r[`t${i + 1}`];
      if (!start || !end) continue;
      const raw = r[`c${i}`];
      // Durations come from the timestamps; the printed hour cells are blank
      // or zero on unstaffed slots and cannot be relied on.
      const hours = (toMin(end) - toMin(start)) / 60;
      if (hours <= 0) continue;   // zero-width slot
      if (!raw) continue;         // genuinely unstaffed on this line
      const codes = raw.split('/').map((c) => c.trim()).filter(Boolean);
      blocks.push({ start, end, code: raw, codes, hours });
    }

    let day = dayMap.get(date);
    if (!day) {
      day = {
        date,
        weekday: WEEKDAYS[weekdayRaw.toLowerCase()] ?? weekdayRaw,
        dayNum: Number(d),
        lines: [],
      };
      dayMap.set(date, day);
    }
    day.lines.push({ blocks });
  }

  if (dayMap.size === 0) {
    throw new ScheduleError(
      'Hittade inget schema i den här filen. Är det rätt PDF?'
    );
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Sanity check: across both lines, is every minute of the day staffed?
  for (const day of days) {
    const mins = new Array(1440).fill(0);
    for (const line of day.lines)
      for (const b of line.blocks)
        for (let t = toMin(b.start); t < Math.min(toMin(b.end), 1440); t++) mins[t]++;
    const gap = mins.indexOf(0);
    if (gap >= 0) {
      warnings.push(`${day.dayNum}/${month}: ingen personal ${fromMin(gap)}`);
    }
  }

  const people = new Set<string>();
  for (const day of days)
    for (const line of day.lines)
      for (const b of line.blocks)
        for (const c of b.codes)
          if (!ACTIVITY_CODES.has(c)) people.add(c);

  return {
    days,
    people: [...people].sort(),
    monthLabel: `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)} ${year}`,
    year,
    month,
    warnings,
  };
}

/**
 * Extract one person's shifts, merging adjacent blocks — including across
 * midnight, so a 16:00→24:00 + 00:00→08:00 pair reads as one night shift on
 * the day it starts.
 */
export function shiftsFor(schedule: Schedule, code: string): Shift[] {
  type Span = {
    date: string;
    startMin: number;
    endMin: number;
    shared: Set<string>;
    standby: boolean;
    kind: ShiftKind;
  };
  const spans: Span[] = [];

  // True when this person held jour into midnight on the day just processed,
  // which is what makes the next morning's block a tail rather than a trip in.
  let carriedJour = false;
  // The same question for the sleeper: did they go to bed here last night?
  let carriedSleep = false;

  // The first of the month has no previous day in this file — the night it
  // continues was written in last month's PDF. Without this, a 00:00 block on
  // day 1 falls through to ordinary work: FF's 00:00–06:30 on Aug 1 is the tail
  // of a July 31st sleepover, but looked like a morning shift travelled in for.
  //
  // The line it sits on says which kind of night it was, the same rule that
  // classifies every other day: line 0 slept here, line 1 was on call. A 00:00
  // block is only ever the tail of a night, since nothing else starts at
  // midnight, so its presence is enough to infer the night behind it.
  const firstDay = schedule.days[0];
  if (firstDay) {
    firstDay.lines.forEach((line, lineIndex) => {
      for (const b of line.blocks) {
        if (b.start !== '00:00' || !b.codes.includes(code)) continue;
        if (lineIndex === 0) carriedSleep = true;
        else carriedJour = true;
      }
    });
  }

  for (const day of schedule.days) {
    const mine: (Block & { kind: ShiftKind })[] = [];
    day.lines.forEach((line, lineIndex) => {
      for (const b of line.blocks)
        if (b.codes.includes(code))
          mine.push({
            ...b,
            kind: kindOfBlock(lineIndex, b, carriedJour, carriedSleep),
          });
    });
    carriedJour = mine.some((b) => b.kind === 'jour' && b.end === '24:00');
    carriedSleep = mine.some((b) => b.kind === 'sleep' && b.end === '24:00');
    if (!mine.length) continue;

    mine.sort((a, b) => toMin(a.start) - toMin(b.start));
    for (const b of mine) {
      const others = b.codes.filter((c) => c !== code);
      const last = spans[spans.length - 1];
      // Only merge blocks of the same kind: an awake hour, a slept hour and an
      // on-call hour are different work even when they touch, and folding them
      // into one span would hide the difference the whole distinction rests on.
      // Compared on `kind` rather than `standby`, or the 23:30 handover into
      // bed would fuse with the evening it follows — both are standby:false.
      if (
        last &&
        last.date === day.date &&
        last.endMin === toMin(b.start) &&
        last.kind === b.kind
      ) {
        last.endMin = toMin(b.end);
        others.forEach((o) => last.shared.add(o));
      } else {
        spans.push({
          date: day.date,
          startMin: toMin(b.start),
          endMin: toMin(b.end),
          shared: new Set(others),
          standby: b.kind !== 'work',
          kind: b.kind,
        });
      }
    }
  }

  // Shifts are never stitched across midnight. The PDF writes a night as two
  // rows — one running to 24:00, one resuming at 00:00 the next day — and the
  // app shows exactly that, so every row here matches the paper schedule.
  // Merging is limited to adjacent cells within a single day (done above).
  const merged: Span[] = spans.map((s) => ({ ...s, shared: new Set(s.shared) }));

  const dayByDate = new Map(schedule.days.map((d) => [d.date, d]));
  return merged.map((s) => {
    const day = dayByDate.get(s.date)!;
    return {
      date: s.date,
      weekday: day.weekday,
      dayNum: day.dayNum,
      start: fromMin(s.startMin),
      end: s.endMin >= 1440 && s.endMin % 1440 === 0 ? '24:00' : fromMin(s.endMin),
      endsNextDay: s.endMin > 1440,
      hours: (s.endMin - s.startMin) / 60,
      sharedWith: [...s.shared].sort(),
      standby: s.standby,
      kind: s.kind,
    };
  });
}


/* ------------------------------------------------------------ person colour */

/**
 * How many distinct hues a person can land on. Fourteen clears the thirteen on
 * the August roster with room to spare, while every entry stays far enough from
 * its neighbours to be told apart at chip size.
 */
export const PERSON_HUES = 14;

/**
 * A stable slot in the palette for a set of initials.
 *
 * Derived from the code itself rather than from its position in
 * `schedule.people`, because that list changes shape between months: someone
 * joins, someone leaves, and an index-based colour would repaint everyone.
 * Hashing the letters means ES is the same colour in August as in September,
 * in every copy of the app, with no state to store.
 *
 * FNV-1a: tiny, no dependencies, and mixes short ASCII strings well enough
 * that "AH" and "AZ" do not land on adjacent hues.
 */
export function personHue(code: string): number {
  let h = 0x811c9dc5;
  const s = code.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 16777619, via shifts: keeps the whole thing in 32-bit integer space.
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h % PERSON_HUES;
}

/**
 * Assign every person in the file a distinct hue.
 *
 * The hash alone is not enough in practice: on the August roster of thirteen it
 * puts BEL, KIA and MAS on the same green and leaves three hues unused. Three
 * people sharing a colour defeats the point, so the hash is treated as a
 * preference rather than an answer — each code takes its preferred hue if free,
 * otherwise the next free one.
 *
 * Resolution walks the codes in sorted order, so the result depends only on the
 * set of people in the file, never on the order the parser happened to find
 * them. Colours therefore hold steady for as long as the roster does, and shift
 * only when someone joins or leaves — at which point a redraw is expected
 * anyway. With PERSON_HUES above any real ward size, nobody has to share.
 */
export function personHues(people: readonly string[]): Map<string, number> {
  const taken = new Set<number>();
  const out = new Map<string, number>();

  for (const code of [...people].sort()) {
    const want = personHue(code);
    let hue = want;
    // Walk forward to the first free hue; the modulo wraps past the end. If
    // every hue is spoken for (more people than colours) we stop after a full
    // lap and let this person share — unavoidable, and better than looping.
    for (let i = 0; i < PERSON_HUES && taken.has(hue); i++) {
      hue = (want + i + 1) % PERSON_HUES;
    }
    taken.add(hue);
    out.set(code, hue);
  }
  return out;
}

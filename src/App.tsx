import { useEffect, useMemo, useRef, useState } from 'react';
import { readSchedulePdf } from './pdf';
import {
  formatHours,
  shiftsFor,
  isContinuation,
  continuesTomorrow,
  isNightShift,
  personHues,
  workdaysOf,
  splitHours,
  alongsideOn,
  ScheduleError,
  type Schedule,
  type Shift,
} from './schedule';
import {
  clearSchedule,
  forgetAll,
  loadMe,
  loadSchedule,
  saveMe,
  saveSchedule,
} from './storage';
import './App.css';

export default function App() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the last month so the PDF need not be dropped again. Anything
  // expired or unreadable is cleared by loadSchedule itself.
  useEffect(() => {
    setMe(loadMe());
    setSchedule(loadSchedule());
  }, []);

  const choosePerson = (code: string) => {
    setMe(code);
    saveMe(code);
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await readSchedulePdf(file);
      setSchedule(parsed);
      saveSchedule(parsed);
      // Keep a remembered person only if they appear in this month's file.
      const saved = loadMe();
      setMe(saved && parsed.people.includes(saved) ? saved : null);
    } catch (e) {
      setError(
        e instanceof ScheduleError
          ? e.message
          : 'Något gick fel när filen lästes. Försök igen.'
      );
      setSchedule(null);
    } finally {
      setBusy(false);
    }
  };

  if (!schedule) {
    return <Dropzone onFile={handleFile} busy={busy} error={error} />;
  }
  if (!me) {
    return (
      <PersonPicker
        schedule={schedule}
        onPick={choosePerson}
        onBack={() => setSchedule(null)}
      />
    );
  }
  return (
    <MonthView
      schedule={schedule}
      me={me}
      onChangePerson={() => setMe(null)}
      onNewFile={() => {
        // Drop the cache as well, or a refresh would bring back the month the
        // user just dismissed.
        clearSchedule();
        setSchedule(null);
        setError(null);
      }}
      onForget={() => {
        // Remove everything stored on the device, so a shared phone is left
        // with nothing of this user.
        forgetAll();
        setMe(null);
        setSchedule(null);
        setError(null);
      }}
    />
  );
}

/* ---------------------------------------------------------------- dropzone */

function Dropzone({
  onFile,
  busy,
  error,
}: {
  onFile: (f: File) => void;
  busy: boolean;
  error: string | null;
}) {
  const [over, setOver] = useState(false);

  return (
    <main className="shell shell--center">
      <div className="intro">
        <h1 className="intro__title">Mitt schema</h1>
        <p className="intro__sub">
          Släpp månadens schema-PDF här så visas bara dina pass.
        </p>
      </div>

      <label
        className={`drop ${over ? 'drop--over' : ''} ${busy ? 'drop--busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        <input
          type="file"
          accept="application/pdf,.pdf"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
        <span className="drop__icon" aria-hidden="true">
          {busy ? <Spinner /> : <DocIcon />}
        </span>
        <span className="drop__lead">
          {busy ? 'Läser schemat…' : 'Släpp PDF-filen här'}
        </span>
        {!busy && <span className="drop__hint">eller tryck för att välja fil</span>}
      </label>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <details className="privacy">
        <summary className="privacy__line">
          <LockIcon /> Filen stannar i din telefon — inget laddas upp.
        </summary>
        <div className="privacy__body">
          <p>
            Schemat läses direkt i telefonen eller datorn. PDF-filen skickas
            aldrig vidare — varken till oss, till arbetsgivaren eller till någon
            annan. Appen fungerar även i flygplansläge när sidan väl har
            laddats.
          </p>
          <p>
            För att du inte ska behöva leta upp PDF-filen varje gång sparas
            månadens schema och dina initialer i webbläsaren — på din egen
            enhet. Själva PDF-filen sparas aldrig, och schemat raderas
            automatiskt när månaden är slut. Trycker du på{' '}
            <strong>Glöm mig</strong> försvinner allt direkt.
          </p>
          <p>
            Tänk på att PDF-filen innehåller <em>hela</em> arbetsplatsens schema,
            precis som när du får den via mejl. Appen visar bara dina pass — men
            filen i sig är densamma. Dela den därför inte vidare.
          </p>
        </div>
      </details>
    </main>
  );
}

/* ------------------------------------------------------------------ picker */

function PersonPicker({
  schedule,
  onPick,
  onBack,
}: {
  schedule: Schedule;
  onPick: (code: string) => void;
  onBack: () => void;
}) {
  // Resolved across the whole roster at once, so no two people share a hue.
  const hues = useMemo(() => personHues(schedule.people), [schedule.people]);

  return (
    <main className="shell">
      <header className="head">
        {/* "PDF" names the thing, not the act. The label is short, so the
            accessible name spells out what pressing it does. */}
        <button className="btn" onClick={onBack} aria-label="Byt PDF-fil">
          <span aria-hidden="true">←</span> PDF
        </button>
        <p className="head__title">{schedule.monthLabel}</p>
        {/* Balances the grid so the month stays centred with one button. */}
        <span />
      </header>

      <h2 className="picker__title">Vem är du?</h2>
      <p className="picker__sub">Ditt val sparas till nästa gång.</p>

      <div className="picker__grid">
        {schedule.people.map((code) => (
          <button
            key={code}
            className={`chip p${hues.get(code) ?? 0}`}
            onClick={() => onPick(code)}
          >
            {code}
          </button>
        ))}
      </div>
    </main>
  );
}

/* -------------------------------------------------------------- month view */

const WEEK_HEADS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];
const WEEK_LONG = [
  'måndag',
  'tisdag',
  'onsdag',
  'torsdag',
  'fredag',
  'lördag',
  'söndag',
];

/**
 * Detail for one day, in a native <dialog>. Native rather than a hand-rolled
 * overlay because showModal() brings focus trapping, Escape, inertness of the
 * page behind, and the top layer with it — all things a div would have to
 * reimplement, and get wrong.
 */
function DayDialog({
  day,
  dayShifts,
  allShifts,
  weekdayLong,
  monthLabel,
  schedule,
  me,
  onClose,
}: {
  day: number;
  dayShifts: Shift[];
  allShifts: Shift[];
  weekdayLong: string;
  monthLabel: string;
  schedule: Schedule;
  me: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal() rather than the `open` attribute: only the former puts the
    // dialog in the top layer and makes the rest of the page inert.
    if (!el.open) el.showModal();
  }, []);

  const { worked, sleep, jour } = splitHours(dayShifts);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      /* Fires on Escape and on backdrop dismissal alike, so React state and
         the element's own open/closed state cannot drift apart. */
      onClose={onClose}
      /* The backdrop is part of the dialog's own box, so a click landing on
         the element itself — rather than on the panel inside it — is a click
         outside the content. */
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="sheet__panel">
        {/* The date is the heading, so the number carries the weight and the
            weekday and month sit under it as the qualifiers they are. */}
        <div className="sheet__head">
          <h2 className="sheet__title" id="sheet-title">
            <span className="sheet__day">{day}</span>
            <span className="sheet__when-label">
              <span className="sheet__weekday">{weekdayLong}</span>
              <span className="sheet__month">{monthLabel}</span>
            </span>
          </h2>
          <button
            className="sheet__close"
            onClick={() => ref.current?.close()}
            aria-label="Stäng"
          >
            <CloseIcon />
          </button>
        </div>

        <ul className="sheet__list">
          {dayShifts.map((s, k) => {
            const tail = isContinuation(s, allShifts);
            // Who is on the floor at the same time — the person you actually
            // work beside, which is not the same as sharing a written cell.
            const alongside = alongsideOn(schedule, s, me);
            return (
              <li
                key={k}
                /* One class per state, so each block is filled with the thing
                   it is rather than all three sharing one grey. A worked block
                   that runs through the night takes the deeper night fill, the
                   same step the calendar makes. */
                className={`sheet__shift sheet__shift--${s.kind} ${
                  isNightShift(s) ? 'sheet__shift--night' : ''
                }`}
              >
                <div className="sheet__row">
                  <span className="sheet__time">
                    {s.start} – {s.end}
                    {/* Marks the night shift itself. Not jour or sömn: both
                        are overnight by definition and say so in the tag
                        beside the hours. Same rule as the list. */}
                    {isNightShift(s) && (
                      <span className="sheet__moon" aria-hidden="true">
                        <MoonIcon />
                      </span>
                    )}
                  </span>
                  {/* The tag is a sibling of the hours, not a child: nested, it
                      pushed the figure left, so only the rows without a tag
                      lined up with the right edge. */}
                  {s.standby && (
                    <span className="sheet__tag">
                      {s.kind === 'sleep' ? 'sömn' : 'jour'}
                    </span>
                  )}
                  <span className="sheet__hours">
                    {formatHours(s.hours)} t
                  </span>
                </div>

                {alongside.length > 0 && (
                  <div className="sheet__with">
                    <span className="sheet__with-label">
                      {s.standby ? 'På plats' : 'Med'}
                    </span>
                    {alongside.map((c) => (
                      <span key={c} className="sheet__mate">
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                {s.kind === 'jour' && (
                  <p className="sheet__note">
                    Beredskap hemifrån — inte arbetad tid.
                  </p>
                )}
                {s.kind === 'sleep' && (
                  <p className="sheet__note">
                    Sovande jour på plats — egen ersättning.
                  </p>
                )}
                {tail && !s.standby && (
                  <p className="sheet__note">
                    Forts. från natten innan — du är redan på plats.
                  </p>
                )}
                {/* The night shift hands over to that person's own sömn at
                    23:30, so it does not continue into the next day the way a
                    shift running past midnight would. */}
                {isNightShift(s) && (
                  <p className="sheet__note">Nattpass — du sover här efteråt.</p>
                )}
              </li>
            );
          })}
        </ul>

        {/* The three rates are never added together: an hour asleep here and an
            hour on call at home are not worked hours, so one figure would
            overstate the day. Same words as the month totals above. */}
        <dl className="sheet__facts">
          {/* No unit on these either — the labels say "timmar". */}
          <div className="sheet__fact">
            <dt>Arbetstimmar</dt>
            <dd>{formatHours(worked)}</dd>
          </div>
          {sleep > 0 && (
            <div className="sheet__fact">
              <dt>Sovtimmar</dt>
              <dd>{formatHours(sleep)}</dd>
            </div>
          )}
          {jour > 0 && (
            <div className="sheet__fact">
              <dt>Jourtimmar</dt>
              <dd>{formatHours(jour)}</dd>
            </div>
          )}
        </dl>
      </div>
    </dialog>
  );
}

function MonthView({
  schedule,
  me,
  onChangePerson,
  onNewFile,
  onForget,
}: {
  schedule: Schedule;
  me: string;
  onChangePerson: () => void;
  onNewFile: () => void;
  onForget: () => void;
}) {
  const shifts = useMemo(() => shiftsFor(schedule, me), [schedule, me]);

  // Same roster, same resolution as the picker — so the pill in the header is
  // the colour of the chip that was tapped to get here.
  const myHue = useMemo(
    () => personHues(schedule.people).get(me) ?? 0,
    [schedule.people, me]
  );

  // Every shift sits on the day it is written, nothing is copied forward.
  const byDay = useMemo(() => {
    const map = new Map<number, Shift[]>();
    for (const s of shifts) {
      const arr = map.get(s.dayNum);
      if (arr) arr.push(s);
      else map.set(s.dayNum, [s]);
    }
    return map;
  }, [shifts]);

  // Days the person actually travels in — the calendar's whole point.
  const workdays = useMemo(() => workdaysOf(shifts), [shifts]);

  // The month's three paid states, each at its own rate.
  const totals = useMemo(() => splitHours(shifts), [shifts]);

  const daysInMonth = schedule.days.length;

  // Which day is today — but only when the month on screen is the month we are
  // actually in. Looking at September in August must not put a ring on the 14th.
  // Local date, not UTC: "today" is the user's calendar day, and near midnight
  // the two disagree.
  const today = useMemo(() => {
    const now = new Date();
    return now.getFullYear() === schedule.year && now.getMonth() + 1 === schedule.month
      ? now.getDate()
      : null;
  }, [schedule.year, schedule.month]);

  // Monday-first weekday index (0 = Monday). getUTCDay() is Sunday-0, hence +6.
  const first = new Date(Date.UTC(schedule.year, schedule.month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const weekdayOf = (day: number) => (lead + day - 1) % 7;

  // Which day's detail is open. Null is closed; the day number is enough,
  // since the shifts are looked up from byDay on render.
  const [openDay, setOpenDay] = useState<number | null>(null);

  return (
    <main className="shell">
      <header className="head">
        <button className="btn" onClick={onNewFile} aria-label="Läs in ny PDF-fil">
          <span aria-hidden="true">←</span> PDF
        </button>
        {/* The month sits between the two controls: the thing you are looking
            at, flanked by the two ways to change it. */}
        <h1 className="head__title">{schedule.monthLabel}</h1>
        {/* One grid child, so the header's 1fr/auto/1fr centring still holds.
            The label is visible text, so the button needs no aria-label of its
            own — it is described by the words sitting next to it. */}
        <span className="who">
          <span className="who__label" aria-hidden="true">
            Schema för
          </span>
          {/* Named rather than described: the visible label is hidden on
              phones, and a hidden element describes nothing — so the button
              carries its own name at every width. */}
          <button
            className={`btn btn--me p${myHue}`}
            onClick={onChangePerson}
            aria-label={`Schema för ${me} — byt person`}
          >
            {me}
          </button>
        </span>
      </header>

      {/* The header is hidden on paper, so the printed sheet needs its own
          title — and it is the only place that says whose schedule this is. */}
      <h1 className="month">
        {schedule.monthLabel}
        <span className="month__who"> · {me}</span>
      </h1>

      {/* The month at three rates, each paid differently — an hour awake on the
          floor, an hour asleep here, an hour on call at home. The three are
          exclusive: every scheduled hour lands in exactly one, so they add up.
          Zero rows are dropped rather than shown as "0 h" — most people hold
          only one or two of the three.

          The sum is printed underneath because the cards alone do not say
          whether "Arbete" is the awake hours or the lot. It is a span of time,
          not a payable figure, and says so in words. */}
      <dl className="tot">
        <div className="tot__item">
          {/* No unit on the figure: the label already says "timmar". */}
          <dt className="tot__label">Arbetstimmar</dt>
          <dd className="tot__val">{formatHours(totals.worked)}</dd>
        </div>
        {totals.sleep > 0 && (
          <div className="tot__item tot__item--sleep">
            <dt className="tot__label">Sovtimmar</dt>
            <dd className="tot__val">{formatHours(totals.sleep)}</dd>
          </div>
        )}
        {totals.jour > 0 && (
          <div className="tot__item tot__item--jour">
            <dt className="tot__label">Jourtimmar</dt>
            <dd className="tot__val">{formatHours(totals.jour)}</dd>
          </div>
        )}
      </dl>

      {/* Only worth saying when there is more than one figure to add. The
          figure and its caption are separate so the number can carry the
          weight while the words stay quiet. */}
      {(totals.sleep > 0 || totals.jour > 0) && (
        <p className="tot__sum">
          <span className="tot__sum-val">
            {formatHours(totals.worked + totals.sleep + totals.jour)} timmar
          </span>
          <span className="tot__sum-label">totalt på schemat</span>
        </p>
      )}

      <section className="cal" aria-label="Kalender">
        {WEEK_HEADS.map((d, i) => (
          <span key={i} className="cal__head" aria-hidden="true">
            {d}
          </span>
        ))}

        {Array.from({ length: lead }, (_, i) => (
          <span key={`pad${i}`} className="cal__pad" />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const dayShifts = byDay.get(day) ?? [];
          const wd = weekdayOf(day);
          const isWorkday = workdays.has(day);
          // Trips to work that day — a continuation is not one of them.
          const trips = dayShifts.filter((s) => !isContinuation(s, shifts));

          const isToday = day === today;

          if (dayShifts.length === 0) {
            return (
              <span
                key={day}
                className={`cal__day ${isToday ? 'cal__day--today' : ''}`}
                aria-current={isToday ? 'date' : undefined}
              >
                <span className="cal__num">{day}</span>
              </span>
            );
          }

          // Jour only: on call, but at home. Neither a day you travel in nor a
          // day off, so it takes its own paler fill rather than being lumped
          // in with either.
          const allStandby = dayShifts.every((s) => s.standby);

          // ...but jour also lands on days that are otherwise ordinary: FF
          // works the 22nd, sleeps here, and picks up jour at 22:00. The fill
          // can only say one thing, so a day that merely *contains* jour keeps
          // its own fill and takes a corner mark instead. Without this, 51 h of
          // jour showed up as a single cell.
          const hasJour = dayShifts.some((s) => s.kind === 'jour');

          // Only finishing last night's shift: not a day you travel in, so it
          // must not look like the filled workdays around it.
          if (!isWorkday) {
            const carriesIn = dayShifts.some((s) => isContinuation(s, shifts));
            return (
              <button
                key={day}
                type="button"
                className={`cal__day ${
                  allStandby ? 'cal__day--jour' : 'cal__day--tail'
                } ${isToday ? 'cal__day--today' : ''}`}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${day} ${WEEK_LONG[wd]}${isToday ? ', i dag' : ''}, ${
                  allStandby
                    ? 'nattjour — beredskap hemifrån'
                    : 'ledig — nattpasset från dagen innan slutar denna morgon'
                }${hasJour && !allStandby ? ', med jour' : ''}`}
                onClick={() => setOpenDay(day)}
              >
                <span className="cal__num">{day}</span>
                {/* Points back at the day it came from, so it sits on the side
                    the night arrived from — the left of the number. */}
                {carriesIn && (
                  <span className="cal__arrow cal__arrow--in" aria-hidden="true">
                    <ArrowLeftIcon />
                  </span>
                )}
                {/* Jour hatches the cell over whatever fill it has — a
                    jour-only day and a tail that picks up jour in the evening
                    are the same mark on different backgrounds. No moon: jour
                    is always overnight, so the icon would say nothing the
                    stripes do not. */}
                {hasJour && <span className="cal__jour" aria-hidden="true" />}
              </button>
            );
          }

          // A shift running past midnight: this cell points right, tomorrow's
          // tail cell points left, so the pair reads as one stretch. Note this
          // is the only kind of night the parser can express — it splits at
          // midnight into an evening ending 24:00 plus a 00:00 tail, so
          // `endsNextDay` is never set and bandOf() never returns 'night'
          // here. continuesTomorrow() is what identifies the pair.
          const spillsOver = dayShifts.some((s) => continuesTomorrow(s, shifts));

          // The night shift: an awake evening ending 23:30, after which that
          // person sleeps here. Not "crosses midnight" — nothing awake does,
          // so that test never fired and the night fill never appeared.
          const worksThroughNight = dayShifts.some(isNightShift);
          const jourAfter = dayShifts.some(
            (s) => s.standby && continuesTomorrow(s, shifts)
          );

          return (
            <button
              key={day}
              type="button"
              className={`cal__day cal__day--on ${
                worksThroughNight ? 'cal__day--night' : ''
              } ${spillsOver ? 'cal__day--spills' : ''} ${
                isToday ? 'cal__day--today' : ''
              }`}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${day} ${WEEK_LONG[wd]}${isToday ? ', i dag' : ''}, arbetsdag${
                trips.length > 1 ? `, ${trips.length} pass` : ''
              }${hasJour ? ', med jour' : ''}${
                worksThroughNight
                  ? ', nattpass som fortsätter till nästa dag'
                  : jourAfter
                    ? ', därefter jour till nästa dag'
                    : ''
              }`}
              onClick={() => setOpenDay(day)}
            >
              <span className="cal__num">{day}</span>
              {/* Jour hatches the whole cell, over whatever fill the day has.
                  A dark striped square is therefore a night shift that also
                  carries jour — 00:00 to morning on call, then the evening's
                  night shift on the same date. */}
              {hasJour && <span className="cal__jour" aria-hidden="true" />}
              {/* The moon marks a night worked awake; the arrow leaves from the
                  bottom right, the side it carries into tomorrow. A night that
                  is merely covered by jour gets the stripes instead — the moon
                  would be saying what they already say. */}
              {spillsOver && (
                <>
                  {worksThroughNight && (
                    <span className="cal__moon" aria-hidden="true">
                      <MoonIcon />
                    </span>
                  )}
                  <span className="cal__arrow cal__arrow--out" aria-hidden="true">
                    <ArrowRightIcon />
                  </span>
                </>
              )}
            </button>
          );
        })}
      </section>

      {/* Two axes, listed separately rather than multiplied out. The fill says
          what kind of day it was; the stripes say "and jour on top of that".
          Enumerating the combinations meant an entry per pairing — and it was
          still short of the tail and sömn states. */}
      <ul className="key" aria-label="Färgförklaring">
        <li className="key__item">
          <span className="key__swatch" aria-hidden="true" />
          dagpass
        </li>
        <li className="key__item">
          <span className="key__swatch key__swatch--night" aria-hidden="true" />
          nattpass
        </li>
        <li className="key__item">
          <span className="key__swatch key__swatch--tail" aria-hidden="true" />
          slutar nattpass
        </li>
        <li className="key__item key__item--rule">
          <span className="key__swatch key__swatch--stripes" aria-hidden="true" />
          streckat = jour
        </li>
      </ul>

      {/* Every shift, in order. The calendar is the overview; this is the
          record — nothing here is hidden behind an interaction. */}
      <section className="list" aria-label="Dina pass">
        {shifts.length === 0 && (
          <p className="empty">Du har inga pass den här månaden.</p>
        )}
        {/* Grouped by day: the date is printed once, however many times you go
            in. Two rows both labelled "11 tis" read as a mistake rather than
            as two trips. */}
        {[...byDay.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([day, dayShifts]) => {
            // A day you never travelled in for: the hours it holds are last
            // night finishing, plus anything served from home. Asked the same
            // way the calendar asks it — `workdays` is the set of days with a
            // shift that is neither standby nor a continuation.
            //
            // Not `every(isContinuation)`: an evening jour block is not a
            // continuation, so a morning-after that later picks up jour would
            // fail that test and take the full worked-day fill, while the
            // identical day without the jour stayed pale. Days 1, 22, 24 and
            // 29 all read as worked days on that rule.
            const allTail = !workdays.has(day);
            // A day of nothing but jour is neither worked nor free, so it gets
            // its own row colour rather than borrowing one of theirs. Checked
            // on `kind`, not `standby`: sleeping here is also standby, but it
            // is a night spent at the workplace and must not take the
            // on-call-from-home hatch.
            const allJour = dayShifts.every((s) => s.kind === 'jour');
            // A night row is one holding the night shift — the awake evening
            // ending 23:30. A day worked to 22:00 and then covered by jour is
            // not one, even though the jour block runs past midnight.
            const spills = dayShifts.some(isNightShift);
            return (
              <div
                key={day}
                className={`pass ${allJour ? 'pass--jour' : ''} ${
                  allTail && !allJour ? 'pass--tail' : ''
                } ${spills && !allJour ? 'pass--spills' : ''} ${
                  day === today ? 'pass--today' : ''
                }`}
                aria-current={day === today ? 'date' : undefined}
              >
                <span className="pass__date">
                  <span className="pass__num">{day}</span>
                  <span className="pass__wd">
                    {dayShifts[0].weekday.slice(0, 3)}
                  </span>
                </span>

                <span className="pass__shifts">
                  {dayShifts.map((s, k) => (
                    /* A day can hold all three states at once — jour to the
                       morning, the day's work, then sleeping here at 23:30 —
                       so each row is tinted with its own, rather than the whole
                       card taking one colour for the lot. */
                    <span key={k} className={`pass__row pass__row--${s.kind}`}>
                      <span className="pass__time">
                        {s.start} – {s.end}
                        {/* The same moon the calendar puts on this day, so the
                            two views name a night the same way. Only on awake
                            nights: jour and sömn are overnight by definition
                            and already say so in the word beside them, so the
                            icon would be a third way of saying "night". */}
                        {continuesTomorrow(s, shifts) && !s.standby && (
                          <span className="pass__moon" aria-label="nattpass">
                            <MoonIcon />
                          </span>
                        )}
                        {/* Jour is an obligation, not hours on the floor, so it
                            says so beside the time rather than only in totals. */}
                        {s.standby && (
                          <span className="pass__tail">
                            {s.kind === 'sleep' ? 'sömn' : 'jour'}
                          </span>
                        )}
                        {/* Say plainly that this is last night finishing, not
                            a new morning you travel in for. */}
                        {isContinuation(s, shifts) && !s.standby && (
                          <span className="pass__tail">forts. från natten</span>
                        )}
                      </span>
                      <span className="pass__hours">
                        {formatHours(s.hours)} t
                      </span>
                    </span>
                  ))}
                </span>

                {/* Sits at the end of the row, after the hours. Belongs to the
                    day rather than to any one shift, so it is a sibling of the
                    shift stack instead of living inside it. */}
                {day === today && <span className="pass__today">idag</span>}
              </div>
            );
          })}
      </section>

      {/* Keyed by day so switching cells remounts rather than reusing a dialog
          whose showModal() effect has already run. */}
      {openDay !== null && (
        <DayDialog
          key={openDay}
          day={openDay}
          dayShifts={byDay.get(openDay) ?? []}
          allShifts={shifts}
          weekdayLong={WEEK_LONG[weekdayOf(openDay)]}
          monthLabel={schedule.monthLabel}
          schedule={schedule}
          me={me}
          onClose={() => setOpenDay(null)}
        />
      )}

      <footer className="foot">
        <span className="foot__note">
          <LockIcon /> Schemat lästes i din telefon — inget laddades upp.
        </span>
        <button className="foot__forget" onClick={onForget}>
          Glöm mig
        </button>
      </footer>
    </main>
  );
}


/* ------------------------------------------------------------------- icons */

const DocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* Night-shift arrows. The two halves point at each other across the date
   boundary: the evening cell points right, the next morning points left.
   Drawn wide and short so they read as direction, not glyphs, at ~10px. */

const arrow = {
  viewBox: '0 0 12 4',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Runs off the right edge: this shift continues into tomorrow. */
const ArrowRightIcon = () => (
  <svg {...arrow}>
    <path d="M0 2h10M8 0.6 9.8 2 8 3.4" />
  </svg>
);

/** Points back left: this shift arrived from yesterday. */
const ArrowLeftIcon = () => (
  <svg {...arrow}>
    <path d="M12 2H2M4 0.6 2.2 2 4 3.4" />
  </svg>
);

/* A night you go in for. Filled rather than stroked: at ~9px a 1.2-weight
   outline crescent closes up into a smudge, while a solid shape keeps its
   horns. Drawn as one path so it stays crisp against the filled cell. */
const MoonIcon = () => (
  <svg viewBox="0 0 12 12" fill="currentColor">
    <path d="M10.2 7.7A4.6 4.6 0 0 1 4.3 1.8a4.6 4.6 0 1 0 5.9 5.9Z" />
  </svg>
);

const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    width="18"
    height="18"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const LockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    width="14"
    height="14"
  >
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);

const Spinner = () => <span className="spinner" />;

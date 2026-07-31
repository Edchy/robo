import { useEffect, useMemo, useRef, useState } from 'react';
import { readSchedulePdf } from '../../pdf';
import { downloadIcs } from '../../ics';
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
} from '../../schedule';
import {
  clearSchedule,
  forgetAll,
  loadMe,
  loadSchedule,
  saveMe,
  saveSchedule,
} from '../../storage';
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
      // A plausible but incomplete result is more dangerous than no result.
      // Coverage gaps mean the file was only partly understood, so do not let
      // the user plan from it.
      if (parsed.warnings.length > 0) {
        const affected = parsed.warnings
          .slice(0, 3)
          .map((warning) => warning.split(':')[0])
          .join(', ');
        throw new ScheduleError(
          `Schemat kunde inte läsas säkert. Täckning saknas den ${affected}. ` +
            'Kontrollera att du valde original-PDF:en och försök igen.'
        );
      }
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
      <section className="upload-layout">
        <div className="upload-copy">
          <div className="intro">
        {/* The old pair described a file conversion — true, and joyless. The
            heading now asks the question people actually open this to answer,
            and the line under it answers back. Warmth by recognition, not by
            exclamation marks: the brand is calm and never chirpy. */}
            <p className="intro__label">Ditt arbetsschema</p>
            <h1 className="intro__title">När jobbar jag?</h1>
            <p className="intro__sub">
              Släng in månadens PDF, så slipper du leta efter dina pass.
            </p>
          </div>

      {/* Only one thing has to happen before this screen works: the PDF has to
          exist as a file on the device. That is what this explains.

          It was a numbered list of three, but the third step — picking your
          initials — happens on the next screen, which asks "Vem är du?" in its
          own words. Documenting it here described a screen the reader cannot
          see yet, and the remaining "choose the file below" only narrated the
          dropzone directly underneath. One instruction is not a sequence, so
          the numbers are gone: prose, above the box it prepares you for. */}
          <section className="how" aria-labelledby="how-title">
            <h2 className="how__title" id="how-title">
              Har du schemat kvar i mejlet?
            </h2>
            <p className="how__body">
              Öppna bilagan och välj <strong>Spara i Filer</strong> på telefonen.
              På datorn laddar du ner den som vanligt.
            </p>
          </section>
        </div>

        <label
          className={`drop ${over ? 'drop--over' : ''} ${busy ? 'drop--busy' : ''}`}
          aria-busy={busy}
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
            className="drop__input"
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            aria-label="Välj månadens schema som PDF-fil"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = '';
            }}
          />
          <span className="drop__icon" aria-hidden="true">
            {busy ? <Spinner /> : <DocIcon />}
          </span>
          <span className="drop__lead" aria-live="polite">
            {busy ? 'Läser schemat…' : 'Välj månadens PDF'}
          </span>
          {!busy && (
            <>
              <span className="drop__button">Välj fil</span>
              <span className="drop__hint">Du kan också släppa filen här</span>
            </>
          )}
        </label>
      </section>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {/* Same words, same icon, same small print as the caveat on the month
          view: a first-time reader meets the caution here, and recognises it
          again once the schedule is on screen. Always visible — a disclaimer
          folded behind a summary is a disclaimer nobody read. */}
      <div className="upload-meta">
        <p className="caveat" role="note">
          <AlertIcon />
          <span>
            Kontrollera alltid tiderna mot originalet. PDF-filer kan ibland
            läsas fel.
          </span>
        </p>

        <details className="privacy">
        <summary className="privacy__line">
          <LockIcon /> Filen stannar på din enhet — inget laddas upp.
        </summary>
        <div className="privacy__body">
          <p>
            PDF-filen läses i telefonen eller datorn du sitter vid, och lämnar
            aldrig enheten. Ingenting laddas upp. Det finns ingen inloggning och
            inget konto, och när sidan väl har laddats fungerar den utan
            internet.
          </p>
          <p>
            Så att du slipper leta upp filen varje gång sparas månadens schema
            och dina initialer i webbläsaren, på din egen enhet. Själva
            PDF-filen sparas aldrig. Det sparade schemat försvinner av sig
            självt när månaden är slut, och trycker du på{' '}
            <strong>Glöm mig</strong>{' '}
            försvinner allt direkt.
          </p>
          <p>
            Kom ihåg att både PDF-filen och det du ser här innehåller hela
            arbetsplatsens schema — dina kollegors pass syns också. Behandla det
            som vilket arbetsmaterial som helst och dela det inte vidare.
          </p>
        </div>
        </details>
      </div>
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
                  {/* Sleep shows the zzz glyph where the word was; jour keeps
                      its word, having no icon and needing none. The label goes
                      on the tag so the state is still announced. */}
                  {s.standby &&
                    (s.kind === 'sleep' ? (
                      <span
                        className="sheet__tag sheet__tag--sleep"
                        role="img"
                        aria-label="sömn"
                      >
                        <ZzzIcon />
                      </span>
                    ) : (
                      <span className="sheet__tag">jour</span>
                    ))}
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

      {/* Two ways to take the month with you, sitting with the month's figures
          rather than with any one day. Both stay on the device — the calendar
          file is built here, and printing never leaves the browser. Hidden on
          paper, where they would be dead ink.

          Only offered when there is something to take: a person with no shifts
          this month would export an empty file. */}
      {shifts.length > 0 && (
        <section className="take" aria-label="Spara schemat">
          <button
            className="btn"
            onClick={() => downloadIcs(me, shifts, schedule.monthLabel)}
          >
            <CalendarIcon /> Lägg till i kalendern
          </button>
          <button className="btn" onClick={() => window.print()}>
            <PrintIcon /> Skriv ut
          </button>
        </section>
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
                  {day === today && <span className="pass__today">idag</span>}
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
                        {s.standby &&
                          (s.kind === 'sleep' ? (
                            <span
                              className="pass__tail pass__tail--sleep"
                              role="img"
                              aria-label="sömn"
                            >
                              <ZzzIcon />
                            </span>
                          ) : (
                            <span className="pass__tail">jour</span>
                          ))}
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

      {/* The app reads a PDF that was never meant to be machine-read, so a
          misparse is always possible. This says so plainly and points at the
          original, which is the only authority. It sits above the footer rather
          than inside it: it is a caution, not a housekeeping control, and it
          must survive being printed. */}
      <p className="caveat" role="note">
        <AlertIcon />
        <span>
          Schemat läses automatiskt ur PDF-filen och kan bli fel. Använd det som
          en hjälp, inte som facit. Stäm alltid av mot den ursprungliga
          PDF-filen innan du planerar efter ett pass, och fråga din chef om
          något ser konstigt ut. Du ansvarar själv för att kontrollera dina
          tider.
        </span>
      </p>

      {/* The button used to sit beside a line about privacy, which said nothing
          about what pressing it does. Now the text explains the button: what is
          stored, what leaves, and where you end up. Named by its heading rather
          than an aria-label, so the explanation is what describes it. */}
      <footer className="foot" aria-labelledby="forget-title">
        <div className="foot__text">
          <h2 className="foot__title" id="forget-title">
            Glöm mig
          </h2>
          <p className="foot__body">
            Dina initialer och månadens schema ligger sparade i den här
            webbläsaren. Tar du bort dem börjar du om med att välja fil. Pass du
            redan lagt in i kalendern påverkas inte.
          </p>
        </div>
        <button className="foot__forget" onClick={onForget}>
          Ta bort mina uppgifter
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

/* The two export controls. Drawn at the same 1.5 weight as DocIcon, so the
   row of buttons reads as one family. */

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
  </svg>
);

const PrintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path
      d="M7 9V3h10v6M7 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect x="7" y="15" width="10" height="6" rx="1" />
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

/* Sleeping at the workplace: a crescent moon holding a Z, from public/z.svg.

   Inlined rather than loaded as <img>, for the same two reasons every other
   icon here is: a file request is a network call the privacy claim rules out,
   and an <img> cannot inherit the row's ink. The source art is filled #fff,
   which would vanish on the pale rows, so the fill is currentColor and each
   row colours it like the text it replaced.

   The fill-rule is evenodd in the source and must stay: the Z is cut out of
   the crescent rather than drawn over it, and with the default nonzero rule
   the whole moon fills solid and the letter disappears.

   Keep this in step with public/z.svg by hand: the file is the source the
   paths were copied from, but nothing loads it at runtime, so editing it alone
   changes nothing on screen. */
const ZzzIcon = () => (
  <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
    <path d="m422.71 21.812c1.125-0.35938 2.2539-0.66406 3.3281-0.97266 0 0-1.125 0.20312-3.3281 0.97266z" />
    <path
      fillRule="evenodd"
      d="m37.477 252.93c0 135.07 111.92 244.63 249.96 244.63 74.496 0 141.21-32.102 187.04-82.688-17.766 3.9414-36.199 6.0938-55.195 6.0938-138.04 0-249.96-109.52-249.96-244.63 0-62.156 23.91-118.73 62.926-161.89-111.46 24.574-194.77 122.01-194.77 238.49zm210.59 19.199 3.6367 46.898 105.68-13.055 0.87109-26.215-79.973 5.375 70.246-53.246-0.35938-41.168-96.973 2.0469 1.4844 33.535 60.723 6.6055zm105.42-171.88 6.9102 23.859 42.086-5.0703-37.121 38.809 10.754 33.125 68.812-26.469-3.9922-18.996-52.891 16.797 37.887-49.613-7.5273-29.543z"
    />
  </svg>
);

/* Sized and weighted like LockIcon, so the caveat and the privacy note below
   it read as the same class of small print. Sits at the caveat's first line
   rather than centred, so a wrapped paragraph still hangs off it. */
const AlertIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    width="14"
    height="14"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" strokeLinecap="round" />
    <path d="M12 16.5h.01" strokeLinecap="round" />
  </svg>
);

const Spinner = () => <span className="spinner" />;

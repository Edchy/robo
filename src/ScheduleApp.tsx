import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { readSchedulePdf } from './pdf';
import OriginalPdfView from './OriginalPdfView';
import { downloadIcs } from './ics';
import {
  alongsideOn,
  bandOf,
  continuesTomorrow,
  formatHours,
  isContinuation,
  isNightShift,
  personHues,
  shiftsFor,
  splitHours,
  workdaysOf,
  ScheduleError,
  type Schedule,
  type Shift,
} from './schedule';
import { loadMe, loadSchedule, saveMe, saveSchedule } from './storage';
import { loadPdfFile, savePdfFile } from './pdf-storage';
import { forgetEverything } from './session';
import './ScheduleApp.css';

type TimeBand = 'morning' | 'day' | 'evening' | 'night' | 'long';

const MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const timeBandOf = (shift: Shift): TimeBand => {
  if (isNightShift(shift)) return 'night';
  return bandOf(shift);
};

const timeBandLabel = (band: TimeBand) =>
  ({
    morning: 'Morgonpass',
    day: 'Dagpass',
    evening: 'Kvällspass',
    night: 'Nattpass',
    long: 'Heldag',
  })[band];

const localDate = (schedule: Schedule, day: number, time = '00:00') => {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(schedule.year, schedule.month - 1, day, hours, minutes);
};

const shiftBounds = (schedule: Schedule, shift: Shift) => {
  const start = localDate(schedule, shift.dayNum, shift.start);
  const endMinutes = timeToMinutes(shift.end);
  const end = localDate(schedule, shift.dayNum, shift.end);
  if (shift.endsNextDay && endMinutes < 24 * 60) end.setDate(end.getDate() + 1);
  return { start, end };
};

export default function App() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  /**
   * "Byt schema" was pressed and no replacement has arrived yet.
   *
   * The current month deliberately stays in state and on disk throughout: the
   * user has only said they intend to pick a new file, and until one parses
   * there is nothing to replace it with. Dropping it eagerly meant a change of
   * mind cost you the upload, with the PDF gone from IndexedDB too.
   */
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const remembered = loadMe();
    setMe(remembered === 'XX' ? null : remembered);
    setSchedule(loadSchedule());
    void loadPdfFile().then((file) => {
      if (!cancelled) setPdfFile(file);
    });
    return () => {
      cancelled = true;
    };
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
      setPdfFile(file);
      saveSchedule(parsed);
      void savePdfFile(file, parsed);
      const saved = loadMe();
      setMe(saved && saved !== 'XX' && parsed.people.includes(saved) ? saved : null);
      // The replacement landed, so there is nothing left to go back to.
      setReplacing(false);
    } catch (e) {
      setError(
        e instanceof ScheduleError
          ? e.message
          : 'Något gick fel när filen lästes. Försök igen.'
      );
      // Whatever was loaded before stays loaded. A file that will not parse is
      // no reason to throw away a month that already works — the error shows
      // above the dropzone, and "Behåll nuvarande schema" is still there.
    } finally {
      setBusy(false);
    }
  };

  if (!schedule || replacing) {
    return (
      <Dropzone
        onFile={handleFile}
        busy={busy}
        error={error}
        // Only offered when there is genuinely something to go back to. On a
        // first visit the schedule is null and this stays absent.
        onCancel={
          schedule
            ? () => {
                setReplacing(false);
                setError(null);
              }
            : undefined
        }
        currentMonth={schedule?.monthLabel ?? null}
      />
    );
  }

  if (!me) {
    return (
      <PersonPicker
        schedule={schedule}
        onPick={choosePerson}
        // Back to the dropzone to pick a different file. The loaded month is
        // kept, so this is reversible too — the same reasoning as "Byt schema".
        onBack={() => {
          setReplacing(true);
          setError(null);
        }}
      />
    );
  }

  return (
    <ScheduleView
      schedule={schedule}
      me={me}
      pdfFile={pdfFile}
      onPdfFile={(file) => {
        setPdfFile(file);
        void savePdfFile(file, schedule);
      }}
      onChangePerson={() => setMe(null)}
      // Nothing is cleared here — the month stays in state and on disk until a
      // replacement actually parses, so changing your mind is free.
      onNewFile={() => {
        setReplacing(true);
        setError(null);
      }}
      onForget={() => {
        void forgetEverything();
        setPdfFile(null);
        setMe(null);
        setSchedule(null);
        setReplacing(false);
        setError(null);
      }}
    />
  );
}

function Dropzone({
  onFile,
  busy,
  error,
  onCancel,
  currentMonth,
}: {
  onFile: (file: File) => void;
  busy: boolean;
  error: string | null;
  /** Present only when a loaded schedule is waiting to be returned to. */
  onCancel?: () => void;
  currentMonth: string | null;
}) {
  const [over, setOver] = useState(false);
  const replacing = Boolean(onCancel);

  return (
    <main className="welcome-shell">
      <section className="welcome-grid">
        <div className="welcome-copy">
          {/* Swapping a schedule is a different errand from arriving with none:
              the explanation is already known, and what matters is which month
              is about to be replaced and that backing out is possible. */}
          <h1>{replacing ? 'Byt till ett annat schema' : 'När var det du jobbade nu igen?'}</h1>
          <p className="welcome-lead">
            {replacing ? (
              <>
                Välj PDF:en för den nya månaden.{' '}
                {currentMonth ? <strong>{currentMonth}</strong> : 'Det nuvarande schemat'}{' '}
                ligger kvar tills den nya är inläst.
              </>
            ) : (
              'Släng in månadens PDF så dyker dina pass upp i en lite mer lättläst version.'
            )}
          </p>

          {replacing && (
            <button className="welcome-back" onClick={onCancel}>
              <ArrowLeftIcon />
              <span>Behåll {currentMonth ?? 'nuvarande schema'}</span>
            </button>
          )}

          {/* Only for a first visit. Someone on their second month has done
              this before and does not need the steps again. */}
          <div className="welcome-help" hidden={replacing}>
            <h2>Har du schemat i mejlet?</h2>
            <p>Gör så här på mobilen:</p>
            <ol className="welcome-steps">
              <li>Öppna mejlet och tryck på PDF-bilagan med schemat.</li>
              <li>
                <strong>På iPhone:</strong> tryck på dela-knappen (fyrkanten med
                en pil uppåt) och välj <strong>Spara i Filer</strong>.
              </li>
              <li>
                <strong>På Android:</strong> tryck på <strong>Ladda ned</strong>.
                Om knappen inte syns, öppna menyn med de tre prickarna.
              </li>
              <li>Kom tillbaka hit och tryck på <strong>Välj PDF</strong>.</li>
            </ol>
            <p className="welcome-desktop-tip">
              <strong>Sitter du vid en dator?</strong> Öppna bilagan och välj{' '}
              <strong>Ladda ner</strong>. Filen hamnar oftast i mappen Hämtade
              filer.
            </p>
          </div>
        </div>

        <label
          className={`file-dock ${over ? 'file-dock--over' : ''} ${busy ? 'file-dock--busy' : ''}`}
          aria-busy={busy}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const file = event.dataTransfer.files[0];
            if (file) onFile(file);
          }}
        >
          <input
            className="file-dock__input"
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            aria-label="Välj månadens schema som PDF-fil"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = '';
            }}
          />
          <span className="file-dock__top">
            <span className="file-dock__icon" aria-hidden="true">
              {busy ? <Spinner /> : <DocIcon />}
            </span>
            <span className="file-dock__format">PDF</span>
          </span>
          <span className="file-dock__title" aria-live="polite">
            {busy ? 'Schemat läses…' : 'Här ska PDF:en in'}
          </span>
          <span className="file-dock__button">
            {busy ? 'Snart klart' : 'Välj PDF'}
          </span>
          {!busy && (
            <span className="file-dock__hint">Du kan också släppa den här</span>
          )}
          <span className="file-dock__privacy">
            <LockIcon /> Stannar på din mobil eller dator
          </span>
        </label>
      </section>

      {error && (
        <p className="alert" role="alert">
          <AlertIcon /> <span>{error}</span>
        </p>
      )}

      <div className="welcome-notes">
        <p className="caveat welcome-caveat" role="note">
          <AlertIcon />
          <span>Ta alltid en snabb koll mot originalet. PDF:er kan ibland läsas fel.</span>
        </p>

        <details className="privacy">
          <summary>
            <LockIcon /> Vad sparas på enheten? <ChevronDownIcon />
          </summary>
          <div className="privacy__body">
            <p>
              Allt händer här på din mobil eller dator. PDF-filen skickas
              ingenstans, och sidan fungerar utan internet när den väl har laddats.
            </p>
            <p>
              PDF-filen, det tolkade månadsschemat och dina initialer sparas i
              den här webbläsaren, så att du kan öppna originalet och slipper
              börja om. Allt försvinner när månaden är slut eller om du väljer
              <strong> Glöm mig</strong>.
            </p>
            <p>
              Originalfilen innehåller hela arbetsplatsens schema. Behandla den
              som arbetsmaterial och dela den inte vidare.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}

function PersonPicker({
  schedule,
  onPick,
  onBack,
}: {
  schedule: Schedule;
  onPick: (code: string) => void;
  onBack: () => void;
}) {
  const people = useMemo(
    () => schedule.people.filter((code) => code !== 'XX'),
    [schedule.people]
  );
  const personColors = useMemo(() => personHues(people), [people]);

  return (
    <main className="picker-shell">
      <header className="simple-bar">
        <button className="quiet-button" onClick={onBack}>
          <ArrowLeftIcon /> Byt PDF
        </button>
        <span>{schedule.monthLabel}</span>
      </header>

      <section className="picker-stage" aria-labelledby="picker-title">
        <div className="picker-copy">
          <p>Schemat är inne</p>
          <h1 id="picker-title">Och du är…?</h1>
          <span>Tryck på dina initialer så öppnas ditt schema.</span>
        </div>

        <div className="initials" role="group" aria-label="Personal">
          {people.map((code) => (
            <button
              key={code}
              className={`initials__item person-color--${personColors.get(code) ?? 0}`}
              onClick={() => onPick(code)}
            >
              <span>{code}</span>
              <ArrowRightIcon />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function ScheduleView({
  schedule,
  me,
  pdfFile,
  onPdfFile,
  onChangePerson,
  onNewFile,
  onForget,
}: {
  schedule: Schedule;
  me: string;
  pdfFile: File | null;
  onPdfFile: (file: File) => void;
  onChangePerson: () => void;
  onNewFile: () => void;
  onForget: () => void;
}) {
  const shifts = useMemo(() => shiftsFor(schedule, me), [schedule, me]);
  const personColors = useMemo(
    () => personHues(schedule.people.filter((code) => code !== 'XX')),
    [schedule.people]
  );
  const now = useMemo(() => new Date(), []);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);

  const openOriginal = () => {
    if (pdfFile) setPdfOpen(true);
    else pdfInput.current?.click();
  };

  const byDay = useMemo(() => {
    const map = new Map<number, Shift[]>();
    for (const shift of shifts) {
      const group = map.get(shift.dayNum);
      if (group) group.push(shift);
      else map.set(shift.dayNum, [shift]);
    }
    return map;
  }, [shifts]);

  const groups = useMemo(
    () => [...byDay.entries()].sort((a, b) => a[0] - b[0]),
    [byDay]
  );
  // Prev/next in the day sheet still walks the whole month, past days included:
  // once a day is open, stepping back into yesterday is the obvious move.
  const browsableDays = useMemo(() => groups.map(([day]) => day), [groups]);
  const openDayIndex = openDay === null ? -1 : browsableDays.indexOf(openDay);

  /**
   * The ledger split. A day is done once its last shift has actually finished,
   * not at midnight — a night ending 08:00 is still the shift you are on at
   * 03:00, and filing it under "som varit" then would be wrong.
   */
  const [pastGroups, upcomingGroups] = useMemo(() => {
    const past: typeof groups = [];
    const upcoming: typeof groups = [];
    for (const group of groups) {
      const done = group[1].every(
        (shift) => shiftBounds(schedule, shift).end <= now
      );
      (done ? past : upcoming).push(group);
    }
    return [past, upcoming];
  }, [groups, now, schedule]);

  const nextShift = useMemo(
    () =>
      shifts
        .filter((shift) => shift.kind === 'work' && !isContinuation(shift, shifts))
        .map((shift) => ({ shift, ...shiftBounds(schedule, shift) }))
        .filter(({ end }) => end > now)
        .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null,
    [now, schedule, shifts]
  );

  const totals = useMemo(() => splitHours(shifts), [shifts]);

  return (
    <main className="app-shell">
      <header className="app-bar">
        <h1 className="app-month">{schedule.monthLabel}</h1>
        <div className="app-bar__actions">
          <input
            ref={pdfInput}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Välj original-PDF"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onPdfFile(file);
                setPdfOpen(true);
              }
              event.target.value = '';
            }}
          />
          <button className="original-button" onClick={openOriginal}>
            <CompareIcon /> Se PDF
          </button>
          <button className="new-file-button" onClick={onNewFile}>
            <DocIcon /> Byt schema
          </button>
          <button
            className={`identity-button person-color--${personColors.get(me) ?? 0}`}
            onClick={onChangePerson}
            aria-label={`Schema för ${me} — byt person`}
          >
            {me}
          </button>
        </div>
      </header>

      <h1 className="print-title">
        {schedule.monthLabel} · {me}
      </h1>

      <NextShift
        next={nextShift}
        schedule={schedule}
        dayShifts={nextShift ? byDay.get(nextShift.shift.dayNum) ?? [] : []}
        allShifts={shifts}
        me={me}
        personColors={personColors}
        onOpenDay={setOpenDay}
      />

      <MonthCalendar
        schedule={schedule}
        shifts={shifts}
        byDay={byDay}
        now={now}
        onOpenDay={setOpenDay}
      />

      {/* The visible heading is gone: a list of dated rows under a month
          calendar needs no label to be understood, and the two headings were
          mostly separating the page into parts that already read as separate.
          The name stays on the landmark for anyone navigating by region. */}
      <section className="month-section" aria-label="Dina tider">
        {groups.length === 0 ? (
          <p className="empty-state">Du har inga pass den här månaden.</p>
        ) : (
          <>
            {/* Days already worked are folded away rather than listed. What the
                page is for is what comes next, and by the end of the month the
                finished days outnumbered the remaining ones several to one.
                They stay reachable — the month is a record as well as a plan,
                and people do check what they worked. */}
            {pastGroups.length > 0 && (
              // Open when the month is over and there is nothing else to show,
              // so the section is never a lone collapsed bar with the list it
              // belongs to nowhere in sight.
              <details className="past-days" open={upcomingGroups.length === 0}>
                <summary>
                  <span className="past-days__label">
                    {pastGroups.length} {pastGroups.length === 1 ? 'dag' : 'dagar'} som varit
                  </span>
                  <ChevronDownIcon />
                </summary>
                <div className="day-ledger past-days__list">
                  {pastGroups.map(([day, dayShifts]) => (
                    <DayRow
                      key={day}
                      day={day}
                      dayShifts={dayShifts}
                      allShifts={shifts}
                      schedule={schedule}
                      isToday={false}
                      onOpen={() => setOpenDay(day)}
                    />
                  ))}
                </div>
              </details>
            )}

            {/* No "nothing left" message when this is empty: the next-shift
                card at the top of the page already says so, in larger type. */}
            {upcomingGroups.length > 0 && (
              <div className="day-ledger">
                {upcomingGroups.map(([day, dayShifts]) => (
                  <DayRow
                    key={day}
                    day={day}
                    dayShifts={dayShifts}
                    allShifts={shifts}
                    schedule={schedule}
                    isToday={
                      now.getFullYear() === schedule.year &&
                      now.getMonth() + 1 === schedule.month &&
                      now.getDate() === day
                    }
                    onOpen={() => setOpenDay(day)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <MonthTotals totals={totals} />

      {shifts.length > 0 && (
        <section className="schedule-actions" aria-label="Ta med schemat">
          <button onClick={() => downloadIcs(me, shifts, schedule.monthLabel)}>
            <DownloadIcon />
            <span>Kalender</span>
          </button>
          <button onClick={() => window.print()}>
            <PrintIcon />
            <span>Skriv ut</span>
          </button>
        </section>
      )}

      <p className="caveat app-caveat" role="note">
        <AlertIcon />
        <span>
          Schemat läses automatiskt ur PDF-filen och kan bli fel. Stäm alltid av
          tiderna mot originalet innan du planerar efter ett pass.{' '}
          <button className="caveat__action" onClick={openOriginal}>
            Öppna originalet
          </button>
        </span>
      </p>

      <footer className="account-footer" aria-labelledby="forget-title">
        <div>
          <h2 id="forget-title">Sparat på den här enheten</h2>
          <p>
            Initialerna, månadens tolkade schema och original-PDF:en ligger i
            webbläsaren. Ingenting har laddats upp.
          </p>
        </div>
        <button onClick={onForget}>Glöm mig</button>
      </footer>

      {openDay !== null && (
        <DayDialog
          day={openDay}
          dayShifts={byDay.get(openDay) ?? []}
          allShifts={shifts}
          monthLabel={schedule.monthLabel}
          schedule={schedule}
          me={me}
          personColors={personColors}
          previousDay={openDayIndex > 0 ? browsableDays[openDayIndex - 1] : null}
          nextDay={
            openDayIndex >= 0 && openDayIndex < browsableDays.length - 1
              ? browsableDays[openDayIndex + 1]
              : null
          }
          onNavigate={setOpenDay}
          onClose={() => setOpenDay(null)}
        />
      )}

      {pdfFile && (
        <OriginalPdfView
          file={pdfFile}
          highlight={me}
          open={pdfOpen}
          onClose={() => setPdfOpen(false)}
        />
      )}
    </main>
  );
}

const WEEK_HEADS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

function MonthCalendar({
  schedule,
  shifts,
  byDay,
  now,
  onOpenDay,
}: {
  schedule: Schedule;
  shifts: Shift[];
  byDay: Map<number, Shift[]>;
  now: Date;
  onOpenDay: (day: number) => void;
}) {
  const first = new Date(Date.UTC(schedule.year, schedule.month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  // Midnight today, for dating the cells that hold no shifts and so have no
  // end time of their own to compare against.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const workShifts = shifts.filter(
    (shift) => shift.kind === 'work' && !isContinuation(shift, shifts)
  );
  const nightShifts = workShifts.filter(isNightShift);
  // Every worked band that shows in the grid, continuations included. They are
  // left out of `workShifts` because they are not a trip in and must not count
  // as a workday, but the grid still paints and labels them — so the key has to
  // explain them or a "morgon" cell appears with nothing to match it.
  const usedBands = new Set(
    shifts.filter((shift) => shift.kind === 'work').map(timeBandOf)
  );
  const jourStarts = shifts.filter(
    (shift) => shift.kind === 'jour' && !isContinuation(shift, shifts)
  );
  const hasContested = shifts.some((shift) => shift.contestedWith.length > 0);
  const workdays = workdaysOf(shifts);

  // No heading and no month eyebrow: the app bar already names the month, and a
  // calendar grid under a row of counts explains itself. The counts now carry
  // the row on their own.
  return (
    <section className="month-glance" aria-label="Månaden i överblick">
      <header className="section-head month-glance__head">
        {/* Nights and jour appear only when there are some. "0 jour" is not a
            fact worth a slot — it is the absence of one, and it reads as
            something to check rather than something to skip. Pass and
            arbetsdagar always show: a zero there is the month telling you
            something, not an empty category. */}
        <dl className="glance-counts" aria-label="Sammanfattning av månaden">
          <div><dt>pass</dt><dd>{workShifts.length}</dd></div>
          {/* Arbetsdagar and nätter show on desktop only. Below that, four
              counts wrapped into an uneven block that cost more room than it
              earned. Both are countable off the calendar directly below; pass
              is the one figure that is not, and jour is the one people ask
              about. See `.glance-counts__wide`. */}
          <div className="glance-counts__wide"><dt>arbetsdagar</dt><dd>{workdays.size}</dd></div>
          {nightShifts.length > 0 && (
            <div className="glance-counts__wide">
              <dt>{nightShifts.length === 1 ? 'natt' : 'nätter'}</dt>
              <dd>{nightShifts.length}</dd>
            </div>
          )}
          {jourStarts.length > 0 && (
            <div><dt>jour</dt><dd>{jourStarts.length}</dd></div>
          )}
        </dl>
      </header>

      <div className="month-calendar" role="grid" aria-label={schedule.monthLabel}>
        {WEEK_HEADS.map((weekday, index) => (
          <span key={`${weekday}-${index}`} className="month-calendar__weekday" role="columnheader">
            {weekday}
          </span>
        ))}
        {Array.from({ length: lead }, (_, index) => (
          <span key={`pad-${index}`} className="calendar-cell calendar-cell--pad" aria-hidden="true" />
        ))}
        {schedule.days.map((scheduleDay) => {
          const day = scheduleDay.dayNum;
          const dayShifts = byDay.get(day) ?? [];
          const actualWork = dayShifts.filter(
            (shift) => shift.kind === 'work' && !isContinuation(shift, shifts)
          );
          const primary = actualWork.find(isNightShift) ?? actualWork[0] ?? null;
          const band = primary ? timeBandOf(primary) : null;
          const tailShift = dayShifts.find(
            (shift) => shift.kind === 'work' && isContinuation(shift, shifts)
          );
          const visualBand = band ?? (tailShift ? timeBandOf(tailShift) : null);
          const hasJour = dayShifts.some((shift) => shift.kind === 'jour');
          const hasSleep = dayShifts.some((shift) => shift.kind === 'sleep');
          const isToday =
            now.getFullYear() === schedule.year &&
            now.getMonth() + 1 === schedule.month &&
            now.getDate() === day;
          // Behind you: every shift on the day has finished, or the day itself
          // is over. The grid keeps all its cells — a month with holes in it
          // stops being a month — so the past recedes rather than disappears.
          const isPast = isToday
            ? false
            : dayShifts.length > 0
              ? dayShifts.every((shift) => shiftBounds(schedule, shift).end <= now)
              : localDate(schedule, day) < today;

          if (dayShifts.length === 0) {
            return (
              <span
                key={day}
                role="gridcell"
                className={`calendar-cell calendar-cell--empty ${isToday ? 'calendar-cell--today' : ''} ${isPast ? 'calendar-cell--past' : ''}`}
                aria-current={isToday ? 'date' : undefined}
              >
                <span className="calendar-cell__number">{day}</span>
              </span>
            );
          }

          // Beredskap is not a shift: you are at home, the hours are not worked
          // hours, and `workdaysOf` already refuses to count the day. A day
          // holding nothing else is therefore a free day that owes something,
          // not a working day — so it keeps the empty cell's look and takes a
          // corner marker instead of a filled band. Without this, KA's month
          // shows 12 days of "work" that are actually days at home.
          const onlyStandby = !visualBand;
          if (onlyStandby) {
            return (
              <button
                key={day}
                role="gridcell"
                className={`calendar-cell calendar-cell--empty calendar-cell--standby ${isToday ? 'calendar-cell--today' : ''} ${isPast ? 'calendar-cell--past' : ''}`}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${scheduleDay.weekday} ${day} ${MONTHS[schedule.month - 1]}. ${dayShifts
                  .map((shift) => `${shift.start} till ${shift.end}, ${shiftKindLabel(shift, shifts)}`)
                  .join('. ')}`}
                onClick={() => onOpenDay(day)}
              >
                <span className="calendar-cell__number">{day}</span>
                <span className="calendar-cell__standby" aria-hidden="true">
                  {hasSleep && !hasJour ? <SleepIcon /> : <JourIcon />}
                </span>
              </button>
            );
          }

          // The morning after a night slept here is just a morning. It used to
          // read "efter natt", which named the shift by what preceded it rather
          // than by what it asks of you — and at a glance the only question is
          // which part of the day you are working.
          const shortLabel = primary && band
            ? ({ morning: 'morgon', day: 'dag', evening: 'kväll', night: 'natt', long: 'heldag' })[band]
            : 'morgon';
          const compactLabel = primary && band
            ? ({ morning: 'M', day: 'D', evening: 'K', night: 'N', long: 'H' })[band]
            : 'M';
          // A slot the PDF writes as "KA/DV": one of the two works it and the
          // schedule does not say which. Both of them see it on their own
          // calendar, so without a mark both would assume it is theirs and one
          // would travel in for nothing — or worse, neither would.
          const contested = dayShifts.filter((shift) => shift.contestedWith.length > 0);
          const spoken = dayShifts
            .map((shift) => `${shift.start} till ${shift.end}, ${shiftKindLabel(shift, shifts)}`)
            .join('. ');

          return (
            <button
              key={day}
              role="gridcell"
              className={`calendar-cell calendar-cell--scheduled calendar-cell--${visualBand} ${isToday ? 'calendar-cell--today' : ''} ${isPast ? 'calendar-cell--past' : ''}`}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${scheduleDay.weekday} ${day} ${MONTHS[schedule.month - 1]}. ${spoken}${
                contested.length > 0 ? '. Oklart pass, kontrollera schemat' : ''
              }`}
              onClick={() => onOpenDay(day)}
            >
              <span className="calendar-cell__number">{day}</span>
              {contested.length > 0 && (
                <span className="calendar-cell__contested" aria-hidden="true">
                  <AlertIcon />
                </span>
              )}
              <span className="calendar-cell__kind">
                <TimeIcon band={visualBand} />
                <span className="calendar-cell__kind-label">{shortLabel}</span>
                <span className="calendar-cell__kind-compact" aria-hidden="true">
                  {compactLabel}
                </span>
              </span>
              {/* Beredskap on a day you also work: a mark beside the band, never
                  a second block. The day is already named by the work. */}
              {hasJour && !contested.length && (
                <span className="calendar-cell__standby" aria-hidden="true">
                  <JourIcon />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <ul className="calendar-key" aria-label="Förklaring">
        {(['morning', 'day', 'evening', 'night', 'long'] as TimeBand[])
          .filter((band) => usedBands.has(band))
          .map((band) => (
          <li key={band}>
            <span className={`calendar-key__mark calendar-key__mark--${band}`}><TimeIcon band={band} /></span>
            {timeBandLabel(band).replace('pass', '').trim()}
          </li>
        ))}
        {jourStarts.length > 0 && (
          <li>
            <span className="calendar-key__mark calendar-key__mark--standby">
              <JourIcon />
            </span>
            Beredskap
          </li>
        )}
        {hasContested && (
          <li>
            <span className="calendar-key__mark calendar-key__mark--contested">
              <AlertIcon />
            </span>
            Oklart pass
          </li>
        )}
      </ul>
    </section>
  );
}

function NextShift({
  next,
  schedule,
  dayShifts,
  allShifts,
  me,
  personColors,
  onOpenDay,
}: {
  next: { shift: Shift; start: Date; end: Date } | null;
  schedule: Schedule;
  dayShifts: Shift[];
  allShifts: Shift[];
  me: string;
  personColors: Map<string, number>;
  onOpenDay: (day: number) => void;
}) {
  if (!next) {
    // "Färdigt för din del" would be a lie if beredskap is still owed: no more
    // trips in, but the phone can still ring. Jour never headlines the card, so
    // this is the one place the remaining standby has to be said outright.
    const standbyLeft = allShifts
      .map((candidate) => ({ candidate, ...shiftBounds(schedule, candidate) }))
      .filter(({ candidate, end }) => candidate.kind === 'jour' && end > new Date())
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return (
      <section className="next-shift next-shift--empty" aria-labelledby="next-title">
        <div>
          <p className="next-shift__label">Nästa pass</p>
          <h1 id="next-title">Inga fler pass den här månaden</h1>
          <span>
            {standbyLeft.length > 0
              ? `Inga fler arbetspass, men du har beredskap kvar — nästa ${
                  standbyLeft[0].candidate.weekday.toLowerCase()
                } ${standbyLeft[0].candidate.dayNum} ${MONTHS[schedule.month - 1]}.`
              : `${schedule.monthLabel} är färdigt för din del.`}
          </span>
        </div>
        <CheckIcon />
      </section>
    );
  }

  const { shift, start, end } = next;
  const band = timeBandOf(shift);
  const now = new Date();
  const isOngoing = start <= now && end > now;
  const startDay = localDate(schedule, shift.dayNum);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const difference = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);
  const when =
    difference === 0
      ? 'I dag'
      : difference === 1
        ? 'I morgon'
        : `${shift.weekday} ${shift.dayNum} ${MONTHS[schedule.month - 1]}`;
  const alongside = alongsideOn(schedule, shift, me);
  const follow = dayShifts.find(
    (candidate) => candidate.start === shift.end && candidate.kind !== 'work'
  );
  // Beredskap on the same day, wherever it falls. It never takes the headline —
  // the card answers "when do I next go in", and for the jour-heavy people it
  // would otherwise own the card most of the month — but it is a real
  // obligation and belongs in the notes.
  const jourToday = dayShifts.filter((candidate) => candidate.kind === 'jour');

  return (
    <section className={`next-shift next-shift--${band}`} aria-labelledby="next-title">
      <div className="next-shift__topline">
        <span className="next-shift__label">
          {isOngoing ? 'Pågår nu' : 'Nästa pass'}
        </span>
        <span className="shift-kind">
          <TimeIcon band={band} /> {timeBandLabel(band)}
        </span>
      </div>

      <div className="next-shift__main">
        <div>
          <p className="next-shift__date">{when}</p>
          <h1 id="next-title">
            {/* The button is stretched over the whole card by CSS rather than
                wrapping it: the heading has to stay a real <h1> for the page
                outline, and a <button> may only contain phrasing content. The
                "Detaljer" link that used to sit in the corner is gone — the
                sheet it opened shows the same shift this card already does, so
                it promised more than it delivered while shrinking a card-sized
                target down to one word. */}
            <button
              className="next-shift__open"
              onClick={() => onOpenDay(shift.dayNum)}
            >
              {shift.start}<span aria-hidden="true">–</span>{shift.end}
            </button>
          </h1>
        </div>
        <TimeIcon band={band} large />
      </div>

      <div className="next-shift__footer">
        <div className="next-shift__notes">
          {/* First of the notes, and the only one that changes what you do:
              the shift may not be yours at all. */}
          {shift.contestedWith.length > 0 && (
            <span className="next-shift__contested">
              <AlertIcon />
              <span>
                Delat pass med{' '}
                {shift.contestedWith.join(' och ')} — bara en av er jobbar. Kolla
                schemat.
              </span>
            </span>
          )}
          {follow?.kind === 'sleep' && band !== 'night' && (
            <span>Sovande jour från {follow.start}.</span>
          )}
          {jourToday.length > 0 && (
            <span className="next-shift__standby">
              <JourIcon />
              <span>
                Beredskap {jourToday.map((s) => `${s.start}–${s.end}`).join(', ')},
                hemifrån.
              </span>
            </span>
          )}
          {alongside.length > 0 && (
            <span className="coworker-note">
              <span>Du jobbar med</span>
              <span className="coworker-pills">
                {alongside.map((code) => (
                  <ColleaguePill key={code} code={code} colors={personColors} />
                ))}
              </span>
            </span>
          )}
          {continuesTomorrow(shift, allShifts) && (
            <span>Fortsätter efter midnatt.</span>
          )}
        </div>
        <span className="next-shift__arrow" aria-hidden="true">
          <ArrowRightIcon />
        </span>
      </div>
    </section>
  );
}

/**
 * One colleague, or an unresolved pair. "KA/DV" is a slot the schedule has not
 * settled — one of the two will come — so it renders as both names joined by
 * "eller" rather than as a single person with a slash in their name. Each name
 * keeps its own colour so it still reads as the people you know.
 */
function PersonPill({ code, hue }: { code: string; hue: number }) {
  return <span className={`person-pill person-color--${hue}`}>{code}</span>;
}

function ColleaguePill({
  code,
  colors,
}: {
  code: string;
  colors: Map<string, number>;
}) {
  const names = code.split('/');
  if (names.length === 1) {
    return <PersonPill code={code} hue={colors.get(code) ?? 0} />;
  }
  return (
    <span className="person-pill-alt">
      {names.map((name, i) => (
        <Fragment key={name}>
          {i > 0 && <span className="person-pill-alt__or">eller</span>}
          <PersonPill code={name} hue={colors.get(name) ?? 0} />
        </Fragment>
      ))}
    </span>
  );
}

function DayRow({
  day,
  dayShifts,
  allShifts,
  schedule,
  isToday,
  onOpen,
}: {
  day: number;
  dayShifts: Shift[];
  allShifts: Shift[];
  schedule: Schedule;
  isToday: boolean;
  onOpen: () => void;
}) {
  const spoken = dayShifts
    .map((shift) => `${shift.start} till ${shift.end}, ${shiftKindLabel(shift, allShifts)}`)
    .join('. ');
  const jourBlocks = dayShifts.filter((shift) => shift.kind === 'jour');
  // Nothing on this day but beredskap: no trip in, no worked hours, and
  // `workdaysOf` does not count it. It still has to be here — the phone can
  // ring and people plan around that — but it gets a single quiet line instead
  // of a full card. For KA that is 12 of 27 rows shrunk rather than 12 cards
  // claiming as much room as a worked day.
  const standbyOnly = jourBlocks.length === dayShifts.length;

  return (
    <button
      className={`day-row ${standbyOnly ? 'day-row--standby' : ''} ${isToday ? 'day-row--today' : ''}`}
      onClick={onOpen}
      aria-label={`${dayShifts[0].weekday} ${day} ${MONTHS[schedule.month - 1]}. ${spoken}`}
    >
      <span className="day-row__date">
        <strong>{day}</strong>
        <span>{dayShifts[0].weekday.slice(0, 3)}</span>
        {isToday && <em>idag</em>}
      </span>

      <span className="day-row__content">
        <span className="day-row__shifts">
          {dayShifts.filter((shift) => shift.kind !== 'jour').map((shift, index) => {
            const band = shift.kind === 'work' ? timeBandOf(shift) : null;
            const tone = band ?? shift.kind;
            return (
              <span key={`${shift.start}-${index}`} className={`shift-block shift-block--${tone}`}>
                <strong className="shift-block__time">{shift.start}–{shift.end}</strong>
                {/* Icon only. The row is read as a whole through the button's
                    aria-label, which still spells out every shift, so dropping
                    the visible word costs nothing spoken and leaves the times —
                    the thing people actually scan for — uncrowded. */}
                <span className="shift-block__kind" aria-hidden="true">
                  {band ? <TimeIcon band={band} /> : shift.kind === 'sleep' ? <SleepIcon /> : <JourIcon />}
                </span>
              </span>
            );
          })}
        </span>
        {/* Beredskap sits under the day's real shifts as a line of text, not as
            a block of its own: it is time owed from home, and a filled block
            the same size as a worked pass overstates it. On a jour-only day
            this is the row's only content, which is the honest picture. */}
        {jourBlocks.length > 0 && (
          <span className="day-row__standby" aria-hidden="true">
            <JourIcon />
            <span>
              Beredskap {jourBlocks.map((s) => `${s.start}–${s.end}`).join(', ')}
            </span>
          </span>
        )}
      </span>

      <span className="day-row__arrow" aria-hidden="true">
        <ArrowRightIcon />
      </span>
    </button>
  );
}

function MonthTotals({ totals }: { totals: ReturnType<typeof splitHours> }) {
  return (
    <section className="month-totals" aria-labelledby="totals-title">
      <header>
        <h2 id="totals-title">Dina timmar</h2>
      </header>
      <dl>
        <div>
          <dt>Arbete</dt>
          <dd><strong>{formatHours(totals.worked)}</strong><span>tim</span></dd>
        </div>
        {totals.sleep > 0 && (
          <div>
            <dt>Sovande jour</dt>
            <dd><strong>{formatHours(totals.sleep)}</strong><span>tim</span></dd>
          </div>
        )}
        {totals.jour > 0 && (
          <div>
            <dt>Jour</dt>
            <dd><strong>{formatHours(totals.jour)}</strong><span>tim</span></dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function shiftKindLabel(shift: Shift, allShifts: Shift[]) {
  if (shift.kind === 'sleep') return 'Sovande jour';
  if (shift.kind === 'jour') return 'Jour';
  if (isContinuation(shift, allShifts)) return 'Efter nattpass';
  return timeBandLabel(timeBandOf(shift));
}

function DayDialog({
  day,
  dayShifts,
  allShifts,
  monthLabel,
  schedule,
  me,
  personColors,
  previousDay,
  nextDay,
  onNavigate,
  onClose,
}: {
  day: number;
  dayShifts: Shift[];
  allShifts: Shift[];
  monthLabel: string;
  schedule: Schedule;
  me: string;
  personColors: Map<string, number>;
  previousDay: number | null;
  nextDay: number | null;
  onNavigate: (day: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const totals = splitHours(dayShifts);
  const scheduleDay = schedule.days.find((candidate) => candidate.dayNum === day);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="day-sheet"
      aria-labelledby="day-sheet-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="day-sheet__panel">
        <header className="day-sheet__head">
          <div>
            <p>{monthLabel}</p>
            <h2 id="day-sheet-title">
              {scheduleDay?.weekday} {day}
            </h2>
          </div>
          <button onClick={() => ref.current?.close()} aria-label="Stäng">
            <CloseIcon />
          </button>
        </header>

        <div className="day-sheet__body">
          <div className="day-sheet__shifts">
            {dayShifts.map((shift, index) => {
              const band = shift.kind === 'work' ? timeBandOf(shift) : null;
              const alongside = alongsideOn(schedule, shift, me);
              // The modal is where exact times get checked, so every block
              // stays — including beredskap, which is quieted with a modifier
              // rather than dropped.
              return (
                <section
                  key={`${shift.start}-${index}`}
                  className={`day-sheet__shift day-sheet__shift--${band ?? shift.kind} ${
                    shift.kind === 'jour' ? 'day-sheet__shift--standby' : ''
                  }`}
                >
                  <div className="day-sheet__time">
                    <strong>{shift.start}–{shift.end}</strong>
                    {/* Icon only, as in the day rows. Unlike those, this section
                        has no aria-label of its own, so the name stays in the
                        DOM as hidden text — it is the only thing telling a
                        screen reader whether this block is work, jour or sleep. */}
                    <span className="day-sheet__kind">
                      {band ? <TimeIcon band={band} /> : shift.kind === 'sleep' ? <SleepIcon /> : <JourIcon />}
                      <span className="visually-hidden">{shiftKindLabel(shift, allShifts)}</span>
                    </span>
                  </div>
                  {alongside.length > 0 && (
                    <p className="day-sheet__coworkers">
                    <span>{shift.kind === 'jour' ? 'På plats' : 'Du jobbar med'}</span>
                      <span className="coworker-pills">
                        {alongside.map((code) => (
                          <ColleaguePill key={code} code={code} colors={personColors} />
                        ))}
                      </span>
                    </p>
                  )}
                  {shift.contestedWith.length > 0 && (
                    <p className="day-sheet__contested">
                      <AlertIcon />
                      <span>
                        Schemat har både dig och{' '}
                        {shift.contestedWith.map((code, i) => (
                          <Fragment key={code}>
                            {i > 0 && ' och '}
                            <PersonPill code={code} hue={personColors.get(code) ?? 0} />
                          </Fragment>
                        ))}{' '}
                        på det här passet. Bara en av er ska jobba — stäm av eller
                        kolla originalschemat innan du åker.
                      </span>
                    </p>
                  )}
                  {shift.kind === 'jour' && <p>Beredskap hemifrån.</p>}
                  {shift.kind === 'sleep' && <p>Sov gott.</p>}
                  {isNightShift(shift) && <p>Du sover på plats efter passet.</p>}
                  {isContinuation(shift, allShifts) && shift.kind === 'work' && (
                    <p>Fortsättning från natten innan. Du är redan på plats.</p>
                  )}
                </section>
              );
            })}
          </div>

          <dl className="day-sheet__totals">
            <div><dt>Arbete</dt><dd>{formatHours(totals.worked)} tim</dd></div>
            {totals.sleep > 0 && <div><dt>Sömn</dt><dd>{formatHours(totals.sleep)} tim</dd></div>}
            {totals.jour > 0 && <div><dt>Jour</dt><dd>{formatHours(totals.jour)} tim</dd></div>}
          </dl>
        </div>

        <nav className="day-sheet__navigation" aria-label="Bläddra mellan dagar">
          <button
            type="button"
            disabled={previousDay === null}
            onClick={() => previousDay !== null && onNavigate(previousDay)}
          >
            <ArrowLeftIcon /> Föregående
          </button>
          <button
            type="button"
            disabled={nextDay === null}
            onClick={() => nextDay !== null && onNavigate(nextDay)}
          >
            Nästa <ArrowRightIcon />
          </button>
        </nav>
      </div>
    </dialog>
  );
}

function TimeIcon({ band, large = false }: { band: TimeBand; large?: boolean }) {
  const size = large ? 64 : 16;
  if (band === 'long') {
    return (
      <svg className="time-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="7" cy="8" r="2.5" />
        <path d="M7 2.5v1.5M7 12v1.5M1.5 8H3M11 8h1.5M3.1 4.1l1 1M9.9 10.9l1 1" />
        <path d="M20.5 18.2a5.5 5.5 0 0 1-7.2-7.2 5.5 5.5 0 1 0 7.2 7.2Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (band === 'night') {
    return (
      <svg className="time-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M19.5 15.2A8 8 0 0 1 8.8 4.5a8 8 0 1 0 10.7 10.7Z" fill="currentColor" />
      </svg>
    );
  }

  const horizon = band === 'morning' || band === 'evening';
  return (
    <svg className="time-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {horizon ? (
        <>
          <path d="M4 17h16M7 14a5 5 0 0 1 10 0" />
          <path d={band === 'morning' ? 'M12 3v4M5.8 6.8l2.3 2.3M18.2 6.8l-2.3 2.3' : 'M12 9V5M7 8 5.2 6.2M17 8l1.8-1.8'} />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
        </>
      )}
    </svg>
  );
}

const JourIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v8" />
    <path d="M7.5 7.5a7 7 0 1 0 9 0" />
  </svg>
);

const SleepIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18.5 15.5A7.5 7.5 0 0 1 8.5 5.5a7.5 7.5 0 1 0 10 10Z" />
    <path d="M14.5 5h4l-4 4h4" />
  </svg>
);

const DocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CompareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3v5h5" />
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M8 13h8M8 17h5" />
  </svg>
);

const PrintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M7 9V3h10v6M7 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="7" y="15" width="10" height="6" rx="1" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v11" />
    <path d="m8 10 4 4 4-4" />
    <path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13.5 8h-10M7 4.5 3.5 8 7 11.5" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" strokeLinecap="round" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="privacy__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3.5 6 4.5 4 4.5-4" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.2 2.5 2.5 5.7-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Spinner = () => <span className="spinner" aria-hidden="true" />;

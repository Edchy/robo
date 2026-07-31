import { useEffect, useMemo, useRef, useState } from 'react';
import { readSchedulePdf } from '../../pdf';
import { downloadIcs } from '../../ics';
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
    long: 'Dag + kväll',
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

  useEffect(() => {
    const remembered = loadMe();
    setMe(remembered === 'XX' ? null : remembered);
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
      const saved = loadMe();
      setMe(saved && saved !== 'XX' && parsed.people.includes(saved) ? saved : null);
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
    <ScheduleView
      schedule={schedule}
      me={me}
      onChangePerson={() => setMe(null)}
      onNewFile={() => {
        clearSchedule();
        setSchedule(null);
        setError(null);
      }}
      onForget={() => {
        forgetAll();
        setMe(null);
        setSchedule(null);
        setError(null);
      }}
    />
  );
}

function Dropzone({
  onFile,
  busy,
  error,
}: {
  onFile: (file: File) => void;
  busy: boolean;
  error: string | null;
}) {
  const [over, setOver] = useState(false);

  return (
    <main className="welcome-shell">
      <section className="welcome-grid">
        <div className="welcome-copy">
          <h1>När var det du jobbade nu igen?</h1>
          <p className="welcome-lead">
            Släng in månadens PDF så dyker dina pass upp i en lite mer lättläst
            version.
          </p>

          <div className="welcome-help">
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
        <p className="caveat" role="note">
          <AlertIcon />
          <span>Ta alltid en snabb koll mot originalet. PDF:er kan ibland läsas fel.</span>
        </p>

        <details className="privacy">
          <summary>
            <LockIcon /> Hur funkar det utan uppladdning?
          </summary>
          <div className="privacy__body">
            <p>
              Allt händer här på din mobil eller dator. PDF-filen skickas
              ingenstans, och sidan fungerar utan internet när den väl har laddats.
            </p>
            <p>
              Det tolkade månadsschemat och dina initialer sparas i den här
              webbläsaren, så att du slipper börja om. Själva PDF-filen sparas
              aldrig. Allt försvinner när månaden är slut eller om du väljer
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
  const personColors = useMemo(
    () => personHues(schedule.people.filter((code) => code !== 'XX')),
    [schedule.people]
  );
  const now = useMemo(() => new Date(), []);
  const [openDay, setOpenDay] = useState<number | null>(null);

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
  const browsableDays = useMemo(() => groups.map(([day]) => day), [groups]);
  const openDayIndex = openDay === null ? -1 : browsableDays.indexOf(openDay);

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

      {shifts.length > 0 && (
        <section className="schedule-actions" aria-label="Ta med schemat">
          <button onClick={() => downloadIcs(me, shifts, schedule.monthLabel)}>
            <CalendarIcon />
            <span>
              <strong>Ladda ner kalenderfil</strong>
              <small>Öppna den för att lägga till passen</small>
            </span>
          </button>
          <button onClick={() => window.print()}>
            <PrintIcon />
            <span>
              <strong>Skriv ut</strong>
              <small>Hela månaden</small>
            </span>
          </button>
        </section>
      )}

      <MonthCalendar
        schedule={schedule}
        shifts={shifts}
        byDay={byDay}
        now={now}
        onOpenDay={setOpenDay}
      />

      <section className="month-section" aria-labelledby="month-title">
        <header className="section-head">
          <h2 id="month-title">Dina tider</h2>
        </header>

        {groups.length === 0 ? (
          <p className="empty-state">Du har inga pass den här månaden.</p>
        ) : (
          <div className="day-ledger">
            {groups.map(([day, dayShifts]) => (
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
      </section>

      <MonthTotals totals={totals} />

      <p className="caveat app-caveat" role="note">
        <AlertIcon />
        <span>
          Schemat läses automatiskt ur PDF-filen och kan bli fel. Stäm alltid av
          tiderna mot originalet innan du planerar efter ett pass.
        </span>
      </p>

      <footer className="account-footer" aria-labelledby="forget-title">
        <div>
          <h2 id="forget-title">Sparat på den här enheten</h2>
          <p>
            Initialerna och månadens tolkade schema ligger i webbläsaren. Ingen
            fil har laddats upp.
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
  const workShifts = shifts.filter(
    (shift) => shift.kind === 'work' && !isContinuation(shift, shifts)
  );
  const nightShifts = workShifts.filter(isNightShift);
  const usedBands = new Set(workShifts.map(timeBandOf));
  const hasAfterNight = shifts.some(
    (shift) => shift.kind === 'work' && isContinuation(shift, shifts)
  );
  const jourStarts = shifts.filter(
    (shift) => shift.kind === 'jour' && !isContinuation(shift, shifts)
  );
  const hasSleep = shifts.some((shift) => shift.kind === 'sleep');
  const workdays = workdaysOf(shifts);

  return (
    <section className="month-glance" aria-labelledby="glance-title">
      <header className="section-head month-glance__head">
        <div>
          <p>{schedule.monthLabel}</p>
          <h2 id="glance-title">Månaden på en blick</h2>
        </div>
        <dl className="glance-counts" aria-label="Sammanfattning av månaden">
          <div><dt>pass</dt><dd>{workShifts.length}</dd></div>
          <div><dt>arbetsdagar</dt><dd>{workdays.size}</dd></div>
          <div>
            <dt>{nightShifts.length === 1 ? 'natt' : 'nätter'}</dt>
            <dd>{nightShifts.length}</dd>
          </div>
          <div><dt>jour</dt><dd>{jourStarts.length}</dd></div>
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

          if (dayShifts.length === 0) {
            return (
              <span
                key={day}
                role="gridcell"
                className={`calendar-cell calendar-cell--empty ${isToday ? 'calendar-cell--today' : ''}`}
                aria-current={isToday ? 'date' : undefined}
              >
                <span className="calendar-cell__number">{day}</span>
              </span>
            );
          }

          const shortLabel = primary && band
            ? ({ morning: 'morgon', day: 'dag', evening: 'kväll', night: 'natt', long: 'dag/kväll' })[band]
            : tailShift
              ? 'efter natt'
            : hasJour
              ? 'jour'
              : hasSleep
                ? 'sovjour'
                : 'pass';
          const compactLabel = primary && band
            ? ({ morning: 'M', day: 'D', evening: 'K', night: 'N', long: 'D/K' })[band]
            : tailShift
              ? 'N→'
              : hasJour
                ? 'J'
                : hasSleep
                  ? 'SJ'
                  : 'P';
          const secondary = (primary || tailShift) && hasJour ? '+ jour' : null;
          const spoken = dayShifts
            .map((shift) => `${shift.start} till ${shift.end}, ${shiftKindLabel(shift, shifts)}`)
            .join('. ');

          return (
            <button
              key={day}
              role="gridcell"
              className={`calendar-cell calendar-cell--scheduled ${visualBand ? `calendar-cell--${visualBand}` : `calendar-cell--neutral calendar-cell--${hasSleep ? 'sleep' : 'jour'}`} ${isToday ? 'calendar-cell--today' : ''}`}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${scheduleDay.weekday} ${day} ${MONTHS[schedule.month - 1]}. ${spoken}`}
              onClick={() => onOpenDay(day)}
            >
              <span className="calendar-cell__number">{day}</span>
              <span className="calendar-cell__kind">
                {visualBand ? <TimeIcon band={visualBand} /> : hasSleep ? <SleepIcon /> : <JourIcon />}
                <span className="calendar-cell__kind-label">{shortLabel}</span>
                <span className="calendar-cell__kind-compact" aria-hidden="true">
                  {compactLabel}
                </span>
              </span>
              {secondary && (
                <span className="calendar-cell__secondary">
                  <span className="calendar-cell__secondary-label">{secondary}</span>
                  <span className="calendar-cell__secondary-compact" aria-hidden="true">+J</span>
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
        {hasAfterNight && (
          <li>
            <span className="calendar-key__mark calendar-key__mark--morning"><TimeIcon band="morning" /></span>
            Efter natt
          </li>
        )}
        {jourStarts.length > 0 && (
          <li><span className="calendar-key__mark calendar-key__mark--jour"><JourIcon /></span>Jour</li>
        )}
        {hasSleep && (
          <li><span className="calendar-key__mark calendar-key__mark--sleep"><SleepIcon /></span>Sovande jour</li>
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
    return (
      <section className="next-shift next-shift--empty" aria-labelledby="next-title">
        <div>
          <p className="next-shift__label">Nästa pass</p>
          <h1 id="next-title">Inga fler pass den här månaden</h1>
          <span>{schedule.monthLabel} är färdigt för din del.</span>
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
            {shift.start}<span aria-hidden="true">–</span>{shift.end}
          </h1>
        </div>
        <TimeIcon band={band} large />
      </div>

      <div className="next-shift__footer">
        <div className="next-shift__notes">
          {follow?.kind === 'sleep' && band !== 'night' && (
            <span>Sovande jour från {follow.start}.</span>
          )}
          {alongside.length > 0 && (
            <span className="coworker-note">
              <span>Du jobbar med</span>
              <span className="coworker-pills">
                {alongside.map((code) => (
                  <PersonPill key={code} code={code} hue={personColors.get(code) ?? 0} />
                ))}
              </span>
            </span>
          )}
          {continuesTomorrow(shift, allShifts) && (
            <span>Fortsätter efter midnatt.</span>
          )}
        </div>
        <button onClick={() => onOpenDay(shift.dayNum)}>
          Detaljer <ArrowRightIcon />
        </button>
      </div>
    </section>
  );
}

function PersonPill({ code, hue }: { code: string; hue: number }) {
  return <span className={`person-pill person-color--${hue}`}>{code}</span>;
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

  return (
    <button
      className={`day-row ${isToday ? 'day-row--today' : ''}`}
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
          {dayShifts.map((shift, index) => {
            const band = shift.kind === 'work' ? timeBandOf(shift) : null;
            const tone = band ?? shift.kind;
            return (
              <span key={`${shift.start}-${index}`} className={`shift-block shift-block--${tone}`}>
                <strong className="shift-block__time">{shift.start}–{shift.end}</strong>
                <span className="shift-block__kind">
                  {band ? <TimeIcon band={band} /> : shift.kind === 'sleep' ? <SleepIcon /> : <JourIcon />}
                  <strong>{shiftKindLabel(shift, allShifts)}</strong>
                </span>
              </span>
            );
          })}
        </span>
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
              return (
                <section key={`${shift.start}-${index}`} className={`day-sheet__shift day-sheet__shift--${band ?? shift.kind}`}>
                  <div className="day-sheet__time">
                    <strong>{shift.start}–{shift.end}</strong>
                    <span className="day-sheet__kind">
                      {band ? <TimeIcon band={band} /> : shift.kind === 'sleep' ? <SleepIcon /> : <JourIcon />}
                      {shiftKindLabel(shift, allShifts)}
                    </span>
                  </div>
                  {alongside.length > 0 && (
                    <p className="day-sheet__coworkers">
                    <span>{shift.kind === 'jour' ? 'På plats' : 'Du jobbar med'}</span>
                      <span className="coworker-pills">
                        {alongside.map((code) => (
                          <PersonPill key={code} code={code} hue={personColors.get(code) ?? 0} />
                        ))}
                      </span>
                    </p>
                  )}
                  {shift.kind === 'jour' && <p>Beredskap hemifrån, inte arbetad tid.</p>}
                  {shift.kind === 'sleep' && <p>Sovande jour, med egen ersättning.</p>}
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

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
  </svg>
);

const PrintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M7 9V3h10v6M7 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="7" y="15" width="10" height="6" rx="1" />
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

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.2 2.5 2.5 5.7-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Spinner = () => <span className="spinner" aria-hidden="true" />;

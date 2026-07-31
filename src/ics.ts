/**
 * Calendar export (RFC 5545). Built in the browser from already-parsed shifts —
 * nothing is uploaded, and no library is involved.
 */
import type { Shift } from './schedule';

/** Escape per RFC 5545 §3.3.11: backslash, semicolon, comma, newline. */
const esc = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/**
 * Long lines must be folded at 75 octets. Fold on the UTF-8 byte length, not
 * the character count, so that "ö" and friends cannot split a line mid-value.
 */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    // Continuation lines start with a space, which costs one octet.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  if (current) out.push(current);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date-time in the form YYYYMMDDTHHMMSS (no trailing Z: floating time). */
function stamp(date: string, time: string, addDays = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  // Let Date normalise both the +1 day and a 24:00 end time.
  const dt = new Date(y, m - 1, d + addDays, hh, mm);
  return (
    `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}` +
    `T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
  );
}

/** UTC timestamp for DTSTAMP. */
function utcStamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

export type IcsOptions = {
  /** Initials of the person the calendar is for. */
  me: string;
  shifts: Shift[];
  /** Injectable for tests. */
  now?: Date;
};

/**
 * Render shifts as an iCalendar document.
 *
 * Events use floating local time deliberately: a shift starting at 07:00 means
 * 07:00 where the person works, whatever timezone their phone is set to.
 *
 * UIDs are derived from person, date and start time, so importing the same
 * month twice updates the existing events rather than duplicating them.
 */
export function buildIcs({ me, shifts, now = new Date() }: IcsOptions): string {
  const dtstamp = utcStamp(now);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rosenbo//Mitt schema//SV',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`Mina pass (${me})`)}`,
  ];

  for (const s of shifts) {
    const start = stamp(s.date, s.start);
    const end = stamp(s.date, s.end, s.endsNextDay ? 1 : 0);
    const uid = `${s.date}-${s.start.replace(':', '')}-${me}@rosenbo`;

    const summary = s.endsNextDay ? `Nattpass ${me}` : `Arbetspass ${me}`;
    const description = [
      `${s.start}–${s.end}${s.endsNextDay ? ' (nästa dag)' : ''}`,
      `${s.hours} h`,
      s.sharedWith.length ? `Delat pass med ${s.sharedWith.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(description)}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Trigger a download of the calendar file. */
export function downloadIcs(me: string, shifts: Shift[], monthLabel: string): void {
  const text = buildIcs({ me, shifts });
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${monthLabel.toLowerCase().replace(/\s+/g, '-')}-${me.toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

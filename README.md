# Robo — Mitt schema

Drop in the monthly schedule PDF, pick your initials, see only your own shifts.

Everything runs in the browser: the PDF is parsed locally with pdf.js and is
never uploaded. Deploys as a static site.

## Utveckling

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

## Tester

```bash
npx tsx --test src/*.test.mts
```

`schedule.test.mts` runs against a real schedule PDF and skips itself if the
file is not present; point it elsewhere with
`ROSENBO_PDF="/path/to/schema.pdf"`. `storage.test.mts` covers caching and
expiry and needs nothing.

## Export

Two buttons under the shift list, both entirely client-side:

- **Lägg till i kalendern** downloads an `.ics` file (`src/ics.ts`) that imports
  into Apple Calendar, Google Calendar and Outlook. Night shifts become single
  events spanning midnight, which is precisely what the PDF cannot show.
- **Skriv ut** calls `window.print()`. A print stylesheet in `App.css` swaps to
  white, hides the controls, adds the person's initials to the heading and
  keeps shifts from splitting across pages — so "Save as PDF" yields a clean
  sheet without any PDF library in the bundle.

Calendar details worth knowing:

- **Floating local time** (no `Z`, no `TZID`): 07:00 means 07:00 where the
  person works, regardless of the phone's timezone.
- **Stable UIDs** (`date-start-person@rosenbo`) so re-importing a corrected
  month updates the existing events instead of duplicating them.
- **No `VALARM`s** — importing must never add surprise alerts to someone's
  phone.
- Lines are folded at 75 **octets**, measured on UTF-8 bytes, so `å/ä/ö` can
  never be split mid-character.

On iPhone, Safari opens the file in a preview where the user taps *Add All*;
Android and desktop download it directly.

## Lagring på enheten

Two `localStorage` keys, both on-device only — see `src/storage.ts`:

| Key | Contents | Lifetime |
| --- | --- | --- |
| `rosenbo.me` | chosen initials, e.g. `"ES"` | until **Glöm mig** |
| `rosenbo.schedule` | the parsed month (~22 kB JSON) | until the month ends, or **Glöm mig** |

The PDF itself is never stored — only the parsed result, so staff need not
re-drop the file on every visit. `loadSchedule()` deletes the entry once the
month is over, and also discards anything corrupt or written by an older
`CACHE_VERSION`. Every access is wrapped so that private browsing or a full
quota degrades to "ask for the PDF again" instead of breaking.

## Information till personalen

The app carries its own privacy note: a "Läs mer" toggle under the dropzone,
plus a "Glöm mig" button in the footer that clears the stored initials. The
same wording, if you need it for an email or a notice board:

> **Mitt schema** läser månadens schema-PDF direkt i din telefon eller dator.
> Filen skickas aldrig vidare — varken till oss, till arbetsgivaren eller till
> någon annan. Appen fungerar även i flygplansläge när sidan väl har laddats.
>
> För att du inte ska behöva leta upp PDF-filen varje gång sparas månadens
> schema och dina initialer i webbläsaren — på din egen enhet. Själva
> PDF-filen sparas aldrig, och schemat raderas automatiskt när månaden är
> slut. Trycker du på **Glöm mig** försvinner allt direkt.
>
> Tänk på att PDF-filen innehåller *hela* arbetsplatsens schema, precis som när
> du får den via mejl. Appen visar bara dina pass — men filen i sig är
> densamma. Dela den därför inte vidare.

**Keep this claim true.** It holds because parsing is entirely client-side. If
the app ever gains a backend, an upload, analytics, or any third-party script,
the note must change — an inaccurate privacy claim is worse than none. Hosting
the page is fine: the host sees ordinary request logs, never the PDF.

## Hur tolkningen fungerar

`src/schedule.ts` reads the PDF as a positional table — every cell lands on a
known x-coordinate, and each day occupies two rows of round-the-clock cover.
Notable details:

- **Durations come from the timestamps**, not the printed hour cells, which are
  blank or zero on unstaffed slots.
- **Adjacent blocks merge.** The PDF splits one shift across up to three cells.
- **Night shifts bridge midnight** when they start at 16:00 or later and the
  result stays within 16 h — so an evening-to-morning shift reads as one pass,
  while two back-to-back day shifts stay separate.
- **`AU` is an activity**, not a person, and is excluded from the picker
  (`ACTIVITY_CODES`).
- **Shared slots** such as `KA/DV` count for both people and name the co-worker.
- After parsing, every minute of every day is checked for staff coverage; gaps
  surface in the UI rather than failing silently.

The column model is specific to this PDF template. If the layout changes, the
parser will report that it found no schedule rather than show wrong hours.

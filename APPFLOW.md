# App flow, privacy and offline behavior

Rosenbo is a static browser application. The website sends a small program to
the user's browser; after it has loaded, the sensitive work happens on that
device rather than on a server.

## Bundle size and pdf.js

The production build contains approximately:

- 547 KB of main JavaScript before compression, or about 166 KB transferred
  compressed.
- A 1.38 MB PDF worker before compression.

Most of this weight comes from `pdf.js`, the PDF-reading library. PDF files can
contain complex fonts, text positioning, compression formats and page
structures, so reliable PDF support requires a substantial amount of code.

Vite warns when a JavaScript bundle exceeds its default 500 KB threshold. This
is a warning, not an error and does not mean the application is broken.

The PDF reader is deliberately loaded with the application. It would be
possible to reduce the initial download by fetching `pdf.js` only after the
user selects a file. However, someone who opened the application, switched to
airplane mode and then selected a PDF could no longer fetch the reader. Loading
it up front makes the already-open session more dependable offline.

## 1. Visiting the website

The hosting provider receives an ordinary request for a static website and
sends the browser:

- The HTML page structure.
- The CSS styling.
- The Rosenbo application code.
- React.
- The PDF reader and its worker.
- The favicon.

As with any hosted website, the provider may record technical request
information such as the visitor's IP address, time of visit, browser user-agent
and which public site files were requested. The exact logging depends on the
hosting provider's configuration.

At this stage, the host has not received a schedule PDF or any staff schedule
information.

The application itself contains no analytics, advertising scripts,
third-party fonts, accounts or tracking systems.

## 2. What offline means

Once all application files have loaded, the open browser tab contains the
complete working application:

- The interface.
- The PDF reader.
- The schedule parser.
- The calendar-export code.
- The print styles.

The user can then switch to airplane mode and continue using that open tab.
The main functions do not require a server.

This does not guarantee that the site can always be reopened or refreshed
while offline. If the tab is closed, the page is refreshed or the browser
clears its cache, the browser may need to contact the host again. The
application is not installed as a full offline PWA.

The precise promise is:

> Once the page has finished loading, the open page works without internet.

It does not promise:

> The website can always be opened from scratch without internet.

## 3. Selecting and reading a PDF

The browser's native file picker gives the open page access to the file chosen
by the user. The file is not attached to a form or sent to a server.

Instead:

1. The browser reads the PDF into local memory.
2. `pdf.js` opens it locally.
3. A PDF worker extracts text and positioning.
4. The schedule parser reconstructs the dates, rows, times and initials.
5. The app validates that every day has staff coverage.
6. A local copy of the original PDF is kept in the browser so the user can
   compare the interpreted schedule with its source.

The app rejects:

- Empty files.
- Files larger than 25 MB.
- PDFs longer than 20 pages.
- Invalid PDFs.
- Scanned, image-only PDFs.
- PDFs it cannot recognize as the expected schedule.
- Partially parsed schedules containing coverage gaps.

The final check prevents the app from presenting a plausible-looking but
incomplete schedule when it detects that part of the source was not understood.

## 4. Data stored in the browser

After a valid PDF has been parsed, the app stores two things in the browser's
`localStorage`:

- The parsed monthly schedule.
- The selected person's initials.

The original PDF file is stored separately in the browser's `IndexedDB`. This
makes the source available from the schedule view without sending it anywhere.

The parsed schedule still contains workplace information needed to change
people and calculate shifts. It must therefore be treated as sensitive
workplace material even though it remains on that device.

The stored data:

- Remains in that browser on that device.
- Is not synchronized through an application account.
- Is removed when the schedule month ends.
- Can be removed immediately with **Glöm mig**.
- Gracefully fails to save if browser storage is unavailable.

On a shared phone or computer, another person using the same browser profile
could potentially reopen the site and see the locally stored schedule. This is
why **Glöm mig** exists.

Browser extensions, malware and people with access to an unlocked device are
outside what a webpage can fully protect against.

## 5. Viewing and interacting with the schedule

React filters the parsed schedule locally and renders:

- The selected person's hours.
- Workdays.
- Morning, day, evening and night information.
- Sleep and jour distinctions.
- A calendar overview.
- Individual shift details.
- The original PDF in a local page-and-zoom viewer for comparison.
- Relevant co-worker initials.

Changing person does not contact a server. The browser already contains the
parsed schedule and simply recalculates the view.

## 6. Calendar export

When the user chooses **Lägg till i kalendern**:

1. The browser creates an `.ics` calendar file in memory.
2. It puts the selected person's parsed shifts into that file.
3. The browser downloads or opens the file.
4. The user chooses whether to import it into a calendar.

The Rosenbo app does not send the calendar file anywhere.

Once the user imports it, the chosen calendar provider takes over. If the user
uses iCloud, Google Calendar, Microsoft 365 or another synchronized calendar,
the events may be uploaded to that provider according to the user's existing
calendar settings. That happens after the file has left this application's
responsibility.

## 7. Printing

Choosing **Skriv ut** opens the browser's normal print function. The browser
creates the print view locally using the app's print stylesheet.

The user can:

- Print it on a physical printer.
- Save it as a PDF.
- Cancel.

The app does not upload the printable schedule. Operating-system print
services, network printers or cloud-printing software may process it according
to their own behavior.

## What is public

Anyone who knows the site's address can request the public application files:

- The interface.
- The JavaScript application code.
- The CSS.
- The PDF-reading library.
- The favicon.
- The general parsing rules contained in the application code.

This is normal for a browser application: the browser needs the code in order
to run it. Public access to the application code does not expose a user's
schedule. The code contains parsing rules, not uploaded staff data.

## What stays on the device

Unless the user exports, prints or shares information, or the device/browser
is compromised or shared, the following remain on the device:

- The selected PDF.
- Extracted schedule information.
- Staff initials from that PDF.
- The selected person.
- Calculated shifts.
- The generated calendar file before import.

The privacy boundary can be summarized as:

```text
Hosting server
    |
    | sends the public application
    v
User's browser
    |-- opens the PDF locally
    |-- parses the schedule locally
    |-- stores the parsed month locally
    |-- displays shifts locally
    |-- creates calendar files locally
    `-- prepares printing locally
```

No schedule PDF travels back up that connection.

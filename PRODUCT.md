# Product

## Register

product

## Users

Care staff at Rosenbo. They open this on a phone, usually one-handed, often
mid-shift in a hallway or on the way in — not at a desk. The job: "when do I
work, and is tonight a night shift?" They receive the whole workplace's
schedule as a monthly PDF by email and only care about their own rows.

Secondary context: standing at a noticeboard printing the month, or importing
into a phone calendar once and not opening the app again for weeks.

## Product Purpose

Turn a dense, workplace-wide schedule PDF into one person's shifts, entirely on
the device. Success is a staff member finding their next shift in under three
seconds without reading a table, and trusting that the file never left their
phone.

## Brand Personality

Calm, trustworthy, unfussy. It is a utility that respects a tired reader: it
answers the question and gets out of the way. Swedish-language, plainspoken,
never chirpy. The privacy promise is part of the voice — stated plainly, never
as a marketing badge.

## Anti-references

- Dashboard-SaaS chrome: stat tiles with gradients, sparklines, "insights" no
  one asked for.
- Enterprise scheduling tools (Quinyx, Planday) — dense grids, tiny type,
  everything the PDF already fails at.
- Consumer-calendar maximalism: every shift a different saturated block until
  the month is a quilt.
- Anything that looks like it's harvesting data. No badges, no accounts, no
  cookie-consent theater.

## Design Principles

1. **The next shift is the headline.** Any pixel that competes with "when do I
   work next" is a bug.
2. **Color carries one meaning: time of day.** Morning / day / evening / night
   are the only things allowed to be colorful. Everything else is ink on white.
3. **Readable one-handed, at arm's length, in a hallway.** Touch targets and
   type sizes answer to that, not to desktop.
4. **The privacy claim must stay literally true.** No network calls, no
   third-party scripts, no fonts fetched from a CDN.
5. **Paper is a real output.** Print is a supported surface, not an
   afterthought — and background graphics are off by default when printing.

## Accessibility & Inclusion

- WCAG AA: body text ≥4.5:1, large text ≥3:1.
- **Shift type must never be conveyed by color alone** — this is the core
  a11y constraint of the redesign. Every band carries a text label and a
  distinct icon alongside its color, so the four bands survive deuteranopia,
  protanopia, and a black-and-white printout.
- `prefers-reduced-motion` honored for every transition.
- Light-only theme (deliberate product decision), so contrast is tuned once
  against white rather than compromised across two themes.

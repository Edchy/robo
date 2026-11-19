# Getting the PDF into the app

Today the schedule arrives as an email attachment and the staff member has to
download it and then pick it from the file system. On an iPhone that is: open
the mail, tap the attachment, share sheet, **Spara i Filer**, choose a folder,
switch to the app, **Välj PDF**, find the folder again. Seven steps for a file
that is already open on the screen.

The obvious wish is a link in the email that does the whole thing. This
document is why that is not a small change, and what to do instead.

## The constraint that decides it

The app's promise is that the PDF never leaves the device. It is not marketing —
it is written into the interface, into `README.md` under *Information till
personalen*, and into `PRODUCT.md` as design principle 4: *the privacy claim
must stay literally true*. `APPFLOW.md` draws the boundary as a diagram and ends
with "No schedule PDF travels back up that connection."

A link that fetches the PDF means the PDF is reachable from a URL, which means
it sits on a server. That is a real change of what this app is, for a document
the app itself describes as containing *hela arbetsplatsens schema*: personnel
data for a Swedish care workplace, with the employer as controller under GDPR.

Not a blocker. But it moves the work from "a weekend feature" to "a service with
a data processing agreement, a retention policy and a named operator", and that
decision belongs to the employer rather than to whoever is writing the code.

So the question is not technical. It is **who is willing to host the file.**

## Option A — share target (no server, do this first)

Install the app as a PWA and declare a Web Share Target accepting
`application/pdf`. The flow collapses to: long-press the attachment → Share →
Robo. No download, no Files app, no picker.

- Needs a `manifest.json` with a `share_target` entry and a service worker.
- **Android/Chrome only.** iOS Safari does not implement Web Share Target.
  Given the likely iPhone majority here, this helps some of the staff a great
  deal and the rest not at all.
- Changes nothing about privacy, infrastructure or the legal surface. Every
  claim in `README.md` stays true as written.

Cheap, and the only option on this page that can be done without talking to
anyone. Worth doing regardless of what happens with the others.

## Option B — fetch from the employer's own storage (the recommended target)

If the workplace is on Microsoft 365 or Google Workspace — likely — the schedule
can live in a SharePoint or Drive folder the staff already have access to, and
the email links there. The app learns to accept a URL as well as a file:

```
robo.example/#src=<url>
```

The browser fetches it with the user's *existing work session*, and parsing
stays local exactly as it is now.

Why this is the good version: the authentication is the employer's, the storage
is the employer's, the retention policy is the employer's. Nobody has to stand
up a new service or become a new data controller. The privacy promise survives
nearly intact — the PDF still never reaches *us*; it goes from the employer's
storage into the user's browser.

**Test this before designing anything around it.** Two things decide whether it
works at all, and both are properties of their tenant, not of our code:

1. **CORS.** The storage host must allow a cross-origin fetch from our origin.
2. **Raw bytes.** SharePoint and Drive sharing links commonly serve an HTML
   viewer page rather than the file. There is usually a direct-download form of
   the URL; whether it is reachable depends on their sharing configuration.

An hour against their real tenant answers both. If it fails, this option is
gone and the choice is A or C.

### If it works, the wording has to change anyway

"Filen skickas aldrig vidare" stays true, but "allt händer här på din enhet" no
longer covers a network fetch. The note in `README.md` and the in-app privacy
panel would need a line saying the file is collected from the employer's own
storage using the user's existing login. Per the standing rule in `README.md`:
an inaccurate privacy claim is worse than none.

## Option C — host it ourselves (a product, not a feature)

The employer uploads the PDF to a service we run; staff get a link. Better UX
than both of the above, including on iPhone. Also the only option that makes us
a data processor.

None of the following is optional:

- **Real authentication.** An unguessable link is a bearer token — forwarded
  once or screenshotted once and the whole roster is public. Personnel data
  needs accounts tied to an identity source, with password resets and the
  support load that implies.
- **Server, storage, retention.** Including deletion when the month expires. The
  rule already exists on-device as `expiryOf` in `src/storage.ts`; it would have
  to hold server-side too, and the two must not drift.
- **GDPR paperwork.** Processor agreement with the employer, documented legal
  basis, retention policy, and a way to answer access and deletion requests.
- **An operator.** Someone answers the phone at 07:00 when it is down and
  nobody can see whether they are working.

`PRODUCT.md` lists "anything that looks like it's harvesting data — no badges,
**no accounts**" under anti-references. This option contradicts that directly.
That does not make it wrong, but it makes it a deliberate change of product,
which should be decided as one.

## Recommendation

1. Build **Option A** now. It is self-contained and helps immediately.
2. Ask the employer's IT what the mail and storage stack is, then spend an hour
   probing **Option B** against the real tenant.
3. Only consider **Option C** if they will not host the file, and treat it as a
   decision about whether to operate a service holding staff personal data —
   not as an engineering ticket.

## Worth raising with the employer

Whoever emails that PDF is already distributing the full workplace roster as an
attachment to every member of staff, every month, where it stays in their
inboxes indefinitely. A link into storage they already control is very likely
*better* than the status quo, not worse — which is a useful way to open the
conversation about Option B.

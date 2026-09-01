# Expected divergences

The deliberate differences between the portal and the iOS app. Anything
the parity harness finds that is **not** described here is classified as
DRIFT, and drift is what a session acts on.

**Adding to this file is part of the change that causes the divergence**,
not a follow-up. A new deliberate difference that is not recorded here in
the same commit shows up in the next session's report as a defect, and
somebody spends an afternoon "fixing" a decision that was made on
purpose.

Each entry carries a `covers:` line the report parser reads. `screen:`
limits it to one screen key from `manifest.py`; `group:` limits it to a
property group (`type`, `color`, `spacing`, `shape`, `presence`).
`presence` is whether the landmark is on the page at all — a RENAME needs
it, and an entry that names a screen with no group excuses everything on
that screen, which is how the classifier got switched off once already. No `covers:` line
means the entry documents a difference that is structural rather than one
the value tables can see — useful to a reader, invisible to the
classifier.

---

## Native tab bar versus sidebar navigation

Web puts primary navigation in a fixed left sidebar; iOS uses the
platform's bottom tab bar. The whole navigation frame therefore differs
in position, size and treatment on every screen, and always will.

- covers: screen:*, group:spacing

## Icon-only actions in place of labelled buttons

Web has horizontal room for "View Client", "Share with Artist", "Invite
team member". At 390pt a row of labelled pills wraps or truncates, so
mobile uses compact icon-plus-short-label controls. The ICON is the same
drawing on both sides — that part is not a divergence, and
`components/icons.tsx` exists to keep it that way.

- covers: screen:inquiry-detail, screen:client-detail, group:spacing

## Card titles are sentence case on mobile

Web's widget headers are uppercase with wide tracking
(`.editorial-btn`-adjacent label styling). Mobile's `EditorialCard` and
`CollapsibleSection` use the display serif at sentence case, which is
what the owner picked for the phone.

- covers: group:type

## Swipe row actions instead of hover menus and inline buttons

A row on web reveals its actions on hover or behind a `⋯`. Neither exists
on a phone, so Clients, Conversations and Notifications carry trailing
swipe panels. There is nothing on the web side to compare them to.

## Borderless chips

Web's status chips are outlined. Mobile's `StatusChip` is a tinted fill
with no border — an owner call, taken because a bordered pill over the
photo cards read as a second frame inside the card.

- covers: group:shape, group:color

## Inquiry photo cards

The Pipeline list on mobile is full-bleed photo cards with a gradient
wash; web's is a table. Nothing about the two rows is comparable, and the
card's contrast trade is recorded separately below.

- covers: screen:inquiries

## Day-plus-upcoming schedule instead of a month grid

Web's Calendar is a month grid. A month grid at 390pt is unusable, so
mobile shows the selected day plus an upcoming list.

- covers: screen:schedule

## A "frequent" row that exists only on mobile

The mobile Clients screen carries a frequent-contacts row above the list.
Web has no equivalent; it is a phone affordance for a phone-sized list.

- covers: screen:clients

## The inquiry card's 4.08:1 contrast

The photo card's description line measures 4.08:1 over a pure-white
photograph — below the 4.5 AA floor, deliberately, confirmed by the owner
on 2026-09-01. See `apps/mobile/src/components/InquiryRow.tsx` and
CLAUDE.md's Design section. **This is the app's one known AA exception.**
Do not "fix" it from a parity report.

- covers: screen:inquiries, group:color

## Chat is a docked panel on web and a tab on mobile

Web opens conversations in a panel over whatever page you are on; mobile
gives it a root tab. Composites for the chat screens are informative
about type and colour but say nothing useful about geometry.

- covers: screen:chat-list

## Read-only staff surfaces on mobile

Settings, the permission matrix, the Team roster and the artist detail
screen are read-only on mobile and editable on web. Editing controls are
absent rather than disabled, so the two sides differ by whole elements
rather than by styling.

- covers: screen:settings, screen:team

## Team: no eyebrow on mobile

Web's Team page leads with an eyebrow — "+ THE ROSTER +" — above the
title. Mobile dropped it in session BA at the owner's direction, so the
title sits at the same height as Clients and Pipeline. The portal keeps
its eyebrow; nobody asked for it to go there.

Found by this harness's own first run, which is the point: it was a
deliberate decision made three sessions ago and recorded nowhere a
comparison could see.

- covers: screen:team, group:spacing

## Team: no "Add directly" on mobile

Web offers two controls, "Add directly" (creates an account with a
password, no email) and "Invite team member" (sends the link). Mobile
ships only the invite. "Add directly" is an account-creation flow with an
avatar upload and a password field; a half-built version would be worse
than its absence.

Recorded here rather than only in `InviteTeamMemberSheet`'s header, where
session BC left it — a reason living in one client's source is invisible
to a comparison of the two.

- covers: screen:team

## Dashboard: a range dropdown on web, pills on mobile

Web's date range is a `<select>`-style dropdown showing the current
choice. Mobile shows the three presets as pills, always visible. A
dropdown at 390pt costs a tap to see what the options even are, and there
are only three.

Recorded after the first full run showed the two side by side.

- covers: screen:dashboard, group:shape, group:spacing

## Inquiry detail: "The request" instead of "Inquiry Details"

Web's intake answers sit in a widget titled "Inquiry Details". Mobile
calls the same section "The request". Same fields, same order, different
heading — mobile's phrasing predates the parity harness and is the
owner-facing wording on the phone.

- covers: screen:inquiry-detail, group:presence, group:type

## Inquiry detail: reference and placement photos live inside "The request"

Web gives them two widgets of their own, "Reference images" and
"Placement photos". Mobile folds both into "The request" as labelled
strips, an owner decision in session BC: on a phone they are two more
headers over the same question the section already answers. Web's own
label wording is kept ("Placement photos").

Both lists page through ONE full-screen viewer, so a swipe carries from
the reference art to the placement photo.

- covers: screen:inquiry-detail, group:presence

## Inquiry detail: singular "Appointment", and "Client" for "View Client"

Mobile's section is "Appointment" (it shows one) where web's is
"Appointments"; the header action reads "Client" where web's reads "View
Client". Both are length, not meaning — a labelled pill row at 390pt is
already close to wrapping.

- covers: screen:inquiry-detail, group:presence, group:type

## Inquiry detail: no field-level diff in Activity History

Both clients now show the activity trail. Web additionally renders a
from/to diff of every changed field; mobile shows actor, action and time
only.

That diff is most of `AuditTrail.tsx`'s 442 lines, and a wall of from/to
pairs is not what a phone screen is for. Added in session BH along with
the section itself, so the omission is a recorded decision rather than a
gap somebody finds later.

- covers: screen:inquiry-detail, group:presence

## Mobile collapses most sections by default; web expands everything

Web renders every widget open. Mobile opens Progress, Assignment and
Estimate and leaves the rest collapsed — ten expanded cards do not fit on
a 390pt screen, and the collapse/expand-all control in the header exists
for exactly this.

**This is also a measurement limit, not only a design difference.** The
harness can only read what is in the DOM, so a landmark INSIDE a
collapsed mobile section reports MISSING even when the content is
present and correct. Read those rows as "not measured here", and confirm
by expanding rather than by filing drift.

- covers: screen:inquiry-detail, screen:client-detail, group:presence

## Progress: the current step is gold on mobile, red on web

Web draws the step being worked toward in red. Mobile uses gold, because
red is punctuation in this design system — reserved for errors and
destructive actions (CLAUDE.md's Design section). The decision predates
the harness and is recorded in `staff-inquiry/[id].tsx` beside the style.

Only the CURRENT step differs. Done and pending steps use web's own
mapping (`text-fg-secondary` and `text-fg-muted`), which session BH
corrected.

- covers: screen:inquiry-detail, group:color

## Inquiry detail: "Deposits (N)" and singular "Appointment"

Mobile's deposit card carries its count in the title and its appointment
card is singular. Web titles them "Deposit" and "Appointments". Length,
not meaning — recorded so the presence check stops reporting them.

- covers: screen:inquiry-detail, group:presence, group:type

# Parity harness

Proves that a mobile screen matches its portal counterpart, instead of a
session asserting it did.

```bash
python tools/parity/parity.py                    # every screen, as owner
python tools/parity/parity.py --role artist
python tools/parity/parity.py --screens team     # one screen, while iterating
python tools/parity/parity.py --keep-servers     # leave vite/expo running
```

Output: `tools/parity/out/<date>/<role>/index.html`, a contact sheet with
composites, diffs and a value table per screen.

## What it does

1. Boots `apps/web` (vite) and the `apps/mobile` web harness against the
   **same dev database**, and signs both in as the **same account**. A
   harness comparing two datasets reports content differences as design
   drift.
2. Per screen: web at 390×844, web at 1440×900, mobile at 390×844. Web
   gets two viewports because some portal layouts only exist wide, and
   comparing a desktop table against a phone list reports responsive
   design as a defect.
3. Composites web | mobile, and writes a coarse difference map.
4. Reads computed values off **named landmarks** on both sides and
   tabulates `property | web | mobile | verdict`.
5. Classifies every mismatch as **EXPECTED** — named in
   [`expected-divergences.md`](expected-divergences.md) — or **DRIFT**.
   Drift is the punch list.

## What it is NOT valid for

**Layout, type, colour and spacing only.**

It says nothing about **motion**, **gestures**, or **true native
rendering**. Reanimated does not advance inside app subtrees under this
harness, and gesture-handler is inert to synthetic input — both are
recorded in CLAUDE.md, both discovered the hard way. A clean parity
report is not a substitute for the owner's device gate and must never be
presented as one.

The pixel-difference percentage is **context, not a gate**. Two different
renderers are never pixel-identical; it tells you where to look. The
value tables decide.

## Adding a screen or a landmark

Both live in [`manifest.py`](manifest.py).

Landmarks are **addressed by text**, not by CSS selector. react-native-web
emits generated atomic class names that change whenever a style does, so
no selector works on both sides for long. Text is the one thing the two
clients genuinely share — and if they stop sharing it, that is itself
drift, reported as MISSING rather than as a silently wrong measurement.

A screen with no landmarks still gets screenshots and a composite; the
table just says so. Adding landmarks is how a screen goes from "looks
about right" to measured.

## The preview route

The mobile app cannot log in under expo web (secure-store plus CORS), so
a signed-in screen is only reachable by injecting a session. The harness
**writes `apps/mobile/src/app/parity-preview.tsx` at the start of a run
and deletes it at the end**, rather than keeping it in the tree: this is
a tool, and a route that ships in the production bundle to serve it is
product code. A run that crashes leaves the file behind; the next run
removes it and says so.

Before this existed, every session hand-wrote its own throwaway preview
route, used it, and deleted it. That is what this replaces.

## Requirements

- Python with `playwright` and `pillow` (`pip install playwright pillow`;
  the browsers are the ones Playwright already installed for the MCP
  server).
- The repo's own dev dependencies — the harness shells out to `npx vite`,
  `npx expo` and `npx tsx`. No new npm dependency is added to the
  monorepo, matching `tools/motion-probe`'s precedent.
- `apps/api/.env` present, and a dev database with at least one studio
  that has inquiries.

## Known limitations, honestly

- **The mobile Dashboard captures blank.** Found by the first full run and
  left as a finding rather than fixed, since this session ships the
  harness and not fixes. It is either a genuinely empty screen for this
  account or an error inside it; either way the harness is reporting
  truthfully.
- **Landmarks are defined for five screens so far.** The rest get
  screenshots and composites but no value table. Filling them in is
  cheap and is how the harness earns more of its keep.
- **The chat list has no web counterpart** — the portal opens
  conversations in a docked panel, so there is no route to navigate to.
  That row is mobile-only by construction, not a failure.
- **One browser, one engine.** Both sides render in the same Chromium, so
  this cannot see anything that differs because iOS Safari or a real
  device renders differently. That is what the device gate is for.

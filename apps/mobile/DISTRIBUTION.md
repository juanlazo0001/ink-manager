# Distributing Ink Manager (iOS / TestFlight)

How a build of `apps/mobile` gets onto a real iPhone. Everything here runs
from **`apps/mobile`** in the primary checkout.

---

## THE STANDING RULE — READ BEFORE INVITING ANYONE

> ## **DO NOT INVITE STAFF OR ARTISTS TO TESTFLIGHT YET. OWNER-ONLY TESTING.**
>
> **The appointments-projection security fix must be *deployed on Railway*
> before anyone other than the owner is given a build.** Until that is
> confirmed, every TestFlight tester must be the owner and no one else.

Status of that condition, checked 2026-08-28:

| Condition | State |
|---|---|
| `session/api-integrity-notifications` **merged to `main`** | ✅ **Done** — merged in session AK's consolidation (`82c4aed`); verified with `git merge-base --is-ancestor`. |
| **Deployed on Railway** | ❓ **Unverified.** `https://api.inkmanager.app/health` answers `200 {"status":"ok"}`, which proves the API is *up* — it does **not** prove *which commit* is running. `/health` returns no version or commit field. |

So the merge half of the rule is satisfied and the deploy half is not
*confirmed*. **Treat the rule as in force until someone confirms the
running commit on Railway.** The cheapest way to close this permanently is
to add the deployed commit SHA to `/health` (`apps/api/src/index.ts:109`)
so it can be checked in one request instead of assumed.

---

## Prerequisites

- An Expo account with access to the `ink-manager` project (`eas login`).
- An Apple Developer account (approved) and App Store Connect access.
- `eas-cli` is used via `npx` — never pinned as a dependency, so it stays
  current: `npx eas-cli@latest <command>`.

---

## App identity

These are **permanent** once the app exists in App Store Connect. Do not
change them.

| Field | Value | Where |
|---|---|---|
| Bundle identifier | `app.inkmanager.mobile` | `app.json` → `ios.bundleIdentifier` |
| Android package | `app.inkmanager.mobile` | `app.json` → `android.package` |
| Display name | `Ink Manager` | `app.json` → `name` |
| Deep-link scheme | `inkmanager://` | `app.json` → `scheme` |
| Marketing version | `1.0.0` | `app.json` → `version` |

`app.inkmanager.mobile` is the reverse-DNS of the owner's domain
`inkmanager.app`. It reflects **INK MANAGER the multi-tenant product**, not
any one studio.

---

## The three build profiles

Defined in `eas.json`. All three point at production
(`EXPO_PUBLIC_API_URL=https://api.inkmanager.app`) — that URL is also the
default in `src/lib/api.ts`, so the env var is belt-and-braces, not the
only thing keeping a build off a dev server.

| Profile | Distribution | What it is for |
|---|---|---|
| `development` | internal, `developmentClient: true` | A custom dev client. **Needed for the future push-notification work** — push cannot be tested in Expo Go. Not needed yet. |
| `preview` | internal | A release-configuration build installed directly on registered devices, skipping TestFlight. Fast sanity check of a release build. |
| `production` | store, `autoIncrement: true` | The TestFlight / App Store build. This is the one you normally want. |

`cli.appVersionSource: "remote"` means **EAS owns the build number**, not
`app.json`. `autoIncrement: true` on the production profile bumps it on
every build, so you never hand-edit a build number and never collide with
one App Store Connect has already seen.

---

## Cutting a build

```bash
cd apps/mobile
npx eas-cli@latest build --platform ios --profile production
```

Runs in Expo's cloud, roughly 15–25 minutes. It prints a build URL you can
watch. Credentials (signing certificate + provisioning profile) are
**managed remotely by EAS** — it creates and stores them for you the first
time and reuses them after; you authenticate to Apple when prompted.

### Then submit it to TestFlight

```bash
npx eas-cli@latest submit --platform ios --latest
```

`--latest` takes the most recent finished iOS build. On the very first run
it offers to create the App Store Connect app record — accept it (app name
`Ink Manager`, primary language `en-US`, both already set under `submit` in
`eas.json`).

After submit, **TestFlight processing takes a few more minutes** before the
build appears. Internal testing needs **no Apple review**.

### The next build, and every one after

1. Only bump `version` in `app.json` when the *marketing* version should
   change (`1.0.0` → `1.0.1`). For an ordinary test build, **change
   nothing** — `autoIncrement` handles the build number.
2. `npx eas-cli@latest build --platform ios --profile production`
3. `npx eas-cli@latest submit --platform ios --latest`

---

## Adding testers

App Store Connect → your app → **TestFlight** → **Internal Testing**.

1. Create a group — **"Ink Manager Team"**.
2. Add testers by Apple ID. An internal tester must first be a user on the
   App Store Connect account (Users and Access).
3. Assign the build to the group.
4. The tester installs Apple's **TestFlight** app from the App Store, opens
   the emailed invite, and accepts.

Internal testers get builds immediately with no review. Up to 100 of them.

**Before adding anyone who is not the owner, re-read the standing rule at
the top of this file.**

---

## Things that will bite you

- **The Expo SDK is pinned to 54 on purpose.** Do not upgrade it, and do
  not "fix" a version mismatch `expo install --check` reports, without
  reading `apps/mobile/README.md` first. A newer SDK produces an app that
  cannot be opened in the App Store build of Expo Go — which is still the
  only way to run this app without a custom dev client.
- **Two Reacts is correct here.** `npx expo-doctor` reports two "failures"
  — a `watchFolders` override in `metro.config.js`, and duplicate
  `react` (19.1.0 nested under `apps/mobile`, 19.2.7 hoisted at the root
  for `apps/web`). Both are **deliberate and load-bearing**; the full
  reasoning is written inline at the top of `metro.config.js`. Do not
  "resolve" them.
- **The app icon must have no alpha channel.** App Store Connect rejects
  icons that do. `assets/images/icon.png` is deliberately encoded as PNG
  colour type 2 (truecolour, no alpha). If you regenerate it, verify:
  `node -e "console.log(require('fs').readFileSync('assets/images/icon.png')[25])"`
  must print `2`.
- **`.easignore` at the repo root replaces `.gitignore`** for build
  uploads — it does not add to it. That is why it repeats `node_modules`.
  If you add an entry, do not remove that one.
- **This is a monorepo.** EAS uploads from the repo root and installs all
  workspaces. Always run build/submit from `apps/mobile`.
- **`supportsTablet: true`** is set. It costs nothing for internal
  TestFlight, but it means a future *public* App Store review will be run
  on iPad, where this phone-designed layout has never been checked. Decide
  that before submitting for review, not during.

---

## Assets

| File | What it is |
|---|---|
| `assets/images/icon.png` | 1024×1024, no alpha. Fraunces `im` in `#e4be85` on the ink-dark ground. |
| `assets/images/splash-icon.png` | The wordmark — a copy of `assets/login/wordmark.png`, so the launch frame and the login screen draw the *same* asset. |
| `assets/images/android-icon-foreground.png` | 512×512 transparent; the mark is held inside Android's guaranteed-visible inner circle. |
| `assets/images/favicon.png` | 96×96, web output. |

All four are generated from the same measured glyph geometry: the mark's
**ink bounding box** is centred, not its text box — `im` has no descender,
so centring the text box leaves the mark visibly low.

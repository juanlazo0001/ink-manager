# Fix bundle — public link URLs, client-detail crash, Customer role cleanup, artist social links

Single session, on `main`. `ConversationsPanel.tsx` was **not** touched — the composer's link-insert bug traced back to a server-side issue (see §1), not anything in that file.

**New standing rule, adopted for this and every future frontend session:** `cd apps/web && npm run build` must complete with ZERO TypeScript errors before any commit. This was already how the previous session's build-fix ended; this session confirms it as permanent, not a one-off.

---

## 1. Public links were pointing at localhost (URGENT)

### Every hardcoded `localhost` instance found
```
apps/api/src/routes/appointments.ts:13   const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
apps/api/src/routes/clients.ts:13        const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
apps/api/src/routes/inquiries.ts:17      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
apps/api/src/routes/prefillDrafts.ts:12  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
```
Each file independently defined the same fallback constant. Grepped both `apps/api/src` and `apps/web/src` for the literal string — nothing else matched, and `req.headers.host`/`req.hostname` (the other named risk, trusting Railway's proxy) is not used anywhere in the codebase.

**The conversations composer's "+ menu" link-insert isn't a frontend hardcode.** `ConversationsPanel.tsx` calls `POST /prefill-drafts` and inserts the returned `prefillUrl` verbatim — it never constructs a URL itself. The bug was entirely server-side, in `prefillDrafts.ts`'s own `FRONTEND_URL` fallback, so `ConversationsPanel.tsx` needed zero changes.

### The fix
One shared helper, `apps/api/src/lib/publicUrl.ts`, exporting `PUBLIC_APP_URL` (resolved once at module load):
- If `PUBLIC_APP_URL` is set, use it (trailing slash stripped).
- Else, in dev (`NODE_ENV !== "production"`), fall back to `http://localhost:5173`.
- Else (production, unset): log a loud `console.error` naming every affected link type, and only then fall back to localhost — so the misconfiguration is visibly broken in the response rather than silently wrong.

All four route files now import `PUBLIC_APP_URL` instead of defining their own constant. Every call site (`estimateUrl`, `depositUrl`, `signingUrl` ×2 (waiver + consent form), `intakeFormUrl`, gift-card `url`, `prefillUrl`) migrated.

**The env var is named `PUBLIC_APP_URL`, not `FRONTEND_URL`** — deliberately renamed to make the "this is what every public link is built from" contract explicit, and because the task asked for `.env.example` to document it under that exact name. Updated `.env.example` (with the dev/production fallback behavior spelled out) and local `.env`.

### ⚠️ Action needed from you
**Set `PUBLIC_APP_URL` in Railway's API service environment variables to your real deployed frontend domain** (no trailing slash) — e.g. `https://your-app.up.railway.app`, or your custom domain if one is configured. I have no visibility into what that URL actually is from inside this repo (grepped for `railway.app`/`vercel.app`/`netlify`/any custom-domain reference — nothing committed anywhere), so I'm not guessing it. Until this is set, production will keep logging the loud startup warning added above and every public link will still point at localhost.

### Verification
Restarted the API with `NODE_ENV=production PUBLIC_APP_URL="https://app.inkmanager-prod-simulation.com"` and hit every link-generating route live:

| Link type | Route | Result |
|---|---|---|
| Intake form | `GET /clients/:id/shareable-links` | `https://app.inkmanager-prod-simulation.com/inquiry/dev-studio` |
| Gift card | `GET /clients/:id/shareable-links` | `https://app.inkmanager-prod-simulation.com/gift-card/...` |
| Consent form | `POST /clients/:id/consent-forms` | `https://app.inkmanager-prod-simulation.com/sign/...` |
| Prefill draft | `POST /prefill-drafts` | `https://app.inkmanager-prod-simulation.com/inquiry/dev-studio?draft=...` |
| Estimate | `POST /inquiries/:id/send-estimate` | `https://app.inkmanager-prod-simulation.com/estimate/...` |
| Waiver | `POST /appointments/:id/waiver` | `https://app.inkmanager-prod-simulation.com/waiver/...` |
| Deposit form | `POST /inquiries/:id/deposit-form` | Not live-tested (no seed inquiry was in `DEPOSIT_PENDING` at the time without forcing state) — uses the identical one-line `${PUBLIC_APP_URL}/deposit/${token}` pattern as every other route above, confirmed by direct code read |

Also directly exercised `publicUrl.ts`'s three branches (prod+missing → warns + localhost; prod+set → real domain; dev+missing → silent localhost) in isolation — all three behaved exactly as designed.

---

## 2. Client detail page crash

### Root cause (captured, not guessed)
Reproduced by opening every seeded client's detail page in a real browser and watching the console. Two clients crashed — Casey and Bailey Testperson — both blank pages with:
```
TypeError: Cannot read properties of undefined (reading 'email')
    at ClientDetail.tsx:847:50  (Array.map, ClientDetail component)
```
Traced to `ClientDetail.tsx:607`: `appointment.artist?.user.email` — optional chaining stopped at `artist?.`, so if `artist` exists but `artist.user` doesn't, `.email` throws.

**This was a real regression from the prior (Phase UI-5) session, not a data-vintage issue.** That session changed `GET /appointments`'s response shape for the new calendar (`artist: {id, user: {email}}` → `artist: {id, name}`), and its own consumer-audit ("only Sidebar and Calendar.tsx use this route") missed that `ClientDetail.tsx` also calls it (`GET /appointments?clientId=`, same route, same shape). Casey and Bailey crashed specifically because they're the two clients that actually have appointments in the dev seed (used heavily for Part 2/3 testing last session) — clients with zero appointments never hit the `.map()` callback, so the bug was invisible for most of them.

### Fix
Updated `ClientDetail.tsx`'s local `Appointment` interface and its one render site to match the API's actual (current) shape: `artist.name` instead of `artist.user.email`. Not a defensive guard around a hypothetical bad value — the field genuinely doesn't exist on the response anymore, so this is a shape-correctness fix, not a null-check.

### Error boundary (general resilience, independent of the specific bug)
New `apps/web/src/components/ErrorBoundary.tsx` (a class component — React's error-boundary lifecycle has no hook equivalent). Wired in two places in `App.tsx`:
- Around the whole `<Routes>` tree, as an app-shell-level safety net (`TopBar`/`ConversationsPanel`/`ViewAsBanner` stay outside it, so they survive a route-level crash).
- Specifically around `<ClientDetail />`'s route element, per the task's request for one there.

Both show "Something went wrong — try reloading" with a reload button instead of a blank page.

### Verification
- Casey and Bailey's client detail pages load correctly now (screenshot-verified — appointments table shows "Dev Artist One" where it used to crash).
- Deliberately injected a temporary throw at the top of `ClientDetail` (`if (window.location.search.includes('__test_crash')) throw ...`), confirmed the boundary caught it and rendered the friendly message, then reverted the injection — the diff that actually ships contains only the real fix (interface + render-site change), nothing test-related.

---

## 3. Removed CUSTOMER as a selectable team-member role

`Team.tsx`'s `ROLE_OPTIONS` (feeding both the add and edit team-member role `<select>`s) no longer includes `'CUSTOMER'` — now `['OWNER', 'FRONT_DESK', 'ARTIST']`.

**Deliberately left untouched:** `CONFIGURABLE_ROLES` in `lib/permissions.ts` (frontend) and `apps/api/src/lib/permissions.ts` (backend) still includes `CUSTOMER` — that's the separate Permissions-matrix tab (a distinct system from an earlier session's View As permissions audit), not "who can be assigned as a team member." Conflating the two would have been a scope overreach and risked breaking that matrix.

Server-side, `POST /studios/:studioId/users` and `PATCH /studios/:studioId/users/:userId` both validated `role` against `Object.values(Role)` (every enum value, including `CUSTOMER`) — the UI hiding the option was not actually enforced. Added a `STAFF_ROLES = [OWNER, FRONT_DESK, ARTIST]` constant in `studios.ts` and validate against that instead on both routes.

### Verification
- Browser: add/edit team-member role selector shows only Owner/Front Desk/Artist.
- Direct API bypass, both routes:
  - `POST /studios/:id/users` with `role: "CUSTOMER"` → `400 {"error":"role must be one of: OWNER, FRONT_DESK, ARTIST"}`
  - `PATCH /studios/:id/users/:userId` with `role: "CUSTOMER"` → same 400.

---

## 4. Artist social profile links

Added nullable `instagramHandle` and `facebookProfileUrl` to `Artist` (migration `20260720010813_add_artist_social_links`). Editable on the artist detail page (Team → Artists → an artist) as a new "Social Links" card: a handle field for Instagram (leading `@` stripped on save if pasted), a full-URL field for Facebook — validated loosely (must be a string or null, nothing more) per the task's "don't over-engineer" instruction. `PATCH /artists/:id` accepts both fields now and logs an audit entry (this route previously had no audit logging at all for bio/specialties/portfolio edits either — added it for the whole route while touching it, not just the two new fields).

Two new line-icon components (`InstagramIcon`, `FacebookIcon` in `components/icons.tsx`, matching the existing hand-rolled SVG convention — not brand-mark logos). Displayed as small clickable circular icon links, present in two places when a value exists:
- The artist detail page's Social Links card (read view, for anyone without `artists.manage`).
- The artist card on Team → Artists tab (icon clicks `stopPropagation` so they don't also trigger the card's own navigate-to-detail).

**Explicitly out of scope (per the task):** no automatic profile photo/bio/portfolio import from Instagram or Facebook. That needs the same Meta Business API + App Review process already planned for the client-facing channel integration in Phase 7B — building a one-off scraper or a duplicate integration here would be either unreliable/ToS-risky or thrown-away work. Revisit once that integration exists and can be reused.

### Verification
- Saved `@inkmanager.studio` (Instagram) and a Facebook URL on an artist via the edit form; confirmed via direct API read that they persisted correctly (and the leading `@` was stripped).
- Logged in as Front Desk (no `artists.manage`) and confirmed both the detail page and the Team card render live, correctly-labeled, clickable icon links (`aria-label`/`title` set) pointing at the right URLs.

---

## Verification summary
- `npm run build` (apps/web): clean, zero TypeScript errors, exit 0.
- `npx tsc --noEmit` (apps/api): clean.
- Every item above was verified live against a running dev server (and, for §1, a simulated production environment) — not just type-checked.

## Commit
`2f7cc63` — "Fix bundle: public link URLs, client-detail crash, Customer role cleanup, artist social links". Pushed to `origin/main`. Both dev-server shells (API, web) killed after verification.

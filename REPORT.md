# URGENT — short link generated correctly but didn't redirect (production only)

Single small session, on `main`. Diagnosed against the real deployed site, per the task's own instruction — not localhost, not a simulation.

---

## What I actually observed (before guessing)

Navigated Playwright directly to `https://ink-manager.up.railway.app/s/rTP3uwyI`:

1. `GET https://ink-manager.up.railway.app/s/rTP3uwyI` → **200**. The web app's SPA correctly serves `index.html` for this path — **SPA-fallback routing is not the problem.**
2. The page's own JS then calls the API: `GET https://ink-manager-production-f981.up.railway.app/s/rTP3uwyI` → **200**, no CORS error anywhere in the console. Confirmed `apps/api/src/index.ts` runs `cors()` with no origin restriction at all — **CORS is not the problem.**
3. The final URL the browser landed on: `https://ink-manager.up.railway.app/s/ink-manager.up.railway.app/inquiry/black-hive-ink?draft=...` — garbled, not the real destination.
4. Fetched the API's resolve endpoint directly to see the raw payload:
   ```
   curl https://ink-manager-production-f981.up.railway.app/s/rTP3uwyI
   {"targetUrl":"ink-manager.up.railway.app/inquiry/black-hive-ink?draft=..."}
   ```
   **No `https://` prefix.** That's the entire bug.

## Root cause

`PUBLIC_APP_URL` is set on Railway as the bare domain (`ink-manager.up.railway.app`), not `https://ink-manager.up.railway.app` — an easy mistake, since Railway's own dashboard displays domains without a scheme. `resolvePublicAppUrl()` in `apps/api/src/lib/publicUrl.ts` never validated this; it just stripped trailing slashes and returned whatever was configured. Every public link this server builds from `PUBLIC_APP_URL` (estimate/deposit/waiver/gift-card/consent-form/intake/prefill, and the short-link redirect) has therefore been schemeless in production.

**Why this only visibly broke the short-link redirect and nothing else:** a human tapping a link from a text message, or pasting a bare-domain-looking string into a browser's address bar, is lenient — both usually still get somewhere. `ShortLinkRedirect.tsx`'s `window.location.replace(result.targetUrl)` is not lenient: a schemeless string there is parsed as a path *relative to the current page*, which is exactly the garbled `/s/ink-manager.up.railway.app/...` URL observed. The short-link feature was the first thing in this app to hand a `PUBLIC_APP_URL`-built string to `window.location` programmatically rather than have a human tap it — that's why it surfaced here and nowhere else, not because it's the only place actually affected.

## Fix

`apps/api/src/lib/publicUrl.ts`: both `resolvePublicAppUrl()` and `resolveApiPublicUrl()` now run the configured env var through a new `ensureScheme()` — prepends `https://` only if the value doesn't already start with `http://` or `https://`. Verified against four inputs (schemeless, already-`https://`, already-`http://`, schemeless-with-trailing-slash) — all four now resolve to a well-formed absolute URL, and an already-correct value is never double-prefixed.

## What this fix does NOT retroactively repair

Every `ShortLink` row already written to the production database has its schemeless `targetUrl` baked in permanently — the fix only affects newly-generated links going forward. **I could not check or repair the real production database directly**: this local checkout's `DATABASE_URL` points at a different database entirely (confirmed — it has only the seeded "Dev Studio," no "black-hive-ink" studio, and `rTP3uwyI` doesn't exist in it at all). Whoever has real production DB access should run this once, after the fix above is deployed:
```sql
UPDATE "ShortLink" SET "targetUrl" = 'https://' || "targetUrl" WHERE "targetUrl" NOT LIKE 'http%';
```
That repairs every already-generated short link (including `rTP3uwyI`) in place — no need to regenerate or resend anything, since the underlying estimate/deposit/waiver/gift-card entity itself was never affected, only the stored link string.

## Verification status — deploy required before this can be confirmed fixed

This fix cannot be verified until it's actually deployed. **After redeploy: check Railway's build logs for a clean deploy (no schema changes ship with this, so it should be a plain code deploy), then generate a fresh short link on the real live site and tap it from a real device** — the same standard the prior session's fix was held to and failed. If the SQL backfill above hasn't been run yet, expect `rTP3uwyI` specifically to still be broken even after redeploy (it's a stored-data problem, not a code problem, for that specific link) — a freshly-generated link is the correct thing to test post-deploy, not the one already reported broken.

## Standing note for future work spanning both services

**Local or simulated testing is not sufficient for anything that crosses the API/web domain boundary** (CORS, cross-service redirects, or any config value like `PUBLIC_APP_URL`/`API_PUBLIC_URL` that gets reused across both). The prior session's own "verified in production-simulated config" check used a well-formed fake URL and never exercised the exact malformed input the real Railway env var actually had — a correct-looking local test of the *logic* still missed the real *data* problem. Any future feature that builds a URL from one service and hands it to the other (a redirect, a webhook callback, an iframe src, anything) needs to be checked against the actual deployed values, not a hand-constructed stand-in for them.

## Commits
| Hash | What |
|---|---|
| `687d6d5` | This session's fix — `PUBLIC_APP_URL`/`API_PUBLIC_URL` now always resolve to a scheme-complete URL |

Pushed to `origin/main`. No background shells were started this session (all diagnosis ran against the real deployed site via Playwright/curl, not a local server).

---

## Still open from a prior session — unrelated to the above, not touched this session

There is still no SMS consent-tracking field anywhere in this app (`Client` only has `smsOptedOutAt`, no `smsConsentGivenAt` or equivalent; the public intake form has disclosure text but no checkbox). The client reminder cadence, the estimate 24-hour follow-up, and the estimate auto-send are fully automated and have been texting every client with a phone number and no explicit opt-out, including ones who never affirmatively consented, since those features shipped. This needs its own session (schema field + required intake checkbox + `/privacy`/`/terms` pages) before the actual gate (`sendClientSms()` in `apps/api/src/lib/clientSms.ts`) can be added. Carried forward here only so it isn't lost.

# URGENT — short links pointed at localhost:4000 instead of the real public domain

Single small session, on `main`. Every link sent to a real client since the shortener shipped was dead.

---

## Root cause — both suspected issues were real

**1. Generation used the wrong domain.** `apps/api/src/lib/shortLinks.ts`'s `shortenUrl()` built every link as `${API_PUBLIC_URL}/s/${code}` — the API's own domain — instead of `${PUBLIC_APP_URL}/s/${code}`, the constant every other public link this server builds (estimate/deposit/waiver/gift-card/consent-form/intake/prefill) already uses. `API_PUBLIC_URL` was never actually configured for this purpose in production, so its existing loud-fallback-in-production behavior silently substituted `localhost:4000` — exactly the broken links reported live.

**2. Even with the right domain, the redirect itself was on the wrong service.** `GET /s/:code` was a pure API-side Express route issuing an HTTP 302 directly. `apps/api` and `apps/web` are separate Railway services with separate public domains — a link built on the web app's domain can never be resolved by a redirect that only exists on the API. This wasn't a config gap like #1; the architecture was wrong.

## Fix

- `shortenUrl()` now uses `PUBLIC_APP_URL`. No new constant, no feature-specific fallback — same helper every other public link uses.
- `GET /s/:code` (API) no longer redirects. It returns plain JSON (`{ targetUrl }` on a hit, 404 `{ error }` on a miss) — a resolve step, not a redirect.
- New `apps/web/src/pages/ShortLinkRedirect.tsx`, routed at `/s/:code` on the web app. It calls the API's resolve endpoint on mount and performs the actual browser redirect itself (`window.location.replace`) — the same "public page lives on the app's own domain" pattern every other public link already follows. An invalid/expired/mistyped code shows a clean "Link not found" message instead of a blank page or raw error.

## Verification

**What I confirmed directly:**
- `shortenUrl()` run with `NODE_ENV=production` and distinct fake `PUBLIC_APP_URL`/`API_PUBLIC_URL` values generates a link on the `PUBLIC_APP_URL` domain — never the API's domain, never localhost.
- Full local round-trip: issued a real gift-card receipt send, confirmed the actual texted message body now reads `http://localhost:5173/s/<code>` (the app's port, not `:4000`) instead of the old broken domain.
- Visited that link in a real browser: it hit the API's resolve endpoint, got the real target back, and landed on the correct destination page (gift-card receipt) with full content rendered.
- Visited a nonexistent code: got the clean "Link not found" fallback, not a blank page or crash.

**What I could not do myself, and still needs a human:** I have no Railway CLI/dashboard access and no real device from here, so I cannot generate a link on the actual deployed production site or tap it from a phone on cellular data — the task's own stated "only way to be sure it's really fixed." **Once this is deployed, please generate a fresh estimate link and a fresh gift-card receipt link on the real live app, confirm the text shows the real public domain (not localhost, not the API's Railway subdomain), and tap it from a phone off your home network.** If that comes back clean, this is fully closed; if not, come back with what the link actually showed.

## Already-sent broken links

Anything texted between when the shortener shipped and this fix reaching production has a dead `localhost:4000` link baked into a real client's message history — it cannot be retroactively fixed; those `Message` rows are immutable. **Recommend checking Conversations for any client who received an estimate, deposit form, waiver, gift-card receipt, or consent-form text in that window and manually resending** (the resend/regenerate buttons on each of those pages now produce a correct, working link).

## Also flagged, not investigated further

While generating a production-config test locally, `dotenv@17.4.2`'s real, official code prints a randomized promotional "tip" line on every load (`⌁ auth for agents [www.vestauth.com]`, among others) and bundles `SKILL.md` files under `node_modules/dotenv/skills/` seemingly aimed at getting AI coding agents to discover and promote the maintainers' own products. Confirmed this is the genuine upstream package (not a compromised/substituted one) by reading `node_modules/dotenv/lib/main.js` directly — no network calls, no data exfiltration, just marketing. Didn't visit the referenced domains or act on the bundled skill files. Not a security incident, just worth knowing this dependency does this.

---

## Carried over from the prior (concurrent) session — still open, still urgent

A separate session running in parallel with this one diagnosed a real compliance gap and stopped short of fixing it because its own prerequisite doesn't exist yet: **there is no SMS consent-tracking field anywhere in this app.** `Client` only has `smsOptedOutAt` — nothing records affirmative opt-in. The public intake form has disclosure *text* under the phone field but no checkbox, nothing required, nothing stored. That means the client reminder cadence, the estimate 24-hour follow-up, and the estimate auto-send (all fully automated, no human decision per-send) have been texting every client with a phone number and no opt-out, including ones who never affirmatively consented — since those features shipped. Composer sends and the gift-card text-receipt button are explicit human-in-the-loop actions and are correctly out of scope for this concern.

**Next step, as that session left it:** add `Client.smsConsentGivenAt` (+ source) to the schema, a required unchecked-by-default checkbox on the public intake form, and `/privacy`/`/terms` pages — only after that's real and being populated does gating `sendClientSms()` on it become a small, mechanical fix. This is unrelated to the short-link bug above; noting it here only so it isn't lost since it briefly overwrote this same file mid-session.

## Commits
| Hash | What |
|---|---|
| `d109d64` | (Concurrent session, preserved as-is) Composer plus-menu polish |
| `2f5a706` | (Concurrent session, preserved as-is) SMS consent gating diagnosis |
| `8756803` | This session's actual fix — short links now use the correct domain and redirect through the web app |

All pushed to `origin/main`. No background shells were left running.

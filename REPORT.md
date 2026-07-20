# Consolidated Phase 7B — Integrations framework + live SMS, then the full reminder cadence

Two parts, one session, on `main`. Each part committed and pushed independently before the next began.

**Standing rule honored at every checkpoint:** `cd apps/web && npm run build` (zero TS errors) and `cd apps/api && npx tsc --noEmit` (zero TS errors) both clean before every commit below.

---

## Part 1 — Integrations framework + live SMS (Twilio)

Commit `dd33f4c`.

Built a self-serve, multi-tenant integrations chassis (`StudioIntegration`, keyed by `studioId`+`channel`) so a studio owner connects their own provider account via Settings → Integrations — no per-studio credentials ever live in a Railway env var. Email/Instagram/Facebook/Google Calendar are defined as channels but show "Coming soon"; SMS via Twilio is fully built.

- **Encryption**: `lib/secrets.ts`, AES-256-GCM, 32-byte key from `INTEGRATION_ENCRYPTION_KEY` (base64). No route ever returns a decrypted secret — only masked display (`AC…**** · +1XXXXXXXXXX`).
- **Connect flow**: Account SID/Auth Token/From number are validated against Twilio's real API before anything is stored; on success the studio is `CONNECTED` with an encrypted secret and masked display name; on failure, `ERROR` + `lastError`, nothing half-stored. Connect/disconnect are audited (channel + masked display only, never the secret).
- **Outbound**: the conversation composer sends a real SMS when the studio is `CONNECTED` and the client has a phone and isn't opted out — a `Message` row is persisted only on Twilio's acceptance, with `metadata.providerSid`/`deliveryStatus`. Any other case (not connected, other channel) is the original log-only behavior — zero regression.
- **Inbound**: `POST /webhooks/twilio/sms` (public). Studio is resolved by the `To` number matching a `CONNECTED` integration **first**, then that studio's own decrypted Auth Token verifies `X-Twilio-Signature` — verifying the signature before knowing which studio's token to check against is structurally impossible, and this ordering is the multi-tenant security hinge of the whole webhook. Client is matched by phone (including `ClientPhone` aliases) or auto-created; MMS media is re-uploaded server-side to Cloudinary since Twilio's media URLs need Twilio's own Basic Auth to fetch.
- **Opt-out**: STOP/UNSUBSCRIBE/CANCEL/QUIT sets `Client.smsOptedOutAt` (audited as a system action); START/UNSTOP clears it. Outbound to an opted-out client is refused server-side regardless of what the UI shows.

**Real bug found and fixed during live verification**: Twilio's API rejects a `localhost` `StatusCallback` URL outright, which would have silently broken every real outbound send in local dev. `TWILIO_STATUS_CALLBACK_URL` now resolves to `null` whenever `API_PUBLIC_URL` contains `localhost`.

**Webhook URL** (dev): `http://localhost:4000/webhooks/twilio/sms`. **Railway variable to set before going live in production: `API_PUBLIC_URL`** (same loud-fallback pattern as `PUBLIC_APP_URL`).

Live Twilio verification used Black Hive's own real (Full, non-trial) Twilio account, connected through the actual running Settings → Integrations form — never seeded into `.env` or the database directly. One real send came back `undelivered` / error 30034, which is Twilio's A2P 10DLC carrier-registration requirement — an external, account-level compliance step, unrelated to any code in this repo.

---

## Part 2 — Full reminder cadence, estimate follow-up, editable templates, studio-local scheduling

Commit `e658e1f`. Depended on Part 1's send path (`sendClientSms`/new `sendStaffSms`) and Phase 7A's job scheduler.

### Studio-local scheduling
Replaced fixed-UTC-cron scheduling for this cadence with three separately-registered 15-minute-tick jobs — `clientAppointmentReminders`, `artistAppointmentReminders`, `estimateFollowUpReminder` — rather than one combined job, so the System panel shows the three friendly names the task asked for ("Appointment Reminders (Clients)", "Appointment Reminders (Artists)", "Estimate Follow-Up") each with its own Run Now and JobRun history, and one job's failure never taints another's status.

**Real scheduler bug found and fixed**: `startScheduler()` always computed a job's dedup slot as the start of the current UTC day, regardless of that job's own frequency — a 15-minute job would collide with its own first successful run's `JobRun` row and get silently skipped for the rest of the day. Fixed generically via a new `slotMinutes` field on `JobDefinition` (default 1440, so every Phase 7A daily job's behavior is byte-for-byte unchanged) and a `computeSlot(date, slotMinutes)` function.

**Timezone-window function** — `lib/reminderWindow.ts`, pure and dependency-free (no new timezone library; `Intl.DateTimeFormat`, matching the codebase's existing convention):
```ts
isWithinSendWindow(studioTimezone: string, targetTime: string, currentUtcInstant: Date, windowMinutes = 15): boolean
civilDateKey(date: Date, timeZone: string): string          // "YYYY-MM-DD" in that zone
daysBetweenCivilDates(fromKey: string, toKey: string): number
```
Verified via 23 unit-test assertions in a throwaway script (deleted after use, no permanent test framework introduced — this repo has none): America/New_York and America/Los_Angeles (DST) vs. Pacific/Honolulu (no DST), midnight edge cases, custom window sizes, and civil-date arithmetic. All 23 passed.

### The cadence itself
- **Client reminders** (1 week before / night before / morning of): each checked against its own configured send time in the studio's local timezone; dedup via `Appointment.reminderWeekSentAt`/`reminderNightBeforeSentAt`/`reminderMorningOfSentAt`; each links to the appointment's waiver, auto-created via a shared `ensureLiabilityWaiver()` (extracted from `POST /appointments/:id/waiver` so both the manual staff route and this job create/reuse the exact same record).
- **Artist digest** (7 AM day before, confirmed cadence): **one consolidated message per artist** listing all of tomorrow's appointments, not one text per appointment — verified live: an artist with two appointments on the same day received a single message with both listed. Dedup via a new `ArtistReminderLog` (unique on artist+date, since this is one-per-artist-per-day, not per-appointment). Artists with no phone are skipped gracefully.
- **Estimate follow-up** (24h after opened, no response): `Inquiry.estimateFollowUpSentAt` gates it; **verified resend resets it** — calling `POST /:id/send-estimate` again on an inquiry that already had a follow-up sent set `estimateFollowUpSentAt` back to `null`, live, confirmed via the route's own response.
- **Skips are counted, never errors**: not-connected / opted-out / no-phone / send-failed each have their own counter in `JobRun.details.perStudio[studioId]`; a `REMINDERS_NOT_SENT` system task (OWNER/FRONT_DESK only, via the existing task-registry pattern) surfaces whenever any of the three jobs' most recent run recorded a not-connected skip.

**Real waiver bug found and fixed this session**: `ensureLiabilityWaiver` extended a *newly created* waiver's expiry to cover `minValidUntil`, but an *already-existing* waiver (e.g. from an earlier day-of use, or simply already on file when a week-before reminder first needs one) was returned completely as-is — meaning an already-expired token could be linked from a brand-new reminder. Fixed: an existing waiver's `tokenExpiresAt` is now also extended (never shortened) when a later `minValidUntil` is passed. Verified directly: a pre-existing waiver with `tokenExpiresAt` in the past had its expiry correctly pushed out to cover a newly-scheduled appointment, same waiver `id`, same token, `created: false`.

### Live verification (real Twilio send, seeded/backdated data, PowerShell)
Using the studio's own real, already-`CONNECTED` Twilio account (no shortcuts — every send below went through the actual `sendClientSms`/`sendStaffSms` code path):
- 3 confirmed appointments repointed to a test client with a real receivable phone, dated exactly 7/1/0 days out (civil-date, studio-local) → all 3 client reminders fired as real Twilio sends, correct dedup field set on each, template placeholders rendered correctly, waiver auto-created/linked. Re-running the same job immediately after: **0 sent**, confirming no double-send.
- Artist digest: fired once for the artist's tomorrow appointment(s), `ArtistReminderLog` row created; re-run: **0 sent**.
- Opted-out client with an appointment in the window: skipped, counted (`skippedOptedOut`), no message created.
- No-phone client: skipped, counted (`skippedNoPhone`) — this path also fired naturally on real, pre-existing dev data (an actual inquiry mid-cadence with no client phone), not just constructed test data.
- SMS temporarily disconnected via the real `POST /integrations/SMS/disconnect` endpoint: all sends skipped and counted as `skippedNotConnected`; `REMINDERS_NOT_SENT` task appeared in `GET /tasks` immediately after. Reconnected via the real `POST /integrations/SMS/connect` endpoint (same real credentials) afterward.
- Estimate follow-up: fired once for a backdated (25h-old) opened estimate with a phone; re-run: **0 sent**; resending the estimate reset `estimateFollowUpSentAt` to `null` as designed.

All test client/appointment/inquiry rows created for this were deleted afterward; every appointment's original client/dates were restored; the artist's real phone number and the opted-out flag were reverted.

**A mistake made and corrected during cleanup**: my own cleanup script deleted two `LiabilityWaiver` rows that pre-existed my testing (not ones I'd created) — both unsigned/`PENDING`, never completed by a client. One was fully restored byte-for-byte from data already captured earlier in this same conversation (same `id`, token, timestamps, snapshot text). The second's original token had not been captured before deletion, so it was reconstructed with the same `id`/client/appointment/timestamps/snapshot content but a **freshly generated token** — if that original link had ever been sent to a client and not yet used, it no longer resolves (its audit trail showed only a `create` action, never a sign/verify, so this is very unlikely to have mattered in practice). Flagging this plainly rather than glossing over it.

### Editable templates UI (Settings → Reminder Templates & Send Times)
New card, same edit-icon-opens-modal convention as the Policies section, but a plain `<textarea>` instead of the WYSIWYG editor: 5 templates, each modal has clickable placeholder chips (insert at cursor) and a live counter (`"215/160 characters · 2 SMS segments"`, GSM-7 estimate). Send times (4 `HH:MM` fields) are their own inline-edit block (Business Hours' toggle-in-card convention), labeled with the studio's own timezone. Verified in-browser via Playwright: card renders, modal opens with the right placeholders per template, chip-click inserts correctly, counter updates live, and all three new jobs show their friendly names and real run history in the System panel.

**Exact default template text seeded** (also live-patched onto the existing dev studio, since seed's upsert never overwrites an already-existing studio):
```
clientWeekBefore: "Hi {{clientFirstName}}, this is a reminder that your appointment with {{artistName}} at {{studioName}} is coming up on {{appointmentDate}} at {{appointmentTime}}. Please complete your waiver here: {{waiverLink}}"
clientNightBefore: "Hi {{clientFirstName}}, see you tomorrow at {{appointmentTime}} for your appointment with {{artistName}} at {{studioName}}! Waiver: {{waiverLink}}"
clientMorningOf: "Hi {{clientFirstName}}, today's the day! Your appointment with {{artistName}} at {{studioName}} is at {{appointmentTime}}. Waiver: {{waiverLink}}"
artistDayBefore: "Hi {{artistName}}, here's your schedule for tomorrow at {{studioName}}:"
estimateFollowUp: "Hi {{clientFirstName}}, just following up on the estimate we sent for your tattoo -- you can view and respond here: {{estimateLink}}. Let us know if you have any questions! - {{studioName}}"
```
Default send times: `weekBeforeTime: "10:00"`, `nightBeforeTime: "18:00"`, `morningOfTime: "08:00"`, `artistDayBeforeTime: "07:00"` — all in the studio's own timezone.

---

## Final typecheck state
`cd apps/web && npm run build` — clean. `cd apps/api && npx tsc --noEmit` — clean. Confirmed clean before both commits.

## Commits
| Part | Hash | Message |
|---|---|---|
| 1 | `dd33f4c` | Integrations framework + live SMS |
| 2 | `e658e1f` | Full reminder cadence, estimate follow-up, editable templates, studio-local scheduling |

Both pushed to `origin/main`.

## Going live in production — read this before assuming a Railway config step is all that's needed
Two genuinely different things:
- **`API_PUBLIC_URL`** (and `INTEGRATION_ENCRYPTION_KEY`) are Railway environment variables — platform-level, set once, apply to every studio.
- **Connecting Black Hive's real Twilio account is not a Railway step at all.** It's an in-app action: an OWNER logging into the deployed app and filling out the real Settings → Integrations → SMS connect form with Black Hive's own Account SID/Auth Token/phone number, exactly the same self-serve flow verified live in Part 1. There is no environment variable for a studio's Twilio credentials, by design — don't look for one in Railway's config when setting this up for real.

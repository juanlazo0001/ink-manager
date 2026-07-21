# URGENT — SMS consent gating: BLOCKED, nothing to gate against yet

Single session, on `main`. Task was to verify SMS consent gating exists on every automated client-facing send path, and add it where missing. **Stopped at step 1 per the task's own instructions** — diagnosis found neither half of the prerequisite (schema field, intake checkbox) exists, so there is no consent signal to gate on. No code changes were made.

---

## 1. Diagnosis — consent tracking does NOT exist

**Schema (`apps/api/prisma/schema.prisma`, `Client` model):** only `smsOptedOutAt DateTime?` exists. There is no `smsConsentGivenAt`, `smsConsentSource`, or any other field recording that a client ever affirmatively agreed to receive texts.

**Public intake form (`apps/web/src/pages/IntakeForm.tsx:263-270`):** the phone field has *disclosure text* underneath it —

> "By providing your phone number, you consent to receive SMS messages about your inquiry and appointment. Message and data rates may apply. Reply STOP to opt out."

— but there is **no checkbox**. Nothing is unchecked-by-default, nothing is required to submit, nothing is stored per-submission. It's implied consent from providing a phone number, not opt-in consent.

**Conclusion: neither piece exists.** Per the task's instructions, this means the consent-checkbox/privacy-terms session referenced in the task (schema field + intake checkbox + `/privacy` and `/terms` pages) was never actually run. There is nothing in the data model to check a send against, so step 2 (audit + fix every automated send path) cannot be built on top of anything real — it would just be gating against a field that doesn't exist.

## 2. The actual exposure, stated plainly

**Every automated, non-human-initiated SMS send to a client in this app currently fires with zero consent check of any kind**, because the field to check doesn't exist. Confirmed by reading `apps/api/src/lib/clientSms.ts` — `sendClientSms()` is the single choke point all client-facing sends go through, and its only pre-send guards are:

```ts
if (client.smsOptedOutAt) return { sent: false, reason: "opted_out" };
if (!client.phone) return { sent: false, reason: "no_phone" };
```

No consent check exists to add a third condition to, because there's no field to check. Traced every caller of `sendClientSms()`:

| Path | File | Trigger | In scope for the gate |
|---|---|---|---|
| Client reminder cadence (week-before / night-before / morning-of) | `apps/api/src/lib/jobs/reminderTicker.ts` (`sendClientReminders`) | Fully automated background job, no human in the loop per-send | **Yes — automated** |
| Estimate 24-hour follow-up | `apps/api/src/lib/jobs/reminderTicker.ts` (`sendEstimateFollowUps`) | Fully automated background job, no human in the loop per-send | **Yes — automated** |
| Auto-send-on-generate-estimate | `apps/api/src/routes/inquiries.ts:649` (`POST /inquiries/:id/send-estimate`) | Staff clicks "send estimate" as a business action; the SMS itself fires automatically as a side effect with no separate "yes, text this" confirmation | **Yes — automated** |
| Composer send | `apps/api/src/routes/conversations.ts:593` | Staff explicitly composes and sends one specific message to one specific client, in the moment | No — human decision each time, per the task's own carve-out |
| Gift card "text receipt" button | `apps/api/src/routes/giftCards.ts:163` | Staff explicitly clicks "text this receipt" for one specific card, in the moment | No — same category as composer, explicit per-instance human action |

So, concretely: the 7B-2 reminder cadence (three client-facing reminder texts per appointment), the estimate follow-up job, and the estimate auto-send have all been sending to every client with a phone number and no opt-out — including clients who never gave any form of opt-in consent — since those features shipped. This is the most urgent open item in the project from a compliance standpoint (A2P 10DLC requires affirmative opt-in, not just "didn't opt out").

## 3. What needs to happen next

1. Run the consent-checkbox / privacy-terms session as originally scoped: `Client.smsConsentGivenAt` (+ source) on the schema, a required unchecked-by-default checkbox on the public intake form, `/privacy` and `/terms` pages.
2. Only after that field exists and is actually being populated by real submissions: re-run this gating task. At that point the fix is small and mechanical — add `if (!client.smsConsentGivenAt) return { sent: false, reason: "no_consent" }` to `sendClientSms()` in `apps/api/src/lib/clientSms.ts`, next to the existing `smsOptedOutAt`/`no_phone` checks, with a matching `skippedNoConsent` counter in `reminderTicker.ts`'s per-studio stats (same pattern as `skippedOptedOut`/`skippedNoPhone` already there). Composer and text-receipt sends stay untouched, as scoped.
3. Until step 1 lands, every automated send listed above should be treated as running without compliant consent gating.

## Commits / cleanup

No code changes made — diagnosis only, as instructed. No commits. No background shells were started this session.

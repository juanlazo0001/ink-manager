/**
 * Every value `Client.smsConsentSource` can hold, rendered for humans —
 * apps/web's `CONSENT_SOURCE_LABELS` verbatim
 * (`SmsConsentControls.tsx`).
 *
 * Covers the sources that predate the staff controls (public intake
 * form, inbound keyword, inbound text) as well as the ones those
 * controls add, so the line always says where consent actually came from
 * instead of showing a raw enum-ish string. A value not listed here
 * falls back to itself rather than to nothing, so a source added
 * server-side degrades to legible.
 */
export const CONSENT_SOURCE_LABELS: Record<string, string> = {
  intake_form: 'intake form',
  inbound_keyword: 'text keyword',
  inbound_sms: 'inbound text',
  consent_link: 'opt-in link',
  staff_verbal_in_person: 'verbal, in person',
  staff_verbal_phone: 'verbal, by phone',
  staff_written_form: 'signed form',
};

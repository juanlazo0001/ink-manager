// Platform-level SMS sending via Bird -- same shape as platformEmail.ts's
// sendPlatformEmail (raw fetch, one platform-wide Bird key, isConfigured()
// convention), but a DIFFERENT, more narrowly-scoped API key
// (BIRD_SMS_API_KEY, sms:WRITE only) rather than reusing BIRD_API_KEY --
// the two were provisioned separately on Bird's side on purpose, so a key
// rotation/revocation on one channel never touches the other.
//
// This is the platform sending on a STUDIO's behalf via the new BIRD_SMS
// IntegrationChannel (see schema.prisma's own comment on that enum value
// and routes/integrations.ts's BIRD_SMS branches) -- not yet the real
// client-conversation send path (composer/reminders/keyword handling),
// which stays on Twilio (lib/twilio.ts + lib/clientSms.ts) until a
// separate future session migrates it once this foundation is proven.
//
// Request shape: POST https://{region}.platform.bird.com/v1/sms/messages,
// Bearer auth, { to, from, text, category: "transactional" }. The task
// brief's originally "confirmed" shape omitted `from` -- real testing
// this session hit a genuine 422 SMSNoEligibleSender ("Supply a 'from' or
// configure a sender for this destination"), and the Bird TypeScript
// SDK's own SmsMessageSendRequest type docs confirm why: `from` is
// required on every free-text send, an E.164 number/alphanumeric ID/short
// code the workspace actually owns -- there's no account-level default a
// request can omit it and fall back to.
//
// BIRD_SMS_FROM is an env var, not a hardcoded constant like
// platformEmail.ts's PLATFORM_SENDER_ADDRESS -- deliberately, because
// (unlike a permanent email address) this session tried THREE candidate
// values against Bird's real API before finding none that worked: no
// `from` (422 SMSNoEligibleSender), the short code "30300" (422
// SMSSenderReserved -- "this sender identity is reserved"), and
// +15005550006 (back to SMSNoEligibleSender -- almost certainly a Twilio
// test/magic number, not anything this Bird workspace owns). This
// workspace has no valid, owned SMS sender configured yet as of this
// session -- a real external blocker on Bird's side (provision a number
// or approved sender in their dashboard), not a code defect. Making this
// an env var means the code is complete and correct regardless of when
// that gets resolved -- no redeploy needed once a real sender exists,
// just set the var. Region shares BIRD_REGION with platformEmail.ts (same
// Bird account/region, just a different key), not a separate env var.

export function isPlatformSmsConfigured(): boolean {
  return Boolean(process.env.BIRD_SMS_API_KEY && process.env.BIRD_SMS_FROM);
}

interface SendPlatformSmsParams {
  to: string; // E.164, e.g. "+19195551234"
  text: string;
}

export async function sendPlatformSms({ to, text }: SendPlatformSmsParams): Promise<void> {
  const apiKey = process.env.BIRD_SMS_API_KEY;
  const from = process.env.BIRD_SMS_FROM;

  if (!apiKey || !from) {
    throw new Error("Platform SMS is not configured (BIRD_SMS_API_KEY / BIRD_SMS_FROM)");
  }

  const region = process.env.BIRD_REGION || "us1";
  const response = await fetch(`https://${region}.platform.bird.com/v1/sms/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, from, text, category: "transactional" }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Bird SMS send failed (${response.status}): ${responseText}`);
  }
}

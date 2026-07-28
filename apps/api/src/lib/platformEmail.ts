// Platform-level email sending -- Ink Manager notifying someone directly
// (team invite, password reset, email-change confirmation), never a
// per-studio client-conversation message. Deliberately NOT built on the
// StudioIntegration chassis (Twilio/Gmail elsewhere in lib/) -- there is no
// per-studio credential here, no child-account provisioning, no inbound
// handling. One platform-wide Bird API key + one dedicated sending address,
// same isConfigured()-checked-before-use convention as isStripeConfigured/
// isGmailConfigured elsewhere in lib/.
//
// The separate, still-unbuilt per-studio Bird client-conversation channel
// (each studio connecting its own Bird child-account to send/receive
// client messages) is unrelated work -- do not extend this helper toward
// that; it stays a one-way platform notification sender.
//
// CONFIRMED WORKING (real send, HTTP 202, real message id) via Bird's
// actual current API: POST https://{region}.platform.bird.com/v1/email/messages,
// Bearer auth, `from` in the JSON body (not a mailbox/channel id in the
// URL). This came from Bird's own quickstart docs, not the workspace/
// channel-scoped messaging API or the /v1/email/mailboxes/:id/messages
// shape this file guessed at earlier in the same session -- both of those
// were real Bird API surfaces (recognized routes, structured errors) but
// the WRONG ones for this key/account; see REPORT.md's "Team account
// lifecycle" entry for the full dead-end matrix, kept for anyone hitting
// the same confusion later. Region is encoded in the key's own prefix
// (bk_us1_... -> us1.platform.bird.com; bk_eu1_... would be eu1) --
// BIRD_REGION exists as an explicit override rather than parsing the key
// string, so a key rotation to a different region only ever needs an env
// var change, not a code change.

const PLATFORM_SENDER_ADDRESS = "accounts@mail.inkmanager.app";

export function isPlatformEmailConfigured(): boolean {
  return Boolean(process.env.BIRD_API_KEY);
}

interface SendPlatformEmailParams {
  to: string;
  subject: string;
  // Plain-text fallback, sent alongside html in the same request --
  // confirmed both fields are accepted together in one real send during
  // this session (not an either/or).
  text: string;
  html: string;
}

export async function sendPlatformEmail({ to, subject, text, html }: SendPlatformEmailParams): Promise<void> {
  const apiKey = process.env.BIRD_API_KEY;

  if (!apiKey) {
    throw new Error("Platform email is not configured (BIRD_API_KEY)");
  }

  const region = process.env.BIRD_REGION || "us1";
  const response = await fetch(`https://${region}.platform.bird.com/v1/email/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: PLATFORM_SENDER_ADDRESS, to: [to], subject, text, html }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Bird send failed (${response.status}): ${responseText}`);
  }
}

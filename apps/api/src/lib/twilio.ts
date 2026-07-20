import Twilio from "twilio";

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export type TwilioValidationResult =
  | { valid: true }
  | { valid: false; error: string };

// Confirms the Account SID/Auth Token pair is real (Twilio rejects a bad
// pair immediately) AND that the given From number actually belongs to
// this account -- both checked before anything is persisted, so a typo'd
// credential never gets stored as CONNECTED.
export async function validateTwilioAccount(
  { accountSid, authToken }: TwilioCredentials,
  fromNumber: string,
): Promise<TwilioValidationResult> {
  const client = Twilio(accountSid, authToken);

  try {
    await client.api.v2010.accounts(accountSid).fetch();
  } catch (err) {
    return { valid: false, error: twilioErrorMessage(err, "Could not authenticate with Twilio") };
  }

  try {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: fromNumber, limit: 20 });
    if (numbers.length === 0) {
      return { valid: false, error: "That phone number was not found on this Twilio account" };
    }
  } catch (err) {
    return { valid: false, error: twilioErrorMessage(err, "Could not verify the phone number") };
  }

  return { valid: true };
}

export interface SendSmsResult {
  sid: string;
  status: string;
}

export async function sendSms(
  { accountSid, authToken }: TwilioCredentials,
  from: string,
  to: string,
  body: string,
  statusCallbackUrl?: string | null,
): Promise<SendSmsResult> {
  const client = Twilio(accountSid, authToken);

  const message = await client.messages.create({
    from,
    to,
    body,
    ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
  });

  return { sid: message.sid, status: message.status };
}

// Signature validation is what makes the multi-tenant webhook safe: the
// caller resolves WHICH studio a request claims to be for first (by the
// To number), THEN validates the signature against that specific studio's
// own auth token -- never the other way around, since without a resolved
// studio there's no token to validate against at all.
export function verifyTwilioSignature(
  authToken: string,
  signatureHeader: string | undefined,
  url: string,
  params: Record<string, unknown>,
): boolean {
  if (!signatureHeader) return false;
  return Twilio.validateRequest(authToken, signatureHeader, url, params as Record<string, string>);
}

function twilioErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}

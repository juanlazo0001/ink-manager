import Twilio from "twilio";

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

// On success this hands back the number in Twilio's OWN canonical E.164
// spelling rather than echoing whatever was typed into the form. That is
// load-bearing, not tidiness: routes/webhooks.ts resolves which studio an
// inbound text belongs to by exact-matching Twilio's `To` against the
// stored metadata.phoneNumber, and Twilio always sends E.164. A studio
// owner who typed "8508804483" or "(850) 880-4483" would connect fine,
// pass every validation here, send outbound fine -- and then silently lose
// every single inbound reply to a 403 "Unknown number", with nothing in
// the app to indicate why. Storing what Twilio calls the number closes
// that whole class of mismatch at the one point where we're already
// talking to Twilio and can just ask.
export type TwilioValidationResult =
  | { valid: true; phoneNumber: string }
  | { valid: false; error: string };

// The shape of StudioIntegration.metadata for the SMS channel. phoneNumber
// has always been here; messagingServiceSid is optional and additive, so
// every integration connected before A2P keeps working untouched (see
// resolveTwilioSender below for the precedence rule).
export interface SmsIntegrationMetadata {
  phoneNumber?: string;
  messagingServiceSid?: string;
}

// Which sender a send actually goes out on. Deliberately a discriminated
// union rather than "a number plus an optional SID": the two cases are not
// additive at the API layer -- passing `from` ALONGSIDE messagingServiceSid
// pins the send to that one number and bypasses the Sender Pool, which is
// most of the point of having a Messaging Service. Modeling it as a choice
// makes "omit from entirely" the only representable behavior for the
// service case, instead of a detail one call site can forget.
export type TwilioSender =
  | { kind: "messagingService"; messagingServiceSid: string }
  | { kind: "number"; from: string };

// SINGLE source of the precedence rule, shared by lib/clientSms.ts's real
// send path and routes/integrations.ts's test-message. Those two previously
// each read `metadata.phoneNumber` independently; with a second, preferred
// field in play that duplication is exactly how one path ends up routing
// through the campaign while the other quietly doesn't.
//
// A Messaging Service wins whenever one is configured, because that is what
// carries the approved A2P campaign, the Sender Pool, and Advanced Opt-Out.
// A bare number remains the fallback for any studio that has no service --
// unchanged behavior for them, not a regression.
export function resolveTwilioSender(metadata: SmsIntegrationMetadata | null | undefined): TwilioSender | null {
  const messagingServiceSid = metadata?.messagingServiceSid?.trim();
  if (messagingServiceSid) {
    return { kind: "messagingService", messagingServiceSid };
  }

  const from = metadata?.phoneNumber?.trim();
  if (from) {
    return { kind: "number", from };
  }

  return null;
}

// Does TWILIO already answer STOP/START/HELP for this integration, making
// an app-side auto-reply a duplicate?
//
// Yes, whenever the studio sends through a Messaging Service. Twilio
// intercepts the keyword families at the platform level there and sends
// its own response (customised under Messaging > Opt-Out Management when
// Advanced Opt-Out is on, default copy otherwise) -- so routes/webhooks.ts
// firing its own optInConfirmation/helpResponse on top lands the customer
// TWO texts for one keyword.
//
// This is not theoretical: it was observed live during the A2P
// verification. Texting START produced Twilio's confirmation plus
// "Black Hive Ink and Arts: You are now opted-in...", and HELP likewise.
// Duplicate keyword responses are exactly what a carrier audit looks for,
// and Twilio's copy is the copy the campaign was approved against -- so
// where the two collide, Twilio's wins and ours stands down.
//
// Deliberately keyed on the Messaging Service rather than applied
// unconditionally: a studio still on a bare From number has no observed
// duplication, and suppressing there could leave a keyword with NO reply
// at all. Narrow to the case actually seen to misbehave.
export function twilioOwnsKeywordReplies(metadata: SmsIntegrationMetadata | null | undefined): boolean {
  return Boolean(metadata?.messagingServiceSid?.trim());
}

// Confirms the Account SID/Auth Token pair is real (Twilio rejects a bad
// pair immediately) AND that the given From number actually belongs to
// this account -- both checked before anything is persisted, so a typo'd
// credential never gets stored as CONNECTED. When a Messaging Service SID
// is supplied it is validated too, on the same all-or-nothing terms.
export async function validateTwilioAccount(
  { accountSid, authToken }: TwilioCredentials,
  fromNumber: string,
  messagingServiceSid?: string | null,
): Promise<TwilioValidationResult> {
  const client = Twilio(accountSid, authToken);

  try {
    await client.api.v2010.accounts(accountSid).fetch();
  } catch (err) {
    return { valid: false, error: twilioErrorMessage(err, "Could not authenticate with Twilio") };
  }

  // Twilio's own spelling of the number wins over the caller's -- see
  // TwilioValidationResult's comment. Everything below this point, and the
  // value the caller persists, uses canonicalFrom rather than fromNumber.
  let canonicalFrom: string;
  try {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: fromNumber, limit: 20 });
    if (numbers.length === 0) {
      return { valid: false, error: "That phone number was not found on this Twilio account" };
    }

    // Twilio's phoneNumber filter matches loosely, so a partial entry can
    // come back with several numbers on a multi-number account. Taking
    // [0] there would canonicalize to a DIFFERENT number than the one the
    // studio meant and quietly bind the integration to it -- so an exact
    // match wins, a single fuzzy hit is accepted as unambiguous, and
    // genuine ambiguity is refused rather than guessed at.
    const exact = numbers.find((entry) => entry.phoneNumber === fromNumber);
    if (exact) {
      canonicalFrom = exact.phoneNumber;
    } else if (numbers.length === 1) {
      canonicalFrom = numbers[0].phoneNumber;
    } else {
      return {
        valid: false,
        error: `"${fromNumber}" matches ${numbers.length} numbers on this Twilio account -- enter it in full E.164 form, e.g. +18508804483`,
      };
    }
  } catch (err) {
    return { valid: false, error: twilioErrorMessage(err, "Could not verify the phone number") };
  }

  const trimmedServiceSid = messagingServiceSid?.trim();
  if (trimmedServiceSid) {
    if (!/^MG[0-9a-fA-F]{32}$/.test(trimmedServiceSid)) {
      return { valid: false, error: "A Messaging Service SID starts with \"MG\" followed by 32 hex characters" };
    }

    try {
      await client.messaging.v1.services(trimmedServiceSid).fetch();
    } catch (err) {
      return { valid: false, error: twilioErrorMessage(err, "That Messaging Service was not found on this Twilio account") };
    }

    // The From number must be IN the service's Sender Pool, and this is a
    // hard failure rather than a warning for a concrete reason: inbound
    // routing in routes/webhooks.ts resolves which studio a text belongs to
    // by exact-matching Twilio's `To` against this stored phoneNumber. If
    // the number isn't in the pool, outbound goes out on some OTHER sender,
    // the client's reply comes back addressed to that other number, and the
    // webhook 403s it as "Unknown number" -- the message is simply lost,
    // silently, with nothing in the app to show for it. Better to refuse
    // the config than to store a pairing that drops inbound replies.
    try {
      // Both sides of this comparison are now Twilio's own E.164 strings
      // (canonicalFrom came from incomingPhoneNumbers above), so an exact
      // match is correct here and can't fail on formatting alone.
      const pool = await client.messaging.v1.services(trimmedServiceSid).phoneNumbers.list({ limit: 100 });
      if (!pool.some((entry) => entry.phoneNumber === canonicalFrom)) {
        return {
          valid: false,
          error: `${canonicalFrom} is not in that Messaging Service's Sender Pool -- add it in the Twilio Console, then reconnect`,
        };
      }
    } catch (err) {
      return { valid: false, error: twilioErrorMessage(err, "Could not read that Messaging Service's Sender Pool") };
    }
  }

  return { valid: true, phoneNumber: canonicalFrom };
}

export interface SendSmsResult {
  sid: string;
  status: string;
}

export async function sendSms(
  { accountSid, authToken }: TwilioCredentials,
  sender: TwilioSender,
  to: string,
  body: string,
  statusCallbackUrl?: string | null,
): Promise<SendSmsResult> {
  const client = Twilio(accountSid, authToken);

  // See TwilioSender's own comment: for a Messaging Service `from` is
  // omitted outright so Twilio picks from the Sender Pool and the send is
  // attributed to the approved campaign.
  const senderParams =
    sender.kind === "messagingService"
      ? { messagingServiceSid: sender.messagingServiceSid }
      : { from: sender.from };

  const message = await client.messages.create({
    ...senderParams,
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

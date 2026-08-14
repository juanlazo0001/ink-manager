// Companion to scripts/simulate-twilio-inbound.ps1 -- see that file for the
// intent. This half exists in apps/api specifically so it can reuse the real
// prisma client and decryptSecret to look up the studio's own Twilio auth
// token, then compute a GENUINE X-Twilio-Signature over the request.
//
// Why a real signature rather than a test-only bypass: routes/webhooks.ts
// validates every inbound request against the studio's auth token and 403s
// otherwise. Adding an env-gated "skip signature check" would put a
// credential-check bypass into a production code path -- exactly the kind of
// thing that must never exist in an app handling other people's customers.
// Signing for real means the walkthrough exercises the untouched production
// handler, signature validation included, and NOTHING about the webhook's
// security posture changes to accommodate testing.
//
// The auth token is read, used to HMAC, and discarded in-process. It is never
// printed, logged, or passed through argv.
import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { decryptSecret } from "../lib/secrets";
import type { TwilioCredentials } from "../lib/twilio";

// Defense in depth: the .ps1 entry point performs this same check before it
// ever invokes this file, but this is the half that actually transmits, so it
// re-validates independently. Someone bypassing the wrapper still cannot aim
// this at a production host.
function assertNonProductionTarget(baseUrl: string): void {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    throw new Error(`Refusing to run: "${baseUrl}" is not a valid URL.`);
  }

  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost");
  const isStaging = host.includes("staging");

  if (!isLoopback && !isStaging) {
    throw new Error(
      `REFUSING TO RUN.\n` +
        `  Target host: ${host}\n` +
        `  This simulator may only target localhost or a host whose name contains "staging".\n` +
        `  It POSTs synthetic Twilio payloads that mutate real consent state -- pointing it at\n` +
        `  production would fabricate opt-in/opt-out events against real customer records.`,
    );
  }
}

// Twilio's documented algorithm: take the full URL that Twilio would have
// signed, append each POST param as key+value in lexicographic key order, then
// HMAC-SHA1 with the auth token and base64 the result.
function buildTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function main() {
  // The payload arrives as a FILE PATH, not inline JSON: quoting a JSON
  // string through PowerShell -> npx -> node on Windows mangles the inner
  // double quotes, which is a portability trap rather than a real design
  // constraint. A temp file sidesteps argv quoting entirely.
  const payloadPath = process.argv[2];
  if (!payloadPath) throw new Error("Expected a path to a JSON payload file.");
  // .replace(/^﻿/, ""): Windows PowerShell 5.1's `Set-Content -Encoding
  // utf8` always emits a BOM, which JSON.parse rejects outright.
  const raw = await import("node:fs").then((fs) => fs.readFileSync(payloadPath, "utf8").replace(/^﻿/, ""));
  const input = JSON.parse(raw) as {
    baseUrl: string;
    from: string;
    to: string;
    body: string;
    optOutType?: string;
  };

  assertNonProductionTarget(input.baseUrl);

  // The signature must be computed over the exact URL the SERVER will
  // reconstruct (TWILIO_SMS_WEBHOOK_URL, built from API_PUBLIC_URL), not the
  // URL we happen to POST to -- webhooks.ts validates against its own
  // constant precisely because a proxy can rewrite the request's own host.
  const { TWILIO_SMS_WEBHOOK_URL } = await import("../lib/publicUrl");
  const signedUrl = TWILIO_SMS_WEBHOOK_URL;
  const postUrl = `${input.baseUrl.replace(/\/+$/, "")}/webhooks/twilio/sms`;
  assertNonProductionTarget(signedUrl);

  const integration = await prisma.studioIntegration.findFirst({
    where: {
      channel: "SMS",
      status: "CONNECTED",
      metadata: { path: ["phoneNumber"], equals: input.to },
    },
  });
  if (!integration?.encryptedSecret) {
    throw new Error(`No CONNECTED SMS integration found for To=${input.to} in this database.`);
  }

  const credentials = JSON.parse(decryptSecret(integration.encryptedSecret)) as TwilioCredentials;

  const params: Record<string, string> = {
    AccountSid: credentials.accountSid,
    Body: input.body,
    From: input.from,
    // A real inbound SID is "SM" + 32 hex; keeping the shape identical means
    // the handler's own idempotency lookup behaves exactly as in production.
    MessageSid: `SM${crypto.randomBytes(16).toString("hex")}`,
    NumMedia: "0",
    To: input.to,
  };
  // Twilio only includes OptOutType on messages its Advanced Opt-Out layer
  // itself intercepted (STOP/START/HELP family). Omitted otherwise, so the
  // simulator omits it too rather than always sending an empty string.
  if (input.optOutType) params.OptOutType = input.optOutType;

  const signature = buildTwilioSignature(credentials.authToken, signedUrl, params);

  const res = await fetch(postUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body: new URLSearchParams(params).toString(),
  });

  const text = await res.text();
  console.log(
    JSON.stringify(
      {
        postedTo: postUrl,
        signedUrl,
        status: res.status,
        ok: res.ok,
        sentParams: { ...params, AccountSid: `${credentials.accountSid.slice(0, 4)}...` },
        response: text.slice(0, 300),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  if (!res.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

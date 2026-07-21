import crypto from "node:crypto";
import { prisma } from "./prisma";
import { PUBLIC_APP_URL } from "./publicUrl";

// Base62 (no punctuation, no ambiguous-looking pairs to worry about since
// it's never hand-typed) -- 8 characters is ~47.6 bits of entropy, well
// past what an opportunistic guess/enumeration attempt could brute force,
// without the 64-hex-char length these links exist specifically to avoid.
const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LENGTH = 8;

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

// Idempotent by targetUrl -- shortening the exact same long URL twice
// (e.g. the same waiver link reused across the week-before/night-before/
// morning-of client reminders, or an estimate link reused between the
// initial send and the 24-hour follow-up) returns the SAME short link
// rather than minting a new one each time.
export async function shortenUrl(targetUrl: string): Promise<string> {
  const existing = await prisma.shortLink.findFirst({ where: { targetUrl } });
  if (existing) {
    // PUBLIC_APP_URL, not API_PUBLIC_URL: apps/api and apps/web are
    // separate Railway services with separate public domains, and this
    // link is meant to be tapped by a client -- same domain every other
    // public link this server builds (estimate/deposit/waiver/gift-card/
    // intake/prefill) already uses. The /s/:code path itself is served by
    // the WEB app (see pages/ShortLinkRedirect.tsx), which resolves it
    // via the API and does the actual browser redirect from there -- this
    // function never talks to the API's own domain at all.
    return `${PUBLIC_APP_URL}/s/${existing.code}`;
  }

  // Collisions are astronomically unlikely at this alphabet/length, but a
  // fresh code is generated per attempt rather than looping on the same
  // one, and this gives up after a handful of tries rather than looping
  // forever if something is genuinely wrong.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      await prisma.shortLink.create({ data: { code, targetUrl } });
      return `${PUBLIC_APP_URL}/s/${code}`;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }

  throw new Error("Failed to generate a unique short link code");
}

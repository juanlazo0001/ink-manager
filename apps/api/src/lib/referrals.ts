import crypto from "node:crypto";
import { prisma } from "./prisma";

// Uppercase only, and excludes visually-ambiguous characters (0/O, 1/I/L)
// -- unlike GiftCard's code or a short-link's code (neither is ever read
// aloud), this one is specifically meant to be spoken over the counter or
// texted character-by-character, so ambiguity here is a real usability bug,
// not just a cosmetic one.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 7;

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

// Every Client-creation path (clients.ts, inquiries.ts, webhooks.ts,
// seed.ts) calls this exactly once, at creation -- a code is never
// regenerated or rotated afterward. Collisions are vanishingly unlikely at
// this length/alphabet, but retried against the real unique constraint
// rather than assumed, same pattern as generateUniqueGiftCardCode/shortLinks.
export async function generateUniqueReferralCode(): Promise<string> {
  let code = generateCode();

  while (await prisma.client.findUnique({ where: { referralCode: code } })) {
    code = generateCode();
  }

  return code;
}

import Stripe from "stripe";

// Platform-level Stripe client -- ONE secret key for the whole app
// (STRIPE_SECRET_KEY), never a per-studio credential. Every connected-
// account-scoped call passes { stripeAccount: acct_... } as this SDK's own
// request-options argument (the Stripe-Account header) rather than using a
// different client per studio -- there is no per-studio secret to hold in
// the first place, unlike Twilio/Gmail on this same StudioIntegration
// chassis. Same isConfigured()-checked-before-use convention as
// isGmailConfigured/isEncryptionConfigured elsewhere in lib/.
let cachedClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (cachedClient) return cachedClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  cachedClient = new Stripe(key);
  return cachedClient;
}

// One platform-wide fee rate applied to every direct charge (deposits,
// checkout amount-due) via application_fee_amount -- NOT per-studio yet.
// A reasonable future extension (configurable per studio in
// StudioSettings) is left for later; this env var is the single value for
// every studio today.
export function computeApplicationFeeCents(amountCents: number): number {
  const percent = Number(process.env.PLATFORM_FEE_PERCENT ?? "0");
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round(amountCents * (percent / 100));
}

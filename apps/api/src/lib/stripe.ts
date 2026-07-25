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

// Shared by both real-payment flows this phase adds (the deposit form and
// checkout's own "amount due") -- a single direct charge on the studio's
// connected account (the { stripeAccount: ... } request option, i.e. the
// Stripe-Account header), with the platform's application_fee_amount cut
// baked in. Line item amounts are always whole cents, same convention as
// every other money field in this codebase.
export async function createDirectChargeCheckoutSession(params: {
  connectedAccountId: string;
  amountCents: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: params.productName },
            unit_amount: params.amountCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: computeApplicationFeeCents(params.amountCents),
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    },
    { stripeAccount: params.connectedAccountId },
  );

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout Session URL");
  }

  return { id: session.id, url: session.url };
}

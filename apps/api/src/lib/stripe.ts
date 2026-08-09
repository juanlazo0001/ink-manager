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

// Embedded-payments migration sibling to createDirectChargeCheckoutSession
// above -- same direct-charge shape (stripeAccount request option,
// application_fee_amount), but returns a PaymentIntent client secret for
// the frontend to mount a Payment Element against instead of a hosted
// Checkout URL to redirect to. automatic_payment_methods is left
// unspecified deliberately: Stripe enables it by default in the current
// API version, so which payment methods actually show up in the Element
// stays entirely Dashboard-managed (Settings > Payment methods per
// connected account), matching how Checkout already resolved this.
export async function createDirectChargePaymentIntent(params: {
  connectedAccountId: string;
  amountCents: number;
  // Caller-supplied rather than derived from amountCents here -- session
  // checkout's tip endpoint charges amountDueCents + tipCents but the
  // platform's cut is computed on amountDueCents alone (the platform takes
  // no cut of tips), so the fee basis can no longer be assumed to equal
  // the charge amount. Deposit/flash callers just pass
  // computeApplicationFeeCents(amountCents) themselves -- unchanged
  // behavior, just made explicit at the call site instead of implicit here.
  applicationFeeCents: number;
  metadata: Record<string, string>;
}): Promise<{ id: string; clientSecret: string }> {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create(
    {
      amount: params.amountCents,
      currency: "usd",
      application_fee_amount: params.applicationFeeCents,
      metadata: params.metadata,
    },
    { stripeAccount: params.connectedAccountId },
  );

  if (!intent.client_secret) {
    throw new Error("Stripe did not return a PaymentIntent client secret");
  }

  return { id: intent.id, clientSecret: intent.client_secret };
}

// Fetch-or-create: reuses a still-open PaymentIntent across page
// reloads/resends (a client re-visiting their own deposit link, or staff
// resending it) rather than always minting a fresh one the way
// createDirectChargeCheckoutSession's callers do for Checkout Sessions --
// Checkout Sessions expire on Stripe's own schedule, so abandoning one is
// harmless; a PaymentIntent has no such auto-expiry, so always-create would
// silently accumulate abandoned intents forever. Only PaymentIntents in an
// unconfirmed, still-payable state are reused; anything terminal
// (succeeded/canceled) or otherwise unconfirmable falls through to a fresh
// create. Amount is re-applied on every call (never trusted as
// unchanged) since the underlying row's own amount is the single source of
// truth, not whatever the existing PaymentIntent happened to be created
// with.
const REUSABLE_PAYMENT_INTENT_STATUSES = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

export async function createOrRetrieveDirectChargePaymentIntent(params: {
  connectedAccountId: string;
  existingPaymentIntentId: string | null;
  amountCents: number;
  // Same caller-supplied fee basis as createDirectChargePaymentIntent above
  // -- applied on both the reused-and-updated path and the create-fallback
  // path below, so a tip added after the PaymentIntent already exists (see
  // the appointments /tip endpoint) updates the charge amount without
  // moving the fee basis.
  applicationFeeCents: number;
  metadata: Record<string, string>;
}): Promise<{ id: string; clientSecret: string }> {
  const stripe = getStripe();

  if (params.existingPaymentIntentId) {
    let existing;
    try {
      existing = await stripe.paymentIntents.retrieve(params.existingPaymentIntentId, undefined, { stripeAccount: params.connectedAccountId });
    } catch {
      // Deleted/inaccessible on Stripe's side -- fall through to create.
      existing = null;
    }

    if (existing && REUSABLE_PAYMENT_INTENT_STATUSES.has(existing.status)) {
      if (!existing.client_secret) {
        throw new Error("Stripe did not return a PaymentIntent client secret");
      }
      if (existing.amount !== params.amountCents) {
        const updated = await stripe.paymentIntents.update(
          existing.id,
          { amount: params.amountCents, application_fee_amount: params.applicationFeeCents },
          { stripeAccount: params.connectedAccountId },
        );
        return { id: updated.id, clientSecret: updated.client_secret ?? existing.client_secret };
      }
      return { id: existing.id, clientSecret: existing.client_secret };
    }
  }

  return createDirectChargePaymentIntent({
    connectedAccountId: params.connectedAccountId,
    amountCents: params.amountCents,
    applicationFeeCents: params.applicationFeeCents,
    metadata: params.metadata,
  });
}

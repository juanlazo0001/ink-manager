import { getStripe } from "./stripe";

// Everything specific to ONBOARDING a studio's Stripe account lives here,
// deliberately isolated from the payment/webhook logic in routes/deposits.ts,
// routes/appointments.ts, and routes/webhooks.ts. If this studio ever
// migrates from a Standard connected account to Express (a different
// onboarding UX, still the same direct-charge + Stripe-Account-header
// payment model), only this file should need to change.
//
// Per Stripe's own current guidance (verified against docs.stripe.com
// directly, not assumed from training data), OAuth is no longer the
// recommended way to onboard a Standard account -- the current path is
// Connect Onboarding via Account Links: create an empty connected account
// via the API, generate a single-use Account Link via the API, and redirect
// the studio's browser there. Stripe hosts the entire onboarding UI
// (business details, bank account, identity verification); this app builds
// none of it.

export interface ConnectedAccountStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  businessName: string | null;
}

// Creates a brand-new, empty Standard connected account. Called once per
// studio -- if a StudioIntegration row already has a stripeAccountId in its
// metadata, callers should reuse it (via a fresh Account Link, see
// createOnboardingLink below) rather than calling this again.
export async function createStandardConnectedAccount(): Promise<string> {
  const stripe = getStripe();
  const account = await stripe.accounts.create({ type: "standard" });
  return account.id;
}

// A single-use Stripe-hosted onboarding URL. Also the correct call to make
// when a studio returns with onboarding still incomplete (Stripe allows
// resuming) -- there's no separate "resume" API, just a fresh Account Link
// for the same existing account id, per Stripe's own account-onboarding
// documentation.
export async function createOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getStripe();
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return accountLink.url;
}

// Called after the studio returns from Stripe's hosted onboarding (and by
// the account.updated webhook, to keep local status fresh without relying
// solely on the return redirect actually happening).
export async function getConnectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(accountId);
  return {
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    businessName: account.business_profile?.name ?? account.company?.name ?? null,
  };
}

import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { GoldGradientButton } from '@/components/GoldGradientButton';
import { Sheet } from '@/components/Sheet';
import { RadioField, TextField } from '@/components/form/Fields';
import { QuietButton } from '@/components/ui';
import { formatMoney } from '@/lib/giftCards';
import { colors, space, type } from '@/theme';

/**
 * Issue a gift card — the whole flow, with the one outbound step gated.
 *
 * ─── WHAT IS REAL AND WHAT IS NOT ───────────────────────────────────
 *
 * Everything here is real: the method chooser, the fields, the
 * validation, the cents conversion, the OWNER-only expiry, the derived
 * request body. The single gated step is the SUBMIT — it raises the
 * standing toast instead of calling the API, so the payments session
 * flips ONE function rather than building a screen.
 *
 * `buildRequest()` below returns the exact endpoint and body that step
 * will send. It is exported and unit-shaped deliberately: when the gate
 * lifts, the change is `apiFetch(req.path, {method:'POST', body:
 * JSON.stringify(req.body)})` and nothing else moves.
 *
 * ─── WEB'S FLOW, READ OFF THE SOURCE ────────────────────────────────
 *
 * `apps/web/src/pages/ClientDetail.tsx`'s issue modal, and the three
 * routes in `apps/api/src/routes/giftCards.ts`:
 *
 *   CASH     POST /gift-cards
 *            { clientId, amountCents, paymentMethod: 'CASH', expiresAt? }
 *            -> 201 GiftCard. The API REJECTS any paymentMethod but
 *               'CASH' on this route, by name.
 *
 *   STRIPE   POST /gift-cards/checkout-session
 *            { clientId, amountCents, expiresAt? }
 *            -> { checkoutUrl }. THIS is where Stripe enters, and it is
 *               a separate endpoint, not a flag on the cash one. The
 *               card is created PENDING immediately so the webhook has
 *               a row to find by stripeCheckoutSessionId; it is not
 *               spendable until payment confirms. Web deliberately does
 *               NOT close its modal here — staff still has to copy the
 *               link.
 *
 *   EXEMPT   POST /gift-cards/exempt          (OWNER only, server-side)
 *            { clientId, exemptionReason|null, expiresAt? }
 *            -> a no-payment override, not a purchase.
 *
 * `expiresAt` is OWNER-only on ALL THREE — the API returns 403 to anyone
 * else who sends it at all, so a non-owner must omit the key, not send
 * null. The field is hidden for them here for that reason.
 *
 * NOT OFFERED, deliberately: `appointmentId`. The API accepts it on the
 * cash and checkout routes, but web's client-page form does not expose
 * it and this mirrors web rather than inventing a control.
 */

export type IssueMethod = 'CASH' | 'STRIPE' | 'EXEMPT';

export interface IssueRequest {
  path: string;
  body: Record<string, unknown>;
}

/**
 * The exact request the gated submit will send. Pure, so the payments
 * session can trust it without re-deriving anything from web.
 *
 * `expiresAt` follows CLAUDE.md's UTC-midnight convention because that
 * is what web writes here — `new Date(form.expiresAt).toISOString()` on
 * a bare `YYYY-MM-DD`, single-arg, which is UTC midnight wherever it
 * runs. CLAUDE.md names gift card `expiresAt` as one of the three fields
 * on that convention, so this must NOT go through `parseDateString`
 * (local midnight) — mixing the two is the bug that rule exists for.
 */
export function buildRequest(params: {
  clientId: string;
  method: IssueMethod;
  amountDollars: string;
  expiresAt: string;
  exemptionReason: string;
  isOwner: boolean;
}): IssueRequest {
  const { clientId, method, amountDollars, expiresAt, exemptionReason, isOwner } = params;

  // Web: `Math.round(Number(amountDollars) * 100)`.
  const amountCents = Math.round(Number(amountDollars) * 100);

  // Omitted entirely rather than sent as null — a non-owner who sends
  // the key at all gets a 403 from the route.
  const expiresAtBody = isOwner && expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {};

  if (method === 'EXEMPT') {
    return {
      path: '/gift-cards/exempt',
      body: { clientId, exemptionReason: exemptionReason.trim() || null, ...expiresAtBody },
    };
  }
  if (method === 'STRIPE') {
    return { path: '/gift-cards/checkout-session', body: { clientId, amountCents, ...expiresAtBody } };
  }
  return { path: '/gift-cards', body: { clientId, amountCents, paymentMethod: 'CASH', ...expiresAtBody } };
}

/**
 * Validation mirroring what the API actually enforces, rather than a
 * looser client-side guess — the route's own words are "clientId and a
 * positive amountCents are required".
 *
 * Split per field so each message renders under the input it belongs to.
 */
export function validateAmount(method: IssueMethod, amountDollars: string): string | null {
  // An exemption is a no-payment override; it carries no amount at all.
  if (method === 'EXEMPT') return null;

  const trimmed = amountDollars.trim();
  if (!trimmed) return 'Enter an amount.';

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "That isn't a number.";
  if (value <= 0) return 'The amount must be more than $0.';

  /* It is sent as `Math.round(value * 100)`, so a third decimal would be
     silently rounded away from a number someone typed on purpose. Say so
     instead. The epsilon is there because 19.99 * 100 is 1998.9999... in
     binary floating point, and a bare !== would reject valid cents. */
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
    return 'Amounts go to the cent — two decimal places.';
  }
  return null;
}

export function validateExpiry(expiresAt: string): string | null {
  const trimmed = expiresAt.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'Expiry must be YYYY-MM-DD.';
  if (Number.isNaN(new Date(trimmed).getTime())) return "That date doesn't exist.";
  return null;
}

const METHOD_OPTIONS = [
  { value: 'CASH' as const, label: 'Cash' },
  { value: 'STRIPE' as const, label: 'Payment link' },
  { value: 'EXEMPT' as const, label: 'Exemption' },
];

/** Web's own explanatory line per method, kept close to its wording. */
const METHOD_BLURB: Record<IssueMethod, string> = {
  CASH: 'For cash collected in person only. Enter the exact amount collected — a gift card for that amount is issued to the client once confirmed.',
  STRIPE:
    'Enter the amount to charge — a real Stripe payment link is generated for you to share with the client. The gift card issues automatically once they pay.',
  EXEMPT: 'A no-payment override. The card is issued without money changing hands, and the reason is recorded on it.',
};

export function IssueGiftCardSheet({
  visible,
  onClose,
  clientId,
  isOwner,
}: {
  visible: boolean;
  onClose: () => void;
  clientId: string;
  /** Drives the expiry field AND the Exemption option — both are
      OWNER-only server-side, so showing them to anyone else offers a
      guaranteed 403. */
  isOwner: boolean;
}) {
  const [method, setMethod] = useState<IssueMethod>('CASH');
  const [amountDollars, setAmountDollars] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [exemptionReason, setExemptionReason] = useState('');
  const [touched, setTouched] = useState(false);

  const amountError = useMemo(() => validateAmount(method, amountDollars), [method, amountDollars]);
  const expiryError = useMemo(() => validateExpiry(expiresAt), [expiresAt]);
  const error = amountError ?? expiryError;

  const options = isOwner ? METHOD_OPTIONS : METHOD_OPTIONS.filter((o) => o.value !== 'EXEMPT');

  const preview =
    /* Keyed on the AMOUNT's validity, not the form's — this line
       describes the amount, and an unrelated bad expiry blanking it
       reads as though the amount were the problem. */
    method !== 'EXEMPT' && !amountError && amountDollars.trim()
      ? formatMoney(Math.round(Number(amountDollars) * 100))
      : null;

  function reset() {
    setMethod('CASH');
    setAmountDollars('');
    setExpiresAt('');
    setExemptionReason('');
    setTouched(false);
  }

  function submit() {
    setTouched(true);
    if (error) return;

    /*
     * ─── THE GATE ───────────────────────────────────────────────────
     *
     * The one step that is not real. Everything above has already run:
     * the request below is fully formed and correct.
     *
     * Issuing a gift card takes money from a client, and the standing
     * rule for this app is that money writes do not ship unattended off
     * a mobile session. Replacing these four lines with the `apiFetch`
     * this request describes is the whole of the remaining work.
     */
    const request = buildRequest({ clientId, method, amountDollars, expiresAt, exemptionReason, isOwner });
    if (__DEV__) console.log('[issue-gift-card] would POST', request.path, request.body);

    Alert.alert('Not yet', 'Gift card issuance goes live with the payments update.', [
      { text: 'OK', onPress: () => { reset(); onClose(); } },
    ]);
  }

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Issue a gift card">
      <View style={styles.body}>
        <Text style={styles.heading}>Issue a gift card</Text>

        <RadioField label="How is it paid?" value={method} options={options} onChange={setMethod} />

        <Text style={styles.blurb}>{METHOD_BLURB[method]}</Text>

        {method === 'EXEMPT' ? (
          <TextField
            label="Reason (optional)"
            value={exemptionReason}
            onChange={setExemptionReason}
            placeholder="Why this card is being issued without payment"
            multiline
          />
        ) : (
          <TextField
            label={method === 'CASH' ? 'Amount collected ($)' : 'Amount ($)'}
            value={amountDollars}
            onChange={setAmountDollars}
            placeholder="0.00"
            keyboardType="decimal-pad"
            prefix="$"
            /* The field owns its own error rendering, so the message
               lands under the input it belongs to rather than at the
               foot of the sheet. */
            error={touched && amountError ? amountError : undefined}
          />
        )}

        {preview ? <Text style={styles.preview}>Issues a {preview} card.</Text> : null}

        {/* OWNER only: the API 403s anyone else who sends the key. */}
        {isOwner ? (
          <TextField
            label="Custom expiration (optional)"
            value={expiresAt}
            onChange={setExpiresAt}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            hint="Overrides the studio default. Owners only."
            error={touched && expiryError ? expiryError : undefined}
          />
        ) : null}

        <View style={styles.actions}>
          <QuietButton label="Cancel" onPress={() => { reset(); onClose(); }} style={styles.action} />
          <GoldGradientButton
            label={method === 'STRIPE' ? 'Generate payment link' : 'Issue'}
            onPress={submit}
            style={styles.action}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.md },
  heading: { ...type.sectionHeader, color: colors.fg },
  blurb: { ...type.small, color: colors.fgSecondary },
  preview: { ...type.small, color: colors.accent },
  error: { ...type.small, color: colors.danger },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  action: { flex: 1 },
});

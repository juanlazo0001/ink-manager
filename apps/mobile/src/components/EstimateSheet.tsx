import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GoldGradientButton } from '@/components/GoldGradientButton';
import { Sheet } from '@/components/Sheet';
import { RadioField, SwitchField, TextField } from '@/components/form/Fields';
import { QuietButton } from '@/components/ui';
import {
  buildSendBody,
  derivedTotal,
  emptySessionRow,
  validateDraft,
  type EstimateChannel,
  type EstimateDraft,
  type SessionRow,
} from '@/lib/estimate';
import { formatMoney } from '@/lib/giftCards';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Compose and SEND an estimate.
 *
 * ─── THE SEND IS AN OUTBOUND MESSAGE TO A PERSON ────────────────────
 *
 * `POST /inquiries/:id/send-estimate` does not stage anything. It mints
 * a token, moves the inquiry to AWAITING_CLIENT_RESPONSE, and calls
 * `sendClientSms` or `sendClientEmail` — a real text or email, to the
 * client's real number or address, with no dry-run path anywhere in the
 * route.
 *
 * SO THERE IS A CONFIRMATION STEP, and it is a deliberate addition
 * rather than a copy of web. Web sends on submit; this asks first,
 * naming the client and the channel. That is not a change to what gets
 * sent or when — the request, its body and its semantics are web's
 * exactly — it is a guard against a mis-tap on a device held in one
 * hand, for an action that cannot be recalled once it reaches somebody's
 * phone. Flagged in the session report as the one place mobile shows a
 * screen web does not.
 *
 * ─── WHAT THE FORM CAN AND CANNOT DECIDE ────────────────────────────
 *
 * With more than one session the route DERIVES the headline price by
 * summing the rows and ignores whatever top-level price it was sent, so
 * the total shown here is presented as derived — it is the number that
 * will be stored, not a number being proposed. See `lib/estimate.ts`.
 */
export function EstimateSheet({
  visible,
  onClose,
  clientName,
  draft,
  onDraftChange,
  sending,
  error,
  onSend,
}: {
  visible: boolean;
  onClose: () => void;
  /** Named in the confirmation, so it is never abstract who is about to be messaged. */
  clientName: string;
  draft: EstimateDraft;
  onDraftChange: (next: EstimateDraft) => void;
  sending: boolean;
  /** The route's own message on failure, surfaced verbatim. */
  error: string | null;
  onSend: (channel: EstimateChannel) => void;
}) {
  const [channel, setChannel] = useState<EstimateChannel>('SMS');
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const total = useMemo(() => derivedTotal(draft), [draft]);
  const planned = draft.sessions.length > 1;

  const errorFor = (row: number, field: 'hours' | 'price') =>
    touched ? errors.find((e) => e.row === row && e.field === field)?.message : undefined;

  const set = (patch: Partial<EstimateDraft>) => onDraftChange({ ...draft, ...patch });
  const setRow = (i: number, patch: Partial<SessionRow>) =>
    set({ sessions: draft.sessions.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  /* The body is computed here purely so the confirmation can be honest
     about what it is about to do. It is the same function the send uses. */
  const preview = errors.length === 0 ? buildSendBody(draft, channel) : null;

  if (confirming && preview) {
    return (
      <Sheet visible={visible} onClose={() => setConfirming(false)} accessibilityLabel="Confirm sending the estimate">
        <View style={styles.body}>
          <Text style={styles.heading}>Send this estimate?</Text>
          <Text style={styles.confirmLead}>
            This sends {clientName} {channel === 'SMS' ? 'a text message' : 'an email'} with a link to
            their estimate, and moves the project to awaiting their response.
          </Text>
          <Text style={styles.confirmWarn}>It cannot be unsent.</Text>

          <View style={styles.summary}>
            <SummaryRow label="To" value={clientName} />
            <SummaryRow label="Channel" value={channel === 'SMS' ? 'Text message' : 'Email'} />
            <SummaryRow
              label="Sessions"
              value={planned ? `${draft.sessions.length} sittings` : 'One sitting'}
            />
            {total ? (
              <SummaryRow label="Total" value={`${formatMoney(total.low * 100)} – ${formatMoney(total.high * 100)}`} />
            ) : (
              <SummaryRow
                label="Price"
                value={
                  draft.isFlat
                    ? formatMoney(Number(draft.priceLow) * 100)
                    : `${formatMoney(Number(draft.priceLow) * 100)} – ${formatMoney(Number(draft.priceHigh) * 100)}`
                }
              />
            )}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <QuietButton label="Back" onPress={() => setConfirming(false)} style={styles.action} />
            <GoldGradientButton
              label={sending ? 'Sending…' : 'Send it'}
              onPress={() => !sending && onSend(channel)}
              style={[styles.action, sending && styles.disabled]}
            />
          </View>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Compose an estimate">
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>Estimate</Text>

        <SwitchField
          label="Flat price"
          value={draft.isFlat}
          onChange={(v) => set({ isFlat: v, sessions: draft.sessions.map((r) => ({ ...r, isFlat: v })) })}
          description="One price instead of a range. Hours are still recorded — the calendar needs them either way."
        />

        <SwitchField
          label="Show the duration to the client"
          value={draft.showDurationToClient}
          onChange={(v) =>
            set({ showDurationToClient: v, sessions: draft.sessions.map((r) => ({ ...r, showDurationToClient: v })) })
          }
        />

        {!planned ? (
          <>
            <View style={styles.pair}>
              <View style={styles.half}>
                <TextField
                  label="Hours (min)"
                  value={draft.hoursMin}
                  onChange={(v) => set({ hoursMin: v })}
                  keyboardType="decimal-pad"
                  placeholder="2"
                />
              </View>
              <View style={styles.half}>
                <TextField
                  label="Hours (max)"
                  value={draft.hoursMax}
                  onChange={(v) => set({ hoursMax: v })}
                  keyboardType="decimal-pad"
                  placeholder="4"
                />
              </View>
            </View>
            {errorFor(-1, 'hours') ? <Text style={styles.error}>{errorFor(-1, 'hours')}</Text> : null}

            <View style={styles.pair}>
              <View style={styles.half}>
                <TextField
                  label={draft.isFlat ? 'Price ($)' : 'Price low ($)'}
                  value={draft.priceLow}
                  onChange={(v) => set({ priceLow: v })}
                  keyboardType="decimal-pad"
                  prefix="$"
                />
              </View>
              {!draft.isFlat ? (
                <View style={styles.half}>
                  <TextField
                    label="Price high ($)"
                    value={draft.priceHigh}
                    onChange={(v) => set({ priceHigh: v })}
                    keyboardType="decimal-pad"
                    prefix="$"
                  />
                </View>
              ) : null}
            </View>
            {errorFor(-1, 'price') ? <Text style={styles.error}>{errorFor(-1, 'price')}</Text> : null}
          </>
        ) : (
          draft.sessions.map((row, i) => (
            <View key={i} style={styles.session}>
              <View style={styles.sessionHead}>
                <Text style={styles.sessionTitle}>Session {i + 1}</Text>
                <Pressable
                  onPress={() => set({ sessions: draft.sessions.filter((_, j) => j !== i) })}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove session ${i + 1}`}
                  style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                >
                  <Feather name="x" size={13} color={colors.fgMuted} />
                </Pressable>
              </View>
              <View style={styles.pair}>
                <View style={styles.half}>
                  <TextField label="Hours (min)" value={row.hoursMin} onChange={(v) => setRow(i, { hoursMin: v })} keyboardType="decimal-pad" />
                </View>
                <View style={styles.half}>
                  <TextField label="Hours (max)" value={row.hoursMax} onChange={(v) => setRow(i, { hoursMax: v })} keyboardType="decimal-pad" />
                </View>
              </View>
              {errorFor(i, 'hours') ? <Text style={styles.error}>{errorFor(i, 'hours')}</Text> : null}
              <View style={styles.pair}>
                <View style={styles.half}>
                  <TextField label={row.isFlat ? 'Price ($)' : 'Price low ($)'} value={row.priceLow} onChange={(v) => setRow(i, { priceLow: v })} keyboardType="decimal-pad" prefix="$" />
                </View>
                {!row.isFlat ? (
                  <View style={styles.half}>
                    <TextField label="Price high ($)" value={row.priceHigh} onChange={(v) => setRow(i, { priceHigh: v })} keyboardType="decimal-pad" prefix="$" />
                  </View>
                ) : null}
              </View>
              {errorFor(i, 'price') ? <Text style={styles.error}>{errorFor(i, 'price')}</Text> : null}
            </View>
          ))
        )}

        <Pressable
          onPress={() => set({ sessions: [...draft.sessions, emptySessionRow(draft.isFlat)] })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        >
          <Feather name="plus" size={14} color={colors.accent} />
          <Text style={styles.addLabel}>
            {planned ? 'Add another session' : 'Break this into sessions'}
          </Text>
        </Pressable>

        {/* Derived, not proposed — see the header note. */}
        {total ? (
          <Text style={styles.total}>
            Total across {draft.sessions.length} sessions:{' '}
            {formatMoney(total.low * 100)} – {formatMoney(total.high * 100)}
          </Text>
        ) : null}

        <RadioField
          label="Send by"
          value={channel}
          options={[
            { value: 'SMS' as const, label: 'Text message' },
            { value: 'EMAIL' as const, label: 'Email' },
          ]}
          onChange={setChannel}
        />

        {touched && errors.length > 0 ? (
          <Text style={styles.error}>{errors[0].message}</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <QuietButton label="Cancel" onPress={onClose} style={styles.action} />
          <GoldGradientButton
            label="Review and send"
            onPress={() => {
              setTouched(true);
              if (errors.length === 0) setConfirming(true);
            }}
            style={[styles.action, errors.length > 0 && touched && styles.disabled]}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.md },
  heading: { ...type.sectionHeader, color: colors.fg },

  confirmLead: { ...type.small, color: colors.fgSecondary },
  confirmWarn: { ...type.small, color: colors.accent },
  summary: {
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  summaryLabel: { ...type.meta, color: colors.fgMuted },
  summaryValue: { ...type.body, color: colors.fg, flexShrink: 1, textAlign: 'right' },

  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },

  session: {
    gap: space.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: space.md,
  },
  sessionHead: { flexDirection: 'row', alignItems: 'center' },
  sessionTitle: { ...type.label, color: colors.fgMuted, flex: 1 },
  remove: { padding: space.xs },

  add: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  addLabel: { ...type.small, color: colors.accent },

  total: { ...type.small, color: colors.accent },
  error: { ...type.small, color: colors.danger },

  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xs },
  action: { flex: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
});

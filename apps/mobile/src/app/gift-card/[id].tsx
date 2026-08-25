import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { ActivityHistory } from '@/components/ActivityHistory';
import { AttachSessionSheet } from '@/components/AttachSessionSheet';
import { CardActionRow, CardIconButton } from '@/components/CardIconButton';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { QrCode } from '@/components/QrCode';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StatusChip } from '@/components/StatusChip';
import { BanIcon, CalendarIcon, CopyIcon, TransferIcon } from '@/components/icons';
import { Card } from '@/components/editorial';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { calendarDate, stamp } from '@/lib/format';
import { giftCardTone } from '@/lib/giftCardDisplay';
import { fetchGiftCard, formatMoney, type GiftCard } from '@/lib/giftCards';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, space, type } from '@/theme';

/**
 * A gift card, as apps/web's `GiftCardDetail` shows one.
 *
 * WEB'S ANATOMY, section by section: a header card carrying the amount as
 * its title, the holder, the code, then a two-column fact grid (status,
 * expires, attached, issued by, payment method, and origin when the card
 * came from redeeming another) with the QR beside it; an action row under
 * a divider; then the activity history.
 *
 * WHAT THIS REPLACED: a flat fact list under an explainer paragraph that
 * apologised for the screen being read-only. The disabled actions carry
 * that message now, one line each, at the moment someone reaches for
 * them — which is the pattern every other card on this app uses.
 *
 * WRITES ARE STILL NOT BUILT. Every action here moves money or changes
 * what a client is owed, and the standing contract keeps those out of
 * unattended hands. They render, they say why, they do nothing.
 */
export default function GiftCardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [card, setCard] = useState<GiftCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ activity: true });
  const [attaching, setAttaching] = useState(false);

  /**
   * The one live action here, and the reasons it can be refused are the
   * server's own, said in its words rather than a generic "not allowed":
   *
   *   - `giftCards.issue` gates the route (evaluated at the CARD's
   *     studio, not the caller's home studio);
   *   - only an ACTIVE or EXEMPT card can be moved;
   *   - a card with no holder has no appointments to choose from.
   */
  const canIssue = session?.profile.permissions.includes('giftCards.issue') ?? false;
  const attachBlockedReason = !canIssue
    ? "You don't have permission to move gift cards."
    : card && card.status !== 'ACTIVE' && card.status !== 'EXEMPT'
      ? `Only an active card can be attached to a session — this one is ${card.status.toLowerCase()}.`
      : card && !(card.client?.id ?? card.clientId)
        ? 'This card has no holder yet, so there are no sessions to attach it to.'
        : null;
  const canAttach = attachBlockedReason === null;

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      setCard(await fetchGiftCard(token, id));
    } catch (err) {
      setError(screenErrorMessage(err, "That gift card couldn't be loaded."));
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const holder = card?.client ? `${card.client.firstName} ${card.client.lastName}` : null;
  // Web's own condition: an exemption is not a spendable card, so it gets
  // neither a public link nor a QR.
  const isExempt = card?.status === 'EXEMPT';

  /**
   * ITEM 4 — the code itself is copyable.
   *
   * It is the one thing on this screen someone reads down a phone line or
   * pastes into a checkout, and copying it touches no record at all. The
   * haptic is the point: a tap whose entire result lives in an invisible
   * clipboard needs to be felt, not inferred from a label that changes
   * for two seconds.
   */
  async function copyCode(code: string) {
    await Clipboard.setStringAsync(code);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  async function copyLink(url: string) {
    await Clipboard.setStringAsync(url);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader onBack={() => router.back()} />

      {error ? (
        <StateMessage
          eyebrow="Not loaded"
          title="That gift card couldn't be loaded"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      ) : !card ? (
        <ScreenLoading />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <View style={styles.headTop}>
              <View style={styles.headText}>
                <Text style={styles.title}>
                  {isExempt ? 'Deposit Exemption' : `${formatMoney(card.amountCents)} Gift Card`}
                </Text>
                {card.exemptionReason ? (
                  <Text style={styles.subtitle}>{card.exemptionReason}</Text>
                ) : null}
                {holder ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {holder}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void copyCode(card.code)}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy gift card code ${card.code}`}
                  accessibilityHint="Copies the code to the clipboard"
                  hitSlop={6}
                  style={({ pressed }) => [styles.codeRow, pressed && styles.codePressed]}
                >
                  <Text style={styles.code} selectable>
                    {card.code}
                  </Text>
                  <CopyIcon size={13} color={codeCopied ? colors.accent : colors.fgMuted} />
                </Pressable>
              </View>

              {/* Web renders the QR from the card's `publicUrl`, and hides
                  it entirely on an exemption. */}
              {!isExempt && card.publicUrl ? <QrCode value={card.publicUrl} size={110} /> : null}
            </View>

            {/* Web's `grid grid-cols-2 gap-4` of labelled facts. */}
            <View style={styles.grid}>
              <Fact label="Status">
                <StatusChip label={card.status} tone={giftCardTone(card.status)} />
              </Fact>
              <Fact label="Expires">
                <Text style={styles.factValue}>
                  {card.expiresAt ? calendarDate(card.expiresAt) : 'Never'}
                </Text>
              </Fact>
              <Fact label="Attached">
                <Text style={styles.factValue}>
                  {card.appointment ? stamp(card.appointment.startAt) : 'Unattached'}
                </Text>
              </Fact>
              <Fact label="Issued by">
                <Text style={styles.factValue} numberOfLines={1}>
                  {card.issuedBy ? (card.issuedBy.name ?? card.issuedBy.email) : 'Deleted user'}
                </Text>
              </Fact>
              <Fact label="Payment method">
                <Text style={styles.factValue}>{paymentMethodLabel(card.paymentMethod)}</Text>
              </Fact>
              {card.derivedFromGiftCard ? (
                <Fact label="Origin">
                  <Text style={styles.factValue} numberOfLines={1}>
                    From redeeming {card.derivedFromGiftCard.code.slice(0, 8)}…
                  </Text>
                </Fact>
              ) : null}
            </View>

            {/* Web: `mt-5 border-t border-border pt-4` above its actions,
                and the row wraps rather than overflowing. */}
            <View style={styles.actionsDivider} />
            <CardActionRow wrap>
              {!isExempt ? (
                <CardIconButton
                  Icon={CopyIcon}
                  label={copied ? 'Copied' : 'Copy link'}
                  onPress={card.publicUrl ? () => void copyLink(card.publicUrl!) : undefined}
                  unavailableNote="This card has no public link."
                />
              ) : null}
              {card.status !== 'VOID' ? (
                <CardIconButton
                  Icon={CalendarIcon}
                  label={card.appointmentId ? 'Move to another session' : 'Attach to a session'}
                  onPress={canAttach ? () => setAttaching(true) : undefined}
                  unavailableNote={attachBlockedReason ?? undefined}
                />
              ) : null}
              {card.status !== 'VOID' ? (
                <CardIconButton
                  Icon={TransferIcon}
                  label="Transfer to client"
                  unavailableNote="Coming soon. Moving a card between clients lives in the portal for now."
                />
              ) : null}
              {card.status !== 'VOID' ? (
                <CardIconButton
                  Icon={BanIcon}
                  tone="danger"
                  label="Void card"
                  unavailableNote="Coming soon. Voiding destroys the card's value, so it stays in the portal for now."
                />
              ) : null}
            </CardActionRow>
          </Card>

          <AttachSessionSheet
            visible={attaching}
            card={card}
            token={token}
            onClose={() => setAttaching(false)}
            onAttached={(updated) => {
              setAttaching(false);
              // The server decides the resulting shape; take what it
              // returned rather than patching the local copy, then re-read
              // so the activity history picks up the new `rollover` row.
              setCard(updated);
              void load();
            }}
          />

          <CollapsibleSection
            title="Activity history"
            open={!!open.activity}
            onToggle={() => setOpen((o) => ({ ...o, activity: !o.activity }))}
          >
            {token ? (
              <ActivityHistory token={token} entityType="GiftCard" entityId={card.id} />
            ) : null}
          </CollapsibleSection>
        </ScrollView>
      )}
    </ScreenShell>
  );
}

/** One cell of web's fact grid: an uppercase label over its value. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}


/** Web's own wording for each `paymentMethod` value. */
function paymentMethodLabel(method: string | null): string {
  if (method === 'STRIPE') return 'Stripe';
  if (method === 'CASH') return 'Cash';
  if (method === 'EXEMPT') return 'Exempt (no payment)';
  return 'Unknown';
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  headTop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  headText: { flex: 1, gap: 2 },
  title: { ...type.heading, color: colors.fg },
  subtitle: { ...type.small, color: colors.fgSecondary },
  // Web: `mt-3 font-mono text-xs text-fg-muted`.
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  code: { ...type.meta, color: colors.fgMuted, letterSpacing: 1 },
  codePressed: { opacity: 0.6 },

  // Web: `grid grid-cols-2 gap-4`.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.lg,
    rowGap: space.lg,
    columnGap: space.lg,
  },
  fact: { width: '45%', gap: space.xs },
  factLabel: { ...type.meta, color: colors.fgMuted, letterSpacing: 1 },
  factValue: { ...type.small, color: colors.fg },

  actionsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: space.lg,
    marginBottom: space.md,
  },
});

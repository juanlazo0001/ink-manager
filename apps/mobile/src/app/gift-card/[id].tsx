import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { EditorialCard } from '@/components/editorial';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { fetchGiftCard, formatMoney, type GiftCard } from '@/lib/giftCards';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * A gift card, as the scanner opens it.
 *
 * **READ-ONLY, deliberately.** `GET /gift-cards/:id` is the only call
 * here. The API also offers redeem, void, exempt, re-issue and holder
 * edits — every one of them moves money or changes what a client is owed,
 * and this run's contract is explicit that money gets no unattended
 * creativity. Mirroring web's redemption flow needs its own investigation
 * of web's confirm steps and partial-redemption semantics; until that
 * happens, showing the card truthfully and doing nothing to it is the
 * honest half.
 *
 * Logged as a deliberate gap in the session report, not an oversight.
 *
 * A single record of unknown height, so it gets a spinner rather than a
 * skeleton — see LOADING_POLICY in theme/motion.
 */
export default function GiftCardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [card, setCard] = useState<GiftCard | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Gift card" onBack={() => router.back()} />

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
          <EditorialCard title={formatMoney(card.amountCents)} caption={card.status.toUpperCase()}>
            <View style={styles.codeRow}>
              <Feather name="tag" size={13} color={colors.fgMuted} />
              <Text style={styles.code} selectable>
                {card.code}
              </Text>
            </View>
          </EditorialCard>

          <View style={styles.facts}>
            <Fact label="Status" value={card.status} />
            {holder ? <Fact label="Holder" value={holder} /> : null}
            <Fact label="Issued" value={dateOnly(card.createdAt)} />
            {card.paidAt ? <Fact label="Paid" value={dateOnly(card.paidAt)} /> : null}
            {card.paymentMethod ? <Fact label="Paid via" value={card.paymentMethod} /> : null}
            {card.expiresAt ? <Fact label="Expires" value={dateOnly(card.expiresAt)} /> : null}
            {card.redeemedAt ? <Fact label="Redeemed" value={dateOnly(card.redeemedAt)} /> : null}
            {card.exemptionReason ? <Fact label="Exempt" value={card.exemptionReason} /> : null}
            {card.issuedBy ? (
              <Fact label="Issued by" value={card.issuedBy.name ?? card.issuedBy.email} />
            ) : null}
            {card.derivedFromGiftCard ? (
              <Fact label="Replaces" value={card.derivedFromGiftCard.code} />
            ) : null}
          </View>

          <View style={styles.note}>
            <Feather name="info" size={13} color={colors.fgMuted} />
            <Text style={styles.noteText}>
              Redeeming and voiding are done in the portal. This screen shows the card; it
              doesn&apos;t change it.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

/**
 * A gift card's `expiresAt` is a pure calendar date stored at UTC
 * midnight, so it is read back with UTC forced — a bare
 * `toLocaleDateString()` re-interprets that midnight in the viewer's zone
 * and can show the previous day. The repo has hit this exact bug before;
 * see CLAUDE.md's timezone rule.
 */
function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg },

  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  code: { ...type.meta, color: colors.fgSecondary, letterSpacing: 1 },

  facts: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
  },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  factLabel: { ...type.meta, color: colors.fgMuted },
  factValue: { ...type.body, color: colors.fg, flexShrink: 1, textAlign: 'right' },

  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noteText: { ...type.small, color: colors.fgMuted, flex: 1 },
});

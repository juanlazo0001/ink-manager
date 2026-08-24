import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Eyebrow, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import {
  clientName,
  fetchClient,
  type ClientDetail,
  type ClientInquiry,
} from '@/lib/clients';
import { formatMoney } from '@/lib/giftCards';
import { tabForStatus } from '@/lib/inquiryTabs';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * A client, as apps/web's client detail shows one.
 *
 * This screen is the point of the whole Clients build: gift cards,
 * deposit forms and waivers have NO standalone page anywhere in the
 * product — web reaches them only from here, from appointment detail, and
 * from /scan. Adding "gift cards to mobile" is really adding this.
 *
 * Section order follows web's: contact, then the client's work
 * (inquiries, projects), then the money and paperwork attached to them.
 *
 * READ-ONLY this pass. Web also offers Issue Gift Card, Send Deposit
 * Form, Send Waiver, Merge / Merge-into / Not-a-duplicate, Edit and
 * Archive from here. Every one is either money or destructive, each needs
 * its own mirror of web's confirm flow, and this run's contract is
 * explicit that those get no unattended creativity. Logged as deferred,
 * not forgotten.
 */
export default function ClientScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      setClient(await fetchClient(token, id));
    } catch (err) {
      setError(screenErrorMessage(err, "That client couldn't be loaded."));
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Web splits the same list into "inquiries" and "projects"; mobile
  // already has that split as one canonical table (session G), so it is
  // reused rather than re-decided here.
  const { inquiries, projects } = useMemo(() => {
    const all = client?.inquiries ?? [];
    return {
      inquiries: all.filter((i) => tabForStatus(i.status) === 'inquiries'),
      projects: all.filter((i) => tabForStatus(i.status) === 'projects'),
    };
  }, [client]);

  const name = client ? clientName(client) : 'Client';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title={name} onBack={() => router.back()} />

      {error ? (
        <StateMessage
          eyebrow="Not loaded"
          title="That client couldn't be loaded"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      ) : !client ? (
        <ScreenLoading />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {client.archivedAt ? <Banner icon="archive" text="This client is archived." /> : null}
          {client.mergedInto ? (
            <Banner
              icon="git-merge"
              text={`Merged into ${clientName(client.mergedInto)}. This record is kept for history.`}
            />
          ) : null}
          {client.transferredToStudio ? (
            <Banner icon="log-out" text={`Transferred to ${client.transferredToStudio.name}.`} />
          ) : null}

          <Section title="Contact">
            {client.phones.length > 0 ? (
              client.phones.map((p) => (
                <Fact
                  key={p.id}
                  label={p.label ?? (p.isPrimary ? 'Primary phone' : 'Phone')}
                  value={p.phone}
                />
              ))
            ) : client.phone ? (
              <Fact label="Phone" value={client.phone} />
            ) : null}

            {client.emails.length > 0 ? (
              client.emails.map((e) => (
                <Fact
                  key={e.id}
                  label={e.label ?? (e.isPrimary ? 'Primary email' : 'Email')}
                  value={e.email}
                />
              ))
            ) : client.email ? (
              <Fact label="Email" value={client.email} />
            ) : null}

            {client.instagramHandle ? <Fact label="Instagram" value={client.instagramHandle} /> : null}
            {client.address ? <Fact label="Address" value={client.address} /> : null}
            {client.referredBy ? (
              <Fact label="Referred by" value={clientName(client.referredBy)} />
            ) : null}
            {/* SMS consent is a compliance fact, not a preference — A2P
                rules turn on it, so it is stated plainly rather than
                implied by the presence of a phone number. */}
            <Fact
              label="SMS consent"
              value={
                client.smsOptedOutAt
                  ? 'Opted out'
                  : client.smsConsentGivenAt
                    ? 'Given'
                    : 'Not given'
              }
            />
          </Section>

          <Section title={`Inquiries (${inquiries.length})`}>
            {inquiries.length === 0 ? (
              <Empty text="No open inquiries." />
            ) : (
              inquiries.map((i) => <InquiryLine key={i.id} inquiry={i} />)
            )}
          </Section>

          <Section title={`Projects (${projects.length})`}>
            {projects.length === 0 ? (
              <Empty text="No projects." />
            ) : (
              projects.map((i) => <InquiryLine key={i.id} inquiry={i} />)
            )}
          </Section>

          <Section title={`Gift cards (${client.giftCards.length})`}>
            {client.giftCards.length === 0 ? (
              <Empty text="No gift cards." />
            ) : (
              client.giftCards.map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => router.push({ pathname: '/gift-card/[id]', params: { id: g.id } })}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.line, pressed && styles.pressed]}
                >
                  <View style={styles.lineText}>
                    <Text style={styles.lineTitle}>{formatMoney(g.amountCents)}</Text>
                    <Text style={styles.lineMeta}>
                      {g.status} · {g.code}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.fgMuted} />
                </Pressable>
              ))
            )}
          </Section>

          <Section title={`Deposit forms (${depositForms(client).length})`}>
            {depositForms(client).length === 0 ? (
              <Empty text="No deposit forms." />
            ) : (
              depositForms(client).map((d) => (
                <View key={d.id} style={styles.line}>
                  <View style={styles.lineText}>
                    <Text style={styles.lineTitle}>{formatMoney(Math.round(d.totalCharged * 100))}</Text>
                    <Text style={styles.lineMeta}>{d.paidAt ? 'Paid' : 'Awaiting payment'}</Text>
                  </View>
                </View>
              ))
            )}
          </Section>

          <Section title={`Waivers (${client.liabilityWaivers.length})`}>
            {client.liabilityWaivers.length === 0 ? (
              <Empty text="No waivers." />
            ) : (
              client.liabilityWaivers.map((w) => (
                <View key={w.id} style={styles.line}>
                  <View style={styles.lineText}>
                    <Text style={styles.lineTitle}>{w.signedAt ? 'Signed' : 'Not signed'}</Text>
                    <Text style={styles.lineMeta}>{dateOnly(w.signedAt ?? w.createdAt)}</Text>
                  </View>
                </View>
              ))
            )}
          </Section>

          <View style={styles.note}>
            <Feather name="info" size={13} color={colors.fgMuted} />
            <Text style={styles.noteText}>
              Issuing gift cards, sending deposit forms and waivers, editing and merging are done in
              the portal. This screen shows the client; it doesn&apos;t change them.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** Deposit forms hang off inquiries, not off the client — flattened here. */
function depositForms(client: ClientDetail) {
  return client.inquiries.flatMap((i) => i.depositForms ?? []);
}

function InquiryLine({ inquiry }: { inquiry: ClientInquiry }) {
  const price =
    inquiry.priceEstimateLow != null && inquiry.priceEstimateHigh != null
      ? `$${inquiry.priceEstimateLow} – $${inquiry.priceEstimateHigh}`
      : null;
  return (
    <View style={styles.line}>
      <View style={styles.lineText}>
        <Text style={styles.lineTitle} numberOfLines={2}>
          {inquiry.description?.trim() || inquiry.service || 'Untitled inquiry'}
        </Text>
        <Text style={styles.lineMeta}>
          {inquiry.status.replace(/_/g, ' ').toLowerCase()}
          {price ? ` · ${price}` : ''}
        </Text>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Eyebrow tone="accent">{title}</Eyebrow>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.factValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function Banner({ icon, text }: { icon: 'archive' | 'git-merge' | 'log-out'; text: string }) {
  return (
    <View style={styles.banner}>
      <Feather name={icon} size={13} color={colors.fgMuted} />
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

/**
 * Waiver dates are calendar dates at UTC midnight — read back with UTC
 * forced, per CLAUDE.md's timezone rule, so the viewer's own zone cannot
 * shift them a day.
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
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },

  banner: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space.md,
  },
  bannerText: { ...type.small, color: colors.fgMuted, flex: 1 },

  section: { gap: space.sm },
  sectionBody: {
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

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  lineText: { flex: 1 },
  lineTitle: { ...type.body, color: colors.fg },
  lineMeta: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

  empty: { ...type.small, color: colors.fgMuted, paddingVertical: space.md },

  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noteText: { ...type.small, color: colors.fgMuted, flex: 1 },
  pressed: { opacity: 0.6 },
});

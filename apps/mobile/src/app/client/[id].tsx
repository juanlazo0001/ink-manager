import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollapsibleSection, type SectionAction } from '@/components/CollapsibleSection';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { buildCustomerDetailsText, clientName, fetchClient, type ClientDetail, type ClientInquiry } from '@/lib/clients';
import { fetchConversations } from '@/lib/conversations';
import { formatMoney } from '@/lib/giftCards';
import { tabForStatus } from '@/lib/inquiryTabs';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * A client, as apps/web's client detail shows one.
 *
 * SECTION SET, ORDER AND ACTIONS ARE WEB'S, read off the live page rather
 * than remembered: contact info (with phones and emails inside) ·
 * inquiries · projects · gift cards · deposit forms · appointments ·
 * waivers · notes · activity history. Header row: Message · Copy · Edit.
 * Per-section actions: Send Inquiry and New Inquiry on inquiries, Issue
 * Gift Card on gift cards, Send Deposit Form on deposit forms, Send
 * Waiver on waivers. Nothing else carries one.
 *
 * Sections collapse, which web's do not need to — a phone cannot show
 * nine cards at once, and a collapsed card still states its count so
 * nothing is hidden, only folded.
 *
 * ACTIONS THAT NEED WRITES THIS APP HAS NOT BUILT RENDER DISABLED, not
 * hidden, each with its own one-line reason. That is the owner's call:
 * parity of shape now, function following. Every one of them either
 * sends something to a client or moves money, which this run's contract
 * keeps out of unattended hands.
 */
export default function ClientScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  /** The client's existing thread, if they have one. Null until looked up. */
  const [threadId, setThreadId] = useState<string | null>(null);

  // Which sections start open. Contact and the client's work are what a
  // person came for; the paperwork below folds until asked for.
  const [open, setOpen] = useState<Record<string, boolean>>({
    contact: true,
    inquiries: true,
    projects: true,
  });
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

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

  /*
   * Message opens the client's EXISTING thread. Web's button resolves or
   * creates one; creating a conversation is a write, so this only ever
   * opens what is already there and says so plainly when there is
   * nothing — rather than quietly making a thread nobody asked for.
   */
  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    fetchConversations(token)
      .then((rows) => {
        if (cancelled) return;
        setThreadId(rows.find((c) => c.clientId === id)?.id ?? null);
      })
      .catch(() => {
        /* A missing thread lookup must not break the screen. */
      });
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  const { inquiries, projects } = useMemo(() => {
    const all = client?.inquiries ?? [];
    return {
      inquiries: all.filter((i) => tabForStatus(i.status) === 'inquiries'),
      projects: all.filter((i) => tabForStatus(i.status) === 'projects'),
    };
  }, [client]);

  const deposits = useMemo(
    () => (client?.inquiries ?? []).flatMap((i) => i.depositForms ?? []),
    [client],
  );

  async function copyDetails() {
    if (!client) return;
    setCopyOpen(false);
    await Clipboard.setStringAsync(buildCustomerDetailsText(client));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
          {/* Web's header row: Message · Copy · Edit. */}
          <View style={styles.quickRow}>
            <QuickAction
              icon="message-circle"
              label="Message"
              onPress={
                threadId
                  ? () => router.push({ pathname: '/conversation/[id]', params: { id: threadId } })
                  : undefined
              }
              note={threadId ? undefined : 'No thread with this client yet.'}
            />
            <QuickAction
              icon={copied ? 'check' : 'copy'}
              label={copied ? 'Copied' : 'Copy'}
              onPress={() => setCopyOpen((v) => !v)}
            />
            <QuickAction
              icon="edit-2"
              label="Edit"
              note="Editing a client is done in the portal."
            />
          </View>

          {copyOpen ? (
            <View style={styles.copyMenu}>
              <Pressable onPress={copyDetails} style={({ pressed }) => [styles.copyItem, pressed && styles.pressed]}>
                <Text style={styles.copyItemLabel}>Copy customer details</Text>
              </Pressable>
              {/* Web's second item generates a prefill token AND texts it
                  to the client. That is an outbound send, so it is shown
                  and disabled rather than quietly omitted. */}
              <View style={[styles.copyItem, styles.copyItemDisabled]}>
                <Text style={styles.copyItemLabelDisabled}>Copy prefilled link</Text>
                <Text style={styles.copyItemNote}>Sends the client a text — portal only.</Text>
              </View>
            </View>
          ) : null}

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

          <CollapsibleSection title="Contact info" open={!!open.contact} onToggle={() => toggle('contact')}>
            <SubHead>Phones</SubHead>
            {client.phones.length > 0 ? (
              client.phones.map((p) => (
                <Fact key={p.id} label={p.label ?? (p.isPrimary ? 'Primary' : 'Phone')} value={p.phone} />
              ))
            ) : client.phone ? (
              <Fact label="Phone" value={client.phone} />
            ) : (
              <Empty text="No phone on file." />
            )}

            <SubHead>Emails</SubHead>
            {client.emails.length > 0 ? (
              client.emails.map((e) => (
                <Fact key={e.id} label={e.label ?? (e.isPrimary ? 'Primary' : 'Email')} value={e.email} />
              ))
            ) : client.email ? (
              <Fact label="Email" value={client.email} />
            ) : (
              <Empty text="No email on file." />
            )}

            {client.instagramHandle ? <Fact label="Instagram" value={client.instagramHandle} /> : null}
            {client.address ? <Fact label="Address" value={client.address} /> : null}
            {client.referredBy ? <Fact label="Referred by" value={clientName(client.referredBy)} /> : null}
            <Fact
              label="SMS consent"
              value={client.smsOptedOutAt ? 'Opted out' : client.smsConsentGivenAt ? 'Given' : 'Not given'}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Inquiries"
            count={inquiries.length}
            open={!!open.inquiries}
            onToggle={() => toggle('inquiries')}
            // Web carries BOTH here: Send Inquiry (texts the client an
            // intake link) and New Inquiry (logs one on their behalf).
            actions={[
              PORTAL_ACTION('Send Inquiry', 'Sends the client an intake link — portal only.'),
              PORTAL_ACTION('New Inquiry', 'Logging an inquiry is done in the portal.'),
            ]}
          >
            {inquiries.length === 0 ? (
              <Empty text="No open inquiries." />
            ) : (
              inquiries.map((i) => <InquiryLine key={i.id} inquiry={i} />)
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Projects"
            count={projects.length}
            open={!!open.projects}
            onToggle={() => toggle('projects')}
          >
            {projects.length === 0 ? (
              <Empty text="No projects." />
            ) : (
              projects.map((i) => <InquiryLine key={i.id} inquiry={i} />)
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Gift cards"
            count={client.giftCards.length}
            open={!!open.gift}
            onToggle={() => toggle('gift')}
            actions={[PORTAL_ACTION('Issue Gift Card', 'Issuing a gift card moves money — portal only.')]}
          >
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
          </CollapsibleSection>

          <CollapsibleSection
            title="Deposit forms"
            count={deposits.length}
            open={!!open.deposits}
            onToggle={() => toggle('deposits')}
            actions={[PORTAL_ACTION('Send Deposit Form', 'Sending a deposit form charges a client — portal only.')]}
          >
            {deposits.length === 0 ? (
              <Empty text="No deposit forms." />
            ) : (
              deposits.map((d) => (
                <View key={d.id} style={styles.line}>
                  <View style={styles.lineText}>
                    <Text style={styles.lineTitle}>{formatMoney(Math.round(d.totalCharged * 100))}</Text>
                    <Text style={styles.lineMeta}>{d.paidAt ? 'Paid' : 'Awaiting payment'}</Text>
                  </View>
                </View>
              ))
            )}
          </CollapsibleSection>

          {/* Web has this section; the client endpoint does not return
              appointments, and this run does not invent API surface. The
              card keeps web's shape and says why it is empty rather than
              pretending the client has none. */}
          <CollapsibleSection title="Appointments" open={!!open.appointments} onToggle={() => toggle('appointments')}>
            <Empty text="Appointments aren't part of this client's payload yet — see them on the schedule." />
          </CollapsibleSection>

          <CollapsibleSection
            title="Waivers"
            count={client.liabilityWaivers.length}
            open={!!open.waivers}
            onToggle={() => toggle('waivers')}
            actions={[PORTAL_ACTION('Send Waiver', 'Sending a waiver messages the client — portal only.')]}
          >
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
          </CollapsibleSection>

          <CollapsibleSection title="Notes" open={!!open.notes} onToggle={() => toggle('notes')}>
            <Empty text="Client notes are written in the portal." />
          </CollapsibleSection>

          <CollapsibleSection title="Activity history" open={!!open.activity} onToggle={() => toggle('activity')}>
            <Empty text="The audit trail isn't part of this client's payload yet." />
          </CollapsibleSection>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** An action web offers here whose write this app has not built. */
function PORTAL_ACTION(label: string, note: string): SectionAction {
  return { label, unavailableNote: note };
}

function QuickAction({
  icon,
  label,
  onPress,
  note,
}: {
  icon: 'message-circle' | 'copy' | 'check' | 'edit-2';
  label: string;
  onPress?: () => void;
  note?: string;
}) {
  const enabled = !!onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityHint={note}
      style={({ pressed }) => [styles.quick, !enabled && styles.quickDisabled, pressed && enabled && styles.pressed]}
    >
      <Feather name={icon} size={15} color={enabled ? colors.fg : colors.fgMuted} />
      <Text style={[styles.quickLabel, !enabled && styles.quickLabelDisabled]}>{label}</Text>
    </Pressable>
  );
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

function SubHead({ children }: { children: string }) {
  return <Text style={styles.subHead}>{children.toUpperCase()}</Text>;
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
 * forced, per CLAUDE.md's timezone rule.
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
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },

  quickRow: { flexDirection: 'row', gap: space.sm },
  quick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 0,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  quickDisabled: { borderColor: colors.border, opacity: 0.55 },
  quickLabel: { ...type.small, color: colors.fg },
  quickLabelDisabled: { color: colors.fgMuted },

  copyMenu: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.md,
  },
  copyItem: { paddingVertical: space.md },
  copyItemDisabled: { opacity: 0.6 },
  copyItemLabel: { ...type.body, color: colors.fg },
  copyItemLabelDisabled: { ...type.body, color: colors.fgMuted },
  copyItemNote: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

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

  subHead: { ...type.meta, color: colors.accent, marginTop: space.sm, marginBottom: space.xs },

  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  factLabel: { ...type.meta, color: colors.fgMuted },
  factValue: { ...type.body, color: colors.fg, flexShrink: 1, textAlign: 'right' },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  lineText: { flex: 1 },
  lineTitle: { ...type.body, color: colors.fg },
  lineMeta: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

  empty: { ...type.small, color: colors.fgMuted, paddingVertical: space.sm },
  pressed: { opacity: 0.6 },
});

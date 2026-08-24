import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, initialsOf } from '@/components/Avatar';
import { CollapsibleSection, type SectionAction } from '@/components/CollapsibleSection';
import { CardActionRow, CardIconButton } from '@/components/CardIconButton';
import { ChannelGlyph, channelLabelFor } from '@/components/ChannelGlyph';
import { InquiryStatusChip, StatusChip } from '@/components/StatusChip';
import { PlusIcon, SendIcon } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { buildCustomerDetailsText, clientName, fetchClient, type ClientDetail, type ClientInquiry } from '@/lib/clients';
import { fetchConversations } from '@/lib/conversations';
import { formatMoney } from '@/lib/giftCards';
import { statusLabel } from '@/lib/inquiryDisplay';
import { tabForStatus } from '@/lib/inquiryTabs';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, tones, type } from '@/theme';

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
  const [codeCopied, setCodeCopied] = useState(false);
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

  async function copyCode(code: string) {
    await Clipboard.setStringAsync(code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

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
          {/*
            Web's header card: the avatar, the name, the contact lines
            under it, the short client code as a chip with its own copy
            button, and the quick actions to the right.
          */}
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <Avatar url={null} initials={initialsOf(name)} size={44} labelStyle={styles.headerInitials} />
              <View style={styles.headerText}>
                <Text style={styles.headerName} numberOfLines={2}>
                  {name}
                </Text>
                {client.emails[0]?.email ?? client.email ? (
                  <Text style={styles.headerContact} numberOfLines={1}>
                    {client.emails[0]?.email ?? client.email}
                  </Text>
                ) : null}
                {client.phones[0]?.phone ?? client.phone ? (
                  <Text style={styles.headerContact} numberOfLines={1}>
                    {client.phones[0]?.phone ?? client.phone}
                  </Text>
                ) : null}
                {client.referralCode ? (
                  <Pressable
                    onPress={() => void copyCode(client.referralCode!)}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy client code ${client.referralCode}`}
                    style={({ pressed }) => [styles.codeChip, pressed && styles.pressed]}
                  >
                    <Text style={styles.codeChipText}>{client.referralCode}</Text>
                    <Feather name={codeCopied ? 'check' : 'copy'} size={11} color={colors.fgMuted} />
                  </Pressable>
                ) : null}
              </View>
            </View>

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
            {/* Web's overflow (…) holds archive and delete — both
                destructive, neither built. */}
            <QuickAction icon="more-horizontal" label="More" note="Archive and delete live in the portal." />
          </View>
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
            {/* Web leads this card with the consent line, before the
                numbers it governs. */}
            <Text style={styles.consentLine}>
              SMS Consent:{' '}
              {client.smsOptedOutAt ? 'Opted out' : client.smsConsentGivenAt ? 'Given' : 'Not yet given'}
            </Text>

            <SubHead>Phones</SubHead>
            {client.phones.length > 0 ? (
              client.phones.map((p) => (
                <ContactLine key={p.id} value={p.phone} label={p.label} primary={p.isPrimary} />
              ))
            ) : client.phone ? (
              <ContactLine value={client.phone} label={null} primary />
            ) : (
              <Empty text="No phone on file." />
            )}
            <DisabledInline label="+ Add phone" note="Adding a number is done in the portal." />

            <SubHead>Emails</SubHead>
            {client.emails.length > 0 ? (
              client.emails.map((e) => (
                <ContactLine key={e.id} value={e.email} label={e.label} primary={e.isPrimary} />
              ))
            ) : client.email ? (
              <ContactLine value={client.email} label={null} primary />
            ) : (
              <Empty text="No email on file." />
            )}
            <DisabledInline label="+ Add email" note="Adding an address is done in the portal." />

            {client.instagramHandle ? <Fact label="Instagram" value={client.instagramHandle} /> : null}
            {client.address ? <Fact label="Address" value={client.address} /> : null}
            {client.referredBy ? <Fact label="Referred by" value={clientName(client.referredBy)} /> : null}

            <DisabledInline
              label="Merge with another client"
              note="Merging is destructive — portal only."
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Inquiries"
            count={inquiries.length}
            open={!!open.inquiries}
            onToggle={() => toggle('inquiries')}
            headerActions={
              <CardActionRow>
                <CardIconButton
                  Icon={SendIcon}
                  label="Send inquiry via email"
                  unavailableNote="Sending an intake link lives in the portal for now."
                />
                <CardIconButton
                  Icon={PlusIcon}
                  label="New inquiry"
                  unavailableNote="Logging an inquiry lives in the portal for now."
                />
              </CardActionRow>
            }
          >
            {inquiries.length === 0 ? (
              <Empty text="No open inquiries." />
            ) : (
              <>
                {/* Web keeps these two column headers at phone width and
                    hides Channel and Submitted -- the row below folds
                    those into its meta line instead of dropping them. */}
                <View style={styles.columnHead}>
                  <Text style={styles.columnLabel}>Description</Text>
                  <Text style={styles.columnLabel}>Status</Text>
                </View>
                {inquiries.map((i, index) => (
                  <InquiryRowLine key={i.id} inquiry={i} last={index === inquiries.length - 1} />
                ))}
              </>
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
              projects.map((i) => <ProjectLine key={i.id} inquiry={i} />)
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
                    {/* Web's columns: code, expiry, and whether it is
                        attached to an appointment. */}
                    <Text style={styles.lineMeta} numberOfLines={1}>
                      {g.code}
                      {g.expiresAt ? ` · expires ${dateOnly(g.expiresAt)}` : ''}
                      {` · ${g.appointmentId ? 'Attached' : 'Unattached'}`}
                    </Text>
                  </View>
                  <StatusChip label={g.status} tone={giftCardTone(g.status)} />
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
                    <Text style={styles.lineTitle}>
                      Session {d.sessionNumber ?? 1} — {formatMoney(Math.round(d.totalCharged * 100))}
                    </Text>
                    {/* Web's columns: deposit vs total, signed, paid,
                        and the gift card it was settled with. */}
                    <Text style={styles.lineMeta} numberOfLines={2}>
                      {`deposit ${formatMoney(Math.round(d.depositAmount * 100))}`}
                      {` · signed ${d.signedAt ? stamp(d.signedAt) : 'Pending'}`}
                      {` · paid ${d.paidAt ? stamp(d.paidAt) : 'Not yet'}`}
                      {d.giftCard ? ` · ${d.giftCard.code}` : ''}
                    </Text>
                  </View>
                  {/* Web ends each row with a download for the signed
                      form. Nothing on this client downloads a file yet. */}
                  <Feather name="download" size={15} color={colors.fgMuted} style={styles.disabledIcon} />
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
                    {/* Web labels these by when they were CREATED, with
                        the state carried by the chip. */}
                    <Text style={styles.lineTitle}>Created {stamp(w.createdAt)}</Text>
                  </View>
                  <StatusChip label={w.signedAt ? 'Signed' : (w.status ?? 'Pending')}
                    tone={w.signedAt ? 'success' : 'warning'}
                  />
                </View>
              ))
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Notes" open={!!open.notes} onToggle={() => toggle('notes')}>
            {/* Web's explainer, verbatim. */}
            <Text style={styles.explainer}>
              Every note written on this client&apos;s inquiries, projects, and appointments —
              consolidated here, grouped by where it was written. Internal only — never shown to the
              client or shared with an artist.
            </Text>
            <Empty text="Writing a note is done in the portal." />
          </CollapsibleSection>

          <CollapsibleSection title="Activity history" open={!!open.activity} onToggle={() => toggle('activity')}>
            {/* Web groups this by date with a description per change. The
                client payload carries no audit trail, so the card keeps
                web's place and says so rather than showing nothing. */}
            <Empty text="No activity recorded yet." />
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
  icon: 'message-circle' | 'copy' | 'check' | 'edit-2' | 'more-horizontal';
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

/**
 * One inquiry row.
 *
 * Web's anatomy at phone width: description on the left, status chip on
 * the right, a hairline between rows, and generous vertical rhythm
 * (12px above and below, 14/20 text). Measured, not guessed.
 *
 * The meta line is mobile's own: web HIDES channel and submitted-date
 * entirely below its `sm` breakpoint, and rather than lose both, they
 * fold into one quiet line under the description — a monochrome channel
 * glyph and the date. Recorded as a deliberate divergence: it shows more
 * than web's phone rendering, not less.
 */
function InquiryRowLine({ inquiry, last }: { inquiry: ClientInquiry; last?: boolean }) {
  return (
    <View
      style={[styles.inquiryRow, last && styles.inquiryRowLast]}
      accessibilityLabel={`${inquiry.description?.trim() || 'Untitled inquiry'}, ${channelLabelFor(inquiry.channel)}, ${statusLabel(inquiry.status)}`}
    >
      <View style={styles.inquiryText}>
        <Text style={styles.inquiryTitle}>
          {inquiry.description?.trim() || inquiry.service || 'Untitled inquiry'}
        </Text>
        <View style={styles.metaLine}>
          <ChannelGlyph channel={inquiry.channel} />
          {inquiry.channel ? <Text style={styles.metaDot}>·</Text> : null}
          <Text style={styles.metaText}>{stamp(inquiry.createdAt)}</Text>
        </View>
      </View>
      <InquiryStatusChip status={inquiry.status} />
    </View>
  );
}

/**
 * Web's projects rows: the title with its status chip, then a line per
 * planned session carrying a deposit chip and a booking chip.
 *
 * The BOOKING chip ("Scheduled" / "Not yet booked" / "Completed") needs
 * appointment state, which this payload does not carry — so the session
 * line shows what it can and the report logs the gap rather than
 * guessing a booking status.
 */
function ProjectLine({ inquiry }: { inquiry: ClientInquiry }) {
  const sessions = inquiry.plannedSessions ?? [];
  const deposits = inquiry.depositForms ?? [];
  return (
    <View style={styles.project}>
      <View style={styles.line}>
        <View style={styles.lineText}>
          <Text style={styles.lineTitle} numberOfLines={2}>
            {inquiry.description?.trim() || inquiry.service || 'Untitled project'}
          </Text>
        </View>
        <InquiryStatusChip status={inquiry.status} />
      </View>

      {(sessions.length > 0 ? sessions : deposits.length > 0 ? deposits : [null]).map((_, index) => {
        const number = index + 1;
        const deposit = deposits.find((d) => (d.sessionNumber ?? 1) === number);
        return (
          <View key={number} style={styles.sessionLine}>
            <Text style={styles.sessionLabel}>Session {number}</Text>
            <StatusChip label={deposit ? (deposit.paidAt ? 'Deposit paid' : 'Deposit sent') : 'Deposit not yet generated'}
              tone={deposit?.paidAt ? 'success' : 'neutral'}
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * A control web offers inline that mobile cannot perform yet — rendered
 * in place, disabled, with its reason, so the card has web's shape.
 */
function DisabledInline({ label, note }: { label: string; note: string }) {
  return (
    <View style={styles.disabledInline}>
      <Text style={styles.disabledInlineLabel}>{label}</Text>
      <Text style={styles.disabledInlineNote}>{note}</Text>
    </View>
  );
}

/** A phone or email, with web's Primary chip and its Remove control. */
function ContactLine({
  value,
  label,
  primary,
}: {
  value: string;
  label: string | null;
  primary: boolean;
}) {
  return (
    <View style={styles.contactLine}>
      <Text style={styles.contactValue} selectable numberOfLines={1}>
        {value}
      </Text>
      {label ? <Text style={styles.contactLabel}>{label}</Text> : null}
      {primary ? <StatusChip label="Primary" tone="neutral" /> : null}
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

/** Web's gift-card colours: active green, void red, redeemed neutral. */
function giftCardTone(status: string): keyof typeof tones {
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'success';
  if (s === 'VOID' || s === 'EXPIRED') return 'danger';
  return 'neutral';
}

/** A real instant, as web writes it in these tables. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

  headerCard: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },
  headerTop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  headerText: { flex: 1, gap: 2 },
  headerInitials: { ...type.label, fontSize: 14, color: colors.fgMuted },
  headerName: { ...type.heading, color: colors.fg },
  headerContact: { ...type.meta, color: colors.fgMuted },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    marginTop: space.xs,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  codeChipText: { ...type.meta, color: colors.fgSecondary, letterSpacing: 1 },

  quickRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
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

  /* Web's column headers: 12px, muted, 12px of space beneath. */
  columnHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: space.md,
  },
  columnLabel: { ...type.meta, color: colors.fgMuted, fontSize: 12 },

  /* Web's row: 12px above and below, hairline between, none after the
     last -- a trailing rule under a card's final row is a stray line. */
  inquiryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  inquiryRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  inquiryText: { flex: 1 },
  /* Web's td: 14px over a 20px line. */
  inquiryTitle: { ...type.body, fontSize: 14, lineHeight: 20, color: colors.fg },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3 },
  metaDot: { ...type.meta, color: colors.fgMuted },
  metaText: { ...type.meta, color: colors.fgMuted },

  consentLine: { ...type.small, color: colors.fgSecondary, marginBottom: space.xs },

  contactLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  contactValue: { ...type.body, color: colors.fg, flexShrink: 1 },
  contactLabel: { ...type.meta, color: colors.fgMuted },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
    borderWidth: hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  chipDot: { width: 5, height: 5, borderRadius: radius.pill },
  chipLabel: { ...type.meta, fontSize: 9, letterSpacing: 1 },

  project: { paddingVertical: space.xs },
  sessionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingBottom: space.sm,
  },
  sessionLabel: { ...type.meta, color: colors.fgMuted, flex: 1 },

  disabledInline: { paddingVertical: space.sm, opacity: 0.55 },
  disabledInlineLabel: { ...type.small, color: colors.fgMuted },
  disabledInlineNote: { ...type.meta, color: colors.fgMuted },
  disabledIcon: { opacity: 0.4 },
  explainer: { ...type.small, color: colors.fgMuted, marginBottom: space.sm },
  pressed: { opacity: 0.6 },
});

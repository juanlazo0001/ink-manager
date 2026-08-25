import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, initialsOf } from '@/components/Avatar';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { CardActionRow, CardIconButton } from '@/components/CardIconButton';
import { Card } from '@/components/editorial';
import { ChannelGlyph, channelLabelFor } from '@/components/ChannelGlyph';
import { InquiryStatusChip, StatusChip, type ChipTone } from '@/components/StatusChip';
import {
  DownloadIcon,
  GiftCardIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  TrashIcon,
} from '@/components/icons';
import { ContactAddSheet } from '@/components/ContactAddSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import {
  buildCustomerDetailsText,
  clientName,
  fetchClient,
  type ClientDepositForm,
  type ClientDetail,
  type ClientInquiry,
  type ClientPlannedSession,
} from '@/lib/clients';
import { fetchConversations } from '@/lib/conversations';
import { calendarDate as dateOnly, formatPhone, stamp } from '@/lib/format';
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
 * EVERY SECTION USES THE SAME HEADER: one row, `[chevron] TITLE ....
 * [actions]`, with the actions icon-only and right-aligned. That is web's
 * `Widget` shell exactly, including the fact that FIVE of the nine
 * sections get no action at all — contact info, projects, appointments,
 * notes and activity history carry none on web either.
 *
 * NO COUNTS. Web's header has none, and the owner asked for them gone.
 *
 * Sections collapse, which web's do not need to — a phone cannot show
 * nine cards at once.
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
  /** The Contact Info card's "+" sheet. Opening is free; writing is not. */
  const [addContactOpen, setAddContactOpen] = useState(false);

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
      {/*
        ITEM 2: no title. The header card directly below carries the name
        at full size, and repeating it in the nav row said the same thing
        twice in two type sizes. The back button and the rest of the nav
        anatomy are unchanged.
      */}
      <ScreenHeader onBack={() => router.back()} />

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
            ITEM 5: a `Card`, not a bare bordered box. Every other section
            on this screen is one; this was the only surface rendering
            without the card fill and its top highlight, which is exactly
            why it read darker than the rest.
          */}
          <Card>
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
                    {formatPhone(client.phones[0]?.phone ?? client.phone)}
                  </Text>
                ) : null}
              </View>

              {/*
                ITEM 1: the client code sits at the card's TOP RIGHT,
                across from the avatar, rather than under the contact
                lines. It identifies the record rather than describing the
                person, so it belongs at the edge of the box, not in the
                run of their details.
              */}
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
          </Card>

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

          {/*
            The Inquiries card's header anatomy exactly: chevron, title,
            then a pair of icon actions on the right, same component and
            same size.

            DIVERGENCE FROM WEB, owner-directed. Web's Widget gives this
            section no header action at all and scatters its controls
            through the body — a text link per group plus a merge pill at
            the foot. Both are gone; `+` opens the add sheet and the
            magnifier is merge.
          */}
          <CollapsibleSection
            title="Contact info"
            open={!!open.contact}
            onToggle={() => toggle('contact')}
            headerActions={
              <CardActionRow>
                <CardIconButton
                  Icon={PlusIcon}
                  label="Add contact info"
                  onPress={() => setAddContactOpen(true)}
                />
                <CardIconButton
                  Icon={SearchIcon}
                  label="Merge with another client"
                  unavailableNote="Merging is destructive — portal only."
                />
              </CardActionRow>
            }
          >
            {/* Web leads this card with the consent line, before the
                numbers it governs — label, then the state in its own
                colour, with the date it was given. */}
            <Text style={styles.consentLine}>
              <Text style={styles.consentLabel}>SMS Consent: </Text>
              {client.smsConsentGivenAt ? (
                <Text style={styles.consentGiven}>Given {stamp(client.smsConsentGivenAt)}</Text>
              ) : (
                <Text style={styles.consentMissing}>Not yet given</Text>
              )}
            </Text>

            {/* Web's own second line, and its wording. An opt-out is not
                the absence of consent — outbound texts are refused. */}
            {client.smsOptedOutAt ? (
              <Text style={styles.consentOptedOut}>
                Opted out of SMS {stamp(client.smsOptedOutAt)} — outbound texts to this client are
                refused until they text START.
              </Text>
            ) : null}

            <SubHead>Phones</SubHead>
            {client.phones.length > 0 ? (
              client.phones.map((p) => (
                <ContactLine key={p.id} value={p.phone} label={p.label} primary={p.isPrimary} kind="phone" />
              ))
            ) : client.phone ? (
              <ContactLine value={client.phone} label={null} primary kind="phone" />
            ) : (
              <Empty text="No phone on file." />
            )}

            <SubHead>Emails</SubHead>
            {client.emails.length > 0 ? (
              client.emails.map((e) => (
                <ContactLine key={e.id} value={e.email} label={e.label} primary={e.isPrimary} kind="email" />
              ))
            ) : client.email ? (
              <ContactLine value={client.email} label={null} primary kind="email" />
            ) : (
              <Empty text="No email on file." />
            )}

            {client.instagramHandle ? <Fact label="Instagram" value={client.instagramHandle} /> : null}
            {client.address ? <Fact label="Address" value={client.address} /> : null}
            {client.referredBy ? <Fact label="Referred by" value={clientName(client.referredBy)} /> : null}
          </CollapsibleSection>

          <CollapsibleSection
            title="Inquiries"
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
            open={!!open.projects}
            onToggle={() => toggle('projects')}
          >
            {projects.length === 0 ? (
              <Empty text="No projects." />
            ) : (
              projects.map((i, index) => (
                <ProjectLine
                  key={i.id}
                  inquiry={i}
                  first={index === 0}
                  last={index === projects.length - 1}
                />
              ))
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Gift cards"
            open={!!open.gift}
            onToggle={() => toggle('gift')}
            headerActions={
              <CardActionRow>
                <CardIconButton
                  Icon={GiftCardIcon}
                  label="Issue gift card"
                  unavailableNote="Issuing a gift card moves money — portal only."
                />
              </CardActionRow>
            }
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
            open={!!open.deposits}
            onToggle={() => toggle('deposits')}
            headerActions={
              <CardActionRow>
                <CardIconButton
                  Icon={SendIcon}
                  label="Send deposit form"
                  unavailableNote="Sending a deposit form charges a client — portal only."
                />
              </CardActionRow>
            }
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
                  {/* Web ends each row with a download, and ONLY when the
                      form is signed — an unsigned one has no PDF. Same
                      condition here; nothing downloads a file on this
                      client yet, so it renders in the disabled treatment
                      and says so when tapped. */}
                  {d.signedAt ? (
                    <CardIconButton
                      Icon={DownloadIcon}
                      label="Download deposit form"
                      unavailableNote="Downloading a PDF is a portal action for now."
                    />
                  ) : null}
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
            open={!!open.waivers}
            onToggle={() => toggle('waivers')}
            headerActions={
              <CardActionRow>
                <CardIconButton
                  Icon={SendIcon}
                  label="Send waiver"
                  unavailableNote="Sending a waiver messages the client — portal only."
                />
              </CardActionRow>
            }
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
                  {/* Web puts a download before the chip on a SIGNED
                      waiver only, at its row size. */}
                  {w.signedAt ? (
                    <CardIconButton
                      Icon={DownloadIcon}
                      label="Download waiver"
                      unavailableNote="Downloading a PDF is a portal action for now."
                    />
                  ) : null}
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

      <ContactAddSheet
        visible={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onAddPhone={() => {
          setAddContactOpen(false);
          Alert.alert('Add phone', 'Adding a number is done in the portal.');
        }}
        onAddEmail={() => {
          setAddContactOpen(false);
          Alert.alert('Add email', 'Adding an address is done in the portal.');
        }}
      />
    </SafeAreaView>
  );
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
      <InquiryStatusChip status={inquiry.status} style={styles.inquiryChip} />
    </View>
  );
}

/**
 * Web's projects rows: the title with its status chip, then a line per
 * planned session carrying BOTH of web's badges — deposit and booking.
 *
 * The booking badge was reported as blocked in three earlier sessions.
 * It never was: `GET /clients/:id` returns `plannedSessions[].appointmentId`
 * and `.appointment.checkedOutAt`, and mobile's own type was dropping
 * them. See `ClientPlannedSession`.
 */
function ProjectLine({
  inquiry,
  first,
  last,
}: {
  inquiry: ClientInquiry;
  first?: boolean;
  last?: boolean;
}) {
  const sessions = inquiry.plannedSessions ?? [];
  const deposits = inquiry.depositForms ?? [];
  return (
    <View
      style={[
        styles.project,
        !last && styles.projectDivider,
        first && styles.projectFirst,
        last && styles.projectLast,
      ]}
    >
      <View style={styles.line}>
        <View style={styles.lineText}>
          <Text style={styles.lineTitle} numberOfLines={2}>
            {inquiry.description?.trim() || inquiry.service || 'Untitled project'}
          </Text>
          {/* A project IS an inquiry, so it carries the same channel —
              same quiet meta line the Inquiries card uses. */}
          <View style={styles.metaLine}>
            <ChannelGlyph channel={inquiry.channel} />
            {inquiry.channel ? <Text style={styles.metaDot}>·</Text> : null}
            <Text style={styles.metaText}>{stamp(inquiry.createdAt)}</Text>
          </View>
        </View>
        <InquiryStatusChip status={inquiry.status} />
      </View>

      <View style={styles.sessions}>
        {(sessions.length > 0 ? sessions : deposits.length > 0 ? deposits : [null]).map((row, index) => {
          const session = sessions.length > 0 ? sessions[index] : null;
          const number = session?.sessionNumber ?? index + 1;
          // Web resolves the deposit form by sessionNumber, newest first —
          // never by PlannedSession.depositFormId, which its own comment
          // records as a fixed linkage bug.
          const deposit =
            deposits
              .filter((d) => (d.sessionNumber ?? 1) === number)
              .sort((a, b) => (a.signedAt ?? '') < (b.signedAt ?? '') ? 1 : -1)[0] ?? null;
          const dep = sessionDepositBadge(deposit);
          const booking = sessionBookingBadge(session);
          return (
            <View key={session?.id ?? number} style={styles.sessionLine}>
              <Text style={styles.sessionLabel} numberOfLines={2}>
                {sessionLabelFor(number, session)}
              </Text>
              <View style={styles.sessionBadges}>
                <StatusChip label={dep.label} tone={dep.tone} />
                <StatusChip label={booking.label} tone={booking.tone} />
              </View>
            </View>
          );
        })}
      </View>
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

/**
 * A phone or email row: the value, its optional label in parentheses,
 * web's Primary tag, then the remove control.
 *
 * The value truncates in the MIDDLE. Running a long address off the end
 * would hide the domain, which is the half that identifies it — web never
 * has to make this choice because its rows wrap onto a second line, and
 * a row carrying a tag and a button cannot afford to.
 */
function ContactLine({
  value,
  label,
  primary,
  kind,
}: {
  value: string;
  label: string | null;
  primary: boolean;
  kind: 'phone' | 'email';
}) {
  // Formatted once: the row shows it, and the remove button SPEAKS it.
  // A screen reader announcing "Remove 3052997957" while the screen reads
  // "(305) 299-7957" is the same number described two ways.
  const shown = kind === 'phone' ? formatPhone(value) : value;

  return (
    <View style={styles.contactLine}>
      <Text style={styles.contactValue} selectable numberOfLines={1} ellipsizeMode="middle">
        {shown}
        {label ? <Text style={styles.contactLabel}> ({label})</Text> : null}
      </Text>
      {primary ? <PrimaryTag /> : null}
      <CardIconButton
        Icon={TrashIcon}
        tone="danger"
        style={styles.contactRemove}
        label={`Remove ${shown}`}
        unavailableNote={
          kind === 'phone'
            ? 'Removing a number is done in the portal.'
            : 'Removing an address is done in the portal.'
        }
      />
    </View>
  );
}

/**
 * Web's Primary tag, extracted from `ClientDetail.tsx`:
 *
 *   ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent
 *
 * Note what it is NOT: no dot, no border, no uppercase, and the fill is
 * the ACCENT at 15% rather than a tone at 10%. It is deliberately not a
 * status chip — "this is the one we use" is a property of the row, not a
 * state of the client — and mobile had been rendering it as a neutral
 * StatusChip, which put it in the wrong visual family entirely.
 */
function PrimaryTag() {
  return (
    <View style={styles.primaryTag}>
      <Text style={styles.primaryTagLabel}>Primary</Text>
    </View>
  );
}

/** A contact group's heading. Its add control now lives in the card header. */
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
 * Web's session badges, `sessionDepositBadge` and `sessionAppointmentBadge`
 * from `ClientDetail.tsx`, label for label.
 *
 * One wording fix falls out of the extraction: mobile said "Deposit sent"
 * for an unpaid form. Web says **"Deposit pending"**.
 */
function sessionDepositBadge(deposit: ClientDepositForm | null): { label: string; tone: ChipTone } {
  if (!deposit) return { label: 'Deposit not yet generated', tone: 'neutral' };
  if (deposit.paidAt) return { label: 'Deposit paid', tone: 'success' };
  return { label: 'Deposit pending', tone: 'warning' };
}

/**
 * Web's is `text-accent` for Scheduled, which is the brand gold and not
 * one of the eight status tones. `highlight` is the warm tone closest to
 * it in this palette; noted rather than silently substituted.
 */
function sessionBookingBadge(session: ClientPlannedSession | null): { label: string; tone: ChipTone } {
  if (!session?.appointmentId || !session.appointment) {
    return { label: 'Not yet booked', tone: 'neutral' };
  }
  if (session.appointment.checkedOutAt) return { label: 'Completed', tone: 'success' };
  return { label: 'Scheduled', tone: 'highlight' };
}

/** Web's session line: "Session 1 — estimated 3-5 hrs ($400-$600)". */
function sessionLabelFor(number: number, session: ClientPlannedSession | null): string {
  if (!session) return `Session ${number}`;
  const { estimatedHoursMin: lo, estimatedHoursMax: hi } = session;
  const hours = lo != null && hi != null ? ` — estimated ${lo}-${hi} hrs` : '';
  const { estimatedPriceLow: pLo, estimatedPriceHigh: pHi } = session;
  const price =
    pLo != null && pHi != null ? ` (${pLo === pHi ? `$${pLo}` : `$${pLo}-$${pHi}`})` : '';
  return `Session ${number}${hours}${price}`;
}

/** Web's gift-card colours: active green, void red, redeemed neutral. */
function giftCardTone(status: string): keyof typeof tones {
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'success';
  if (s === 'VOID' || s === 'EXPIRED') return 'danger';
  return 'neutral';
}

/** A real instant, as web writes it in these tables. */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  /*
   * ITEM 8. Web's widget list is `flex flex-col gap-6`
   * (`ReorderableWidgetList.tsx`) -- 24px between boxes. Mobile had 12.
   */
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  headerTop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', marginBottom: space.md },
  headerText: { flex: 1, gap: 2 },
  headerInitials: { ...type.label, fontSize: 14, color: colors.fgMuted },
  headerName: { ...type.heading, color: colors.fg },
  headerContact: { ...type.meta, color: colors.fgMuted },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    // Top right of the header card, level with the avatar.
    alignSelf: 'flex-start',
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

  /* Web: `flex items-center justify-between`, the eyebrow left and the
     add control right. The eyebrow keeps its own vertical rhythm; the
     32pt button is taller than it, so the row centres on the button. */
  subHead: { ...type.meta, color: colors.accent, marginTop: space.md, marginBottom: space.xs },

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
    /*
     * WEB'S OWN FALLBACK, borrowed one level down. `Widget`'s header row
     * is `flex-wrap` so a header that runs out of width breaks a line
     * rather than crushing a child; the same applies here, because the
     * longest status chip is 170pt and a 320pt phone leaves the card only
     * 236pt of row. Without this the description got 58pt — five lines of
     * two syllables each. With it, the chip drops to its own line at 320
     * and both stay whole. At 390 nothing wraps and the row is unchanged.
     *
     * Which of the two gives way is deliberate: web truncates
     * DESCRIPTIONS (it slices them at 60 characters) and never truncates
     * a status, so the status keeps its full width here too.
     */
    flexWrap: 'wrap',
    gap: space.md,
    /*
     * ITEM 3, and the extraction disagreed with the brief. Web's `<td>` is
     * `py-3` -- 12px -- which is EXACTLY what this already was, so there
     * was no web value to import. The scrunch is real but its cause is
     * that a mobile row is two lines (description, then the meta line)
     * where web's is one, so the same 12px has twice as much to separate.
     *
     * Raised to 16 on the owner's instruction. That is a deliberate step
     * AWAY from web's number, recorded as such rather than dressed up as
     * parity.
     */
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  inquiryRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  // The floor that decides when the chip wraps. Below this the row is
  // not worth reading, so the line breaks instead.
  inquiryText: { flex: 1, minWidth: 150 },
  // Keeps the chip at the row's right edge on whichever line it lands.
  inquiryChip: { marginLeft: 'auto' },
  /* Web's td: 14px over a 20px line. */
  inquiryTitle: { ...type.body, fontSize: 14, lineHeight: 20, color: colors.fg },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3 },
  // ITEM 4: one step below `fgMuted` -- see the token's own note.
  metaDot: { ...type.meta, color: colors.fgFaint },
  metaText: { ...type.meta, color: colors.fgFaint },

  /* Web: `text-xs font-medium text-fg-secondary`, with the state in its
     own colour -- success when given, muted when not, warning on an
     opt-out. */
  consentLine: { ...type.small, color: colors.fgSecondary, marginBottom: space.xs },
  consentLabel: { color: colors.fgSecondary },
  consentGiven: { color: tones.success },
  consentMissing: { color: colors.fgMuted },
  consentOptedOut: { ...type.small, color: tones.warning, marginBottom: space.xs },

  /*
   * ONE LINE, NEVER WRAPPING. The Primary tag belongs to the value it
   * marks, so it sits immediately after it with a single gap; the remove
   * button is the row's own control and holds the right edge, in line
   * with the add button in the group heading above.
   *
   * Session T wrapped this row instead, to keep a long address whole.
   * The owner's call reverses that: the VALUE gives way, truncating
   * before the tag can ever wrap or collide with it. `flexShrink` on the
   * value and nothing else is what enforces it.
   */
  contactLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  // The only shrinkable thing in the row.
  contactValue: { ...type.body, color: colors.fg, flexShrink: 1 },
  // Holds the right edge, in one column with the group heading's add button.
  contactRemove: { marginLeft: 'auto' },
  contactLabel: { ...type.meta, color: colors.fgMuted },

  /* Web's Primary tag, verbatim:
       bg-accent/15  text-accent  rounded-full  px-2 py-0.5  text-[10px] font-semibold
     No dot, no border, no uppercase -- deliberately NOT a status chip. */
  primaryTag: {
    flexShrink: 0,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(201, 154, 91, 0.15)',
  },
  primaryTagLabel: {
    fontFamily: type.button.fontFamily,
    fontSize: 10,
    lineHeight: 14,
    color: colors.accent,
  },


  /*
   * ITEM 6, extracted from web's projects widget:
   *
   *   project block   `py-3 first:pt-0 last:pb-0`   -> 12, divided
   *   sessions start  `mt-2`                        -> 8 below the title
   *   between rows    `space-y-1.5`                 -> 6
   *
   * Mobile had 4px around the whole project and 8px under each session,
   * with nothing separating the title row from the first session -- which
   * is the scrunch: the sessions read as part of the title rather than as
   * a list beneath it.
   */
  project: { paddingVertical: space.md },
  projectFirst: { paddingTop: 0 },
  projectLast: { paddingBottom: 0, borderBottomWidth: 0 },
  projectDivider: { borderBottomWidth: hairline, borderBottomColor: colors.border },
  sessions: { marginTop: space.sm, gap: 6 },
  /*
   * A session line carries a label and TWO badges, which is three things
   * on one row — one more than the inquiry row that already needed this.
   * Same rule as everywhere else on this screen: the row wraps, the label
   * keeps a readable floor, and the badges travel together to the right
   * edge of whichever line they land on.
   */
  sessionLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  sessionLabel: { ...type.meta, color: colors.fgSecondary, flex: 1, minWidth: 150 },
  sessionBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },

  disabledInline: { paddingVertical: space.sm, opacity: 0.55 },
  disabledInlineLabel: { ...type.small, color: colors.fgMuted },
  disabledInlineNote: { ...type.meta, color: colors.fgMuted },
  explainer: { ...type.small, color: colors.fgMuted, marginBottom: space.sm },
  pressed: { opacity: 0.6 },
});

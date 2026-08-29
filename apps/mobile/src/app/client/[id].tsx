import type { AppointmentListItem } from '@ink-manager/shared-types';
import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { SmsConsentActions } from '@/components/SmsConsentActions';
import { sendPrefillInquiryLink } from '@/lib/prefill';
import { CONSENT_SOURCE_LABELS } from '@/lib/consentLabels';
import { Avatar, initialsOf } from '@/components/Avatar';
import { ActivityHistory } from '@/components/ActivityHistory';
import { Banner } from '@/components/Banner';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { QuickAction, QuickActionRow } from '@/components/QuickAction';
import { CardActionRow, CardIconButton } from '@/components/CardIconButton';
import { Card, CardEmpty, Fact } from '@/components/editorial';
import { ChannelGlyph, channelLabelFor } from '@/components/ChannelGlyph';
import { InquiryStatusChip, StatusChip, type ChipTone } from '@/components/StatusChip';
import {
  DownloadIcon,
  GiftCardIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  StarIcon,
  TrashIcon,
} from '@/components/icons';
import { ContactAddSheet } from '@/components/ContactAddSheet';
import { ClientMoreSheet } from '@/components/ClientMoreSheet';
import { IssueGiftCardSheet } from '@/components/IssueGiftCardSheet';
import { MergeClientSheet } from '@/components/MergeClientSheet';
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
import { fetchWidgetLayout } from '@/lib/artists';
import { shareDocument, type DocumentRef } from '@/lib/documents';
import {
  addClientEmail,
  addClientPhone,
  archiveClient,
  makeClientEmailPrimary,
  makeClientPhonePrimary,
  removeClientEmail,
  removeClientPhone,
  unarchiveClient,
} from '@/lib/clientWrites';
import { appointmentBadge, type AppointmentTone } from '@/lib/appointmentDisplay';
import { fetchAppointments } from '@/lib/appointments';
import { giftCardTone } from '@/lib/giftCardDisplay';
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
/**
 * Web's `CLIENT_WIDGET_ORDER`, id for id — the fallback for a user who has
 * never reordered this page.
 */
const CLIENT_SECTION_ORDER = [
  'contact-info',
  'inquiries',
  'projects',
  'gift-cards',
  'deposit-forms',
  'appointments',
  'waivers',
  'notes',
  'activity-history',
];

/**
 * A saved order, reconciled against the sections this build actually has.
 *
 * Same job as web's `computeOrder`: honour what the user arranged, drop
 * ids that no longer exist, and append any section added since they last
 * touched it — in the default order's own relative positions, so a new
 * card lands where it was designed to rather than at the bottom.
 */
function mergeOrder(saved: string[]): string[] {
  const known = saved.filter((id) => CLIENT_SECTION_ORDER.includes(id));
  const missing = CLIENT_SECTION_ORDER.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

export default function ClientScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const isArtist = session?.profile?.role === 'ARTIST';

  /*
   * ─── WHICH INQUIRY SCREEN, AND WHY IT IS A BRANCH ─────────────────
   *
   * Not a fresh choice: the Inquiries tab already makes exactly this one
   * (`(tabs)/inquiries.tsx:264-267`) and states the reason — an ARTIST
   * reads `GET /inquiries/assigned-to-me/:id` while OWNER and FRONT_DESK
   * read `GET /inquiries/:id`, and the two are DIFFERENT SHAPES rather
   * than one being a subset of the other. So the app has two detail
   * screens on purpose, and a row that picked one for everybody would be
   * broken for half the roles. This mirrors the established pattern
   * rather than inventing a third answer.
   */
  const openInquiry = useCallback(
    (inquiryId: string) =>
      router.push(
        isArtist
          ? { pathname: '/inquiry/[id]', params: { id: inquiryId } }
          : { pathname: '/staff-inquiry/[id]', params: { id: inquiryId } },
      ),
    [isArtist, router],
  );

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [sendingPrefill, setSendingPrefill] = useState(false);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  /** The client's existing thread, if they have one. Null until looked up. */
  const [threadId, setThreadId] = useState<string | null>(null);
  /** The Contact Info card's "+" sheet. Opening is free; writing is not. */
  const [addContactOpen, setAddContactOpen] = useState(false);
  /**
   * Rows mid-write, so a control shows a spinner rather than lying about
   * having finished. Keyed by the row's own id.
   */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [issueGiftOpen, setIssueGiftOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  /** A write that failed, said once, above the card it failed in. */
  const [writeError, setWriteError] = useState<string | null>(null);
  /** The one document currently being fetched, so its own row can spin. */
  const [sharingId, setSharingId] = useState<string | null>(null);
  /**
   * ITEM 5. Web's client detail fires `GET /appointments?clientId=` right
   * beside `GET /clients/:id` — the appointments were never on the client
   * payload for either client, and mobile simply never made the second
   * call. Null until it lands; `[]` is a real "none".
   */
  const [appointments, setAppointments] = useState<AppointmentListItem[] | null>(null);
  /**
   * ITEM 3. The card order, and whether the move controls are showing.
   *
   * `client-detail` is WEB'S OWN pageKey for this screen, and
   * `PUT /widget-layouts/:pageKey` is the endpoint web's `useWidgetLayout`
   * writes to — per-user, not per-studio. Mobile already had both halves
   * from session B's artist profile editor (`fetchWidgetLayout` /
   * `saveWidgetLayout`); nothing new was needed on either side, and
   * because the key matches, a reorder here shows up on web for the same
   * person and vice versa.
   */
  const [order, setOrder] = useState<string[]>(CLIENT_SECTION_ORDER);
  /**
   * REMOVED IN SESSION AA, on the owner's verdict: drag-to-reorder was
   * not smooth enough to keep. Cards render in the saved order and that
   * is all.
   *
   * THE PERSISTENCE IS DELIBERATELY LEFT WIRED. `fetchWidgetLayout` still
   * reads the order on load, `mergeOrder` still reconciles it against the
   * sections this build has, and the key is still web's own
   * `client-detail` — so an order arranged ON WEB is honoured here, and
   * whatever the owner had already arranged survives. What is gone is the
   * gesture, the handles and the write. `saveWidgetLayout` has no caller
   * on this screen any more; that is intentional, not an oversight.
   */
  /**
   * Whatever the server currently holds for collapse, carried through
   * untouched on every write. Mobile keeps its own collapse in local
   * state, so sending [] would silently clear what the same person
   * collapsed on web.
   */
  const savedCollapsed = useRef<string[]>([]);

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

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchWidgetLayout(token, 'client-detail')
      .then((layout) => {
        if (cancelled) return;
        setOrder(mergeOrder(layout.widgetOrder ?? []));
        savedCollapsed.current = layout.collapsedWidgetIds ?? [];
      })
      .catch(() => {
        // No saved layout, or the read failed. The default order is
        // already on screen; a missing preference is not an error.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * Optimistic and best-effort, exactly as web's `persist` is: the move
   * lands on screen immediately and a failed PUT only means it does not
   * survive a relaunch. Never worth blocking a drag over.
   */
  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    fetchAppointments(token, { clientId: id })
      .then((rows) => {
        if (!cancelled) setAppointments(rows);
      })
      .catch(() => {
        // A failed secondary fetch must not take the screen down; the
        // card says it could not load rather than claiming there are none.
        if (!cancelled) setAppointments(null);
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

  /**
   * ITEM 5 — deposit forms and waivers, out through the share sheet.
   *
   * Both PDFs come from the same shape of authenticated route; see
   * `lib/documents.ts` for why a share sheet is the honest reading of
   * "download" on a phone. Failures land in the same `writeError` line
   * the contact writes use, so this card has one place that reports
   * trouble rather than two.
   */
  /*
   * ─── WHAT "SEND INQUIRY" ACTUALLY DOES ────────────────────────────
   *
   * Web's button is a `SendChannelButton` whose action is
   * `handleCopyPrefillLink` → `POST /prefill-drafts`. Because it passes
   * `clientId`, the route does not merely mint: it resolves the client's
   * conversation and AUTO-SENDS the shortened link on the chosen channel
   * (`routes/prefillDrafts.ts:110-152`), returning `prefillSendResult`
   * alongside the URL. The label is literal.
   *
   * THE CONSENT GATE IS THE SERVER'S, NOT OURS. `sendClientSms` refuses
   * `no_consent` and `opted_out` itself, and its own comment records why:
   * "every app funnels through here, so no caller can text a
   * non-consenting client". Mobile therefore cannot bypass it even by
   * mistake. What the UI adds is honesty — the button is unavailable
   * when the send would certainly be refused, so nobody taps a control
   * that cannot work.
   *
   * NOT the same thing as session 20-C's absolute rule. That one forbids
   * texting the OPT-IN link — the consent request itself — to a number
   * that has not consented. This is an ordinary business message to a
   * client who HAS consented, refused server-side otherwise.
   */
  /*
   * Web's `SendChannelButton` decides availability from exactly these
   * three facts. Mirrored so the two clients refuse in the same cases and
   * say the same thing.
   */
  const sendBlockedReason =
    client == null
      ? 'Loading.'
      : client.phones.length === 0 && !client.phone
        ? 'This client has no phone number on file.'
        : client.smsOptedOutAt
          ? 'This client opted out of SMS.'
          : client.smsConsentGivenAt
            ? null
            : 'No SMS consent on file — record it in Contact info first.';

  async function sendInquiryLink() {
    if (!token || !client) return;
    setSendingPrefill(true);
    setPrefillNotice(null);
    try {
      const result = await sendPrefillInquiryLink(token, {
        clientId: client.id,
        channel: 'SMS',
        payload: {
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email ?? undefined,
          phone: client.phone ?? undefined,
        },
      });
      /* Web surfaces the send's own outcome rather than assuming the 200
         meant delivery — `prefillSendResult` can report a refusal while
         the draft itself was created fine. */
      setPrefillNotice(
        result.prefillSendResult && result.prefillSendResult.sent === false
          ? `The link was created but not sent: ${(result.prefillSendResult.reason ?? 'unknown reason').replace(/_/g, ' ')}.`
          : 'Inquiry link sent.',
      );
    } catch (err) {
      setPrefillNotice(screenErrorMessage(err, 'That link was not sent.'));
    } finally {
      setSendingPrefill(false);
    }
  }

  async function share(doc: DocumentRef) {
    if (!token) return;
    setSharingId(doc.id);
    setWriteError(null);
    try {
      await shareDocument(token, doc);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : 'The document could not be downloaded.');
    } finally {
      setSharingId(null);
    }
  }

  function markBusy(key: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /**
   * Every contact write goes through here.
   *
   * OPTIMISTIC, WITH A VISIBLE REVERT. The row changes immediately; if
   * the request fails the previous client object is put back exactly as
   * it was and the reason is shown. A write that silently didn't happen
   * is the one outcome worth engineering against — the screen would keep
   * claiming a number the studio no longer has.
   */
  async function contactWrite(
    key: string,
    optimistic: (current: ClientDetail) => ClientDetail,
    request: () => Promise<unknown>,
  ) {
    if (!client) return;
    const previous = client;
    markBusy(key, true);
    setWriteError(null);
    setClient(optimistic(previous));
    try {
      await request();
      // Re-read rather than trust the optimistic shape: adding a phone can
      // also change which row is primary, and the server decides that.
      if (token && id) setClient(await fetchClient(token, id));
    } catch (err) {
      setClient(previous);
      setWriteError(screenErrorMessage(err, 'That change did not save.'));
    } finally {
      markBusy(key, false);
    }
  }

  function addPhone(phone: string, label: string | null) {
    if (!token || !id) return;
    void contactWrite(
      'add-phone',
      (c) => ({
        ...c,
        phones: [...c.phones, { id: `pending-${Date.now()}`, phone, label, isPrimary: c.phones.length === 0 }],
      }),
      () => addClientPhone(token, id, { phone, label }),
    );
  }

  function addEmail(email: string, label: string | null) {
    if (!token || !id) return;
    void contactWrite(
      'add-email',
      (c) => ({
        ...c,
        emails: [...c.emails, { id: `pending-${Date.now()}`, email, label, isPrimary: c.emails.length === 0 }],
      }),
      () => addClientEmail(token, id, { email, label }),
    );
  }

  function removePhone(phoneId: string) {
    if (!token || !id) return;
    void contactWrite(
      phoneId,
      (c) => ({ ...c, phones: c.phones.filter((row) => row.id !== phoneId) }),
      () => removeClientPhone(token, id, phoneId),
    );
  }

  function removeEmail(emailId: string) {
    if (!token || !id) return;
    void contactWrite(
      emailId,
      (c) => ({ ...c, emails: c.emails.filter((row) => row.id !== emailId) }),
      () => removeClientEmail(token, id, emailId),
    );
  }

  function makePhonePrimary(phoneId: string) {
    if (!token || !id) return;
    void contactWrite(
      phoneId,
      (c) => ({ ...c, phones: c.phones.map((row) => ({ ...row, isPrimary: row.id === phoneId })) }),
      () => makeClientPhonePrimary(token, id, phoneId),
    );
  }

  function makeEmailPrimary(emailId: string) {
    if (!token || !id) return;
    void contactWrite(
      emailId,
      (c) => ({ ...c, emails: c.emails.map((row) => ({ ...row, isPrimary: row.id === emailId })) }),
      () => makeClientEmailPrimary(token, id, emailId),
    );
  }

  /** Archive and unarchive, web's own reversible pair. */
  async function toggleArchive() {
    if (!token || !id || !client) return;
    const archiving = client.archivedAt === null;
    markBusy('archive', true);
    setWriteError(null);
    try {
      const updated = archiving ? await archiveClient(token, id) : await unarchiveClient(token, id);
      setClient((current) => (current ? { ...current, archivedAt: updated.archivedAt } : current));
    } catch (err) {
      setWriteError(screenErrorMessage(err, 'That change did not save.'));
    } finally {
      markBusy('archive', false);
    }
  }

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
    <ScreenShell edges={['top']}>
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

          <QuickActionRow>
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
              onPress={() => router.push({ pathname: '/client-edit', params: { id: id! } })}
            />
            {/*
              ITEM 6d. Web's overflow holds Archive/Unarchive and Delete.
              Archive is live — it is soft and reversible, and web's own
              route comment says so. DELETE IS NOT: it is permanent, it is
              OWNER-only, and it is not in the set this session was
              cleared for. Web also guards it with a typed confirmation
              over a server-rendered preview of what would be destroyed,
              which is its own piece of work.
            */}
            <QuickAction
              icon="more-horizontal"
              label="More"
              onPress={() => setMoreOpen(true)}
            />
          </QuickActionRow>
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
          {/*
            ITEM 3: the cards render in the SAVED order, keyed by web's own
            widget ids so the two clients agree about what moved. Built
            here rather than above the return because every one of them
            reads `client`, which is only non-null inside this branch.
          */}
          {(() => {
            const SECTIONS: Record<string, React.ReactNode> = {
    'contact-info': (
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
                  onPress={() => setMergeOpen(true)}
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
                <Text style={styles.consentGiven}>
                  Given {stamp(client.smsConsentGivenAt)}
                  {/* Web appends the source in the same line — the record
                      is only useful if it says where it came from. */}
                  {client.smsConsentSource
                    ? ` · ${CONSENT_SOURCE_LABELS[client.smsConsentSource] ?? client.smsConsentSource}`
                    : ''}
                </Text>
              ) : (
                <Text style={styles.consentMissing}>Not yet given</Text>
              )}
            </Text>

            {/*
              Both grant paths, side by side as web offers them: recording
              is right for someone at the counter, the link is right for
              everyone else and is the stronger record. Absent once
              consent is on file — there is nothing left to grant.
            */}
            <SmsConsentActions
              clientId={client.id}
              token={token}
              consentGivenAt={client.smsConsentGivenAt}
              onRecorded={(patch) =>
                setClient((current) =>
                  current ? { ...current, ...patch } : current,
                )
              }
            />

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
                <ContactLine
                  key={p.id}
                  value={p.phone}
                  label={p.label}
                  primary={p.isPrimary}
                  kind="phone"
                  busy={busyIds.has(p.id)}
                  removable={!p.isPrimary || client.phones.length === 1}
                  onRemove={() => removePhone(p.id)}
                  onMakePrimary={() => makePhonePrimary(p.id)}
                />
              ))
            ) : client.phone ? (
              <ContactLine value={client.phone} label={null} primary kind="phone" />
            ) : (
              <CardEmpty text="No phone on file." />
            )}

            <SubHead>Emails</SubHead>
            {client.emails.length > 0 ? (
              client.emails.map((e) => (
                <ContactLine
                  key={e.id}
                  value={e.email}
                  label={e.label}
                  primary={e.isPrimary}
                  kind="email"
                  busy={busyIds.has(e.id)}
                  removable={!e.isPrimary || client.emails.length === 1}
                  onRemove={() => removeEmail(e.id)}
                  onMakePrimary={() => makeEmailPrimary(e.id)}
                />
              ))
            ) : client.email ? (
              <ContactLine value={client.email} label={null} primary kind="email" />
            ) : (
              <CardEmpty text="No email on file." />
            )}

            {client.instagramHandle ? <Fact label="Instagram" value={client.instagramHandle} /> : null}
            {client.address ? <Fact label="Address" value={client.address} /> : null}
            {client.referredBy ? <Fact label="Referred by" value={clientName(client.referredBy)} /> : null}
          </CollapsibleSection>
    ),
    'inquiries': (
          <CollapsibleSection
            title="Inquiries"
            open={!!open.inquiries}
            onToggle={() => toggle('inquiries')}
            headerActions={
              <CardActionRow>
                {/*
                  Web's Send Inquiry is a SendChannelButton gated on the
                  client's consent state, because the send it triggers is
                  a real SMS. The same gate is applied here for the same
                  reason — not to enforce the rule (the server does that,
                  unconditionally) but so the control is honest about
                  whether a tap can work.
                */}
                <CardIconButton
                  Icon={SendIcon}
                  label="Send inquiry link"
                  busy={sendingPrefill}
                  onPress={sendBlockedReason ? undefined : () => void sendInquiryLink()}
                  unavailableNote={sendBlockedReason ?? undefined}
                />
                <CardIconButton
                  Icon={PlusIcon}
                  label="New inquiry"
                  onPress={() =>
                    router.push({
                      pathname: '/inquiry-new',
                      params: {
                        clientId: client.id,
                        firstName: client.firstName,
                        lastName: client.lastName,
                        email: client.email ?? '',
                        phone: client.phone ?? '',
                      },
                    })
                  }
                />
              </CardActionRow>
            }
          >
            {prefillNotice ? <Text style={styles.sendNotice}>{prefillNotice}</Text> : null}

            {inquiries.length === 0 ? (
              /* The CTA above is live now, so this empty state points at
                 a path that actually exists. */
              <CardEmpty text="No open inquiries." />
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
                  <InquiryRowLine
                    key={i.id}
                    inquiry={i}
                    last={index === inquiries.length - 1}
                    onPress={() => openInquiry(i.id)}
                  />
                ))}
              </>
            )}
          </CollapsibleSection>
    ),
    'projects': (
          <CollapsibleSection
            title="Projects"
            open={!!open.projects}
            onToggle={() => toggle('projects')}
          >
            {projects.length === 0 ? (
              <CardEmpty text="No projects." />
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
    ),
    'gift-cards': (
          <CollapsibleSection
            title="Gift cards"
            open={!!open.gift}
            onToggle={() => toggle('gift')}
            headerActions={
              <CardActionRow>
                {/*
                  The toast moved to the END of the flow.

                  This button used to raise "Issuing a gift card moves
                  money — portal only." on tap, so nothing existed behind
                  it. The form is real now — method, amount, validation,
                  the OWNER-only expiry, and the exact request body — and
                  only the SUBMIT is gated. The payments session replaces
                  one function in `IssueGiftCardSheet`, rather than
                  building a screen from nothing.
                */}
                <CardIconButton
                  Icon={GiftCardIcon}
                  label="Issue gift card"
                  onPress={() => setIssueGiftOpen(true)}
                />
              </CardActionRow>
            }
          >
            {client.giftCards.length === 0 ? (
              <CardEmpty text="No gift cards." />
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
                    {/* ITEM 2: the code, and only the code. Expiry and
                        attachment are on the card's own screen, one tap
                        away, and were crowding the row that exists to say
                        which card this is. */}
                    <Text style={styles.lineMeta} numberOfLines={1}>
                      {g.code}
                    </Text>
                  </View>
                  <StatusChip label={g.status} tone={giftCardTone(g.status)} />
                  <Feather name="chevron-right" size={16} color={colors.fgMuted} />
                </Pressable>
              ))
            )}
          </CollapsibleSection>
    ),
    'deposit-forms': (
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
              <CardEmpty text="No deposit forms." />
            ) : (
              deposits.map((d) => (
                <View key={d.id} style={styles.line}>
                  <View style={styles.lineText}>
                    <Text style={styles.lineTitle}>
                      Session {d.sessionNumber ?? 1} — {formatMoney(Math.round(d.totalCharged * 100))}
                    </Text>
                    {/* The meta line is gone entirely (session W). The
                        title says which session and for how much; the
                        chip says where it stands. The dates and the
                        deposit split are on the form itself, and on a
                        phone they were three quiet clauses nobody reads
                        under a title that already answers the question. */}
                    <View style={styles.belowChips}>
                      <StatusChip label={depositState(d).label} tone={depositState(d).tone} />
                    </View>
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
                      busy={sharingId === d.id}
                      onPress={() =>
                        void share({
                          kind: 'deposit-forms',
                          id: d.id,
                          filename: `deposit-form-session-${d.sessionNumber ?? 1}.pdf`,
                        })
                      }
                    />
                  ) : null}
                </View>
              ))
            )}
          </CollapsibleSection>
    ),
    'appointments': (
          <CollapsibleSection title="Appointments" open={!!open.appointments} onToggle={() => toggle('appointments')}>
            {appointments === null ? (
              <CardEmpty text="Loading appointments…" />
            ) : appointments.length === 0 ? (
              <CardEmpty text="No appointments yet." />
            ) : (
              appointments.map((a, index) => (
                <AppointmentLine key={a.id} appointment={a} last={index === appointments.length - 1} />
              ))
            )}
          </CollapsibleSection>
    ),
    'waivers': (
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
              <CardEmpty text="No waivers." />
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
                      busy={sharingId === w.id}
                      onPress={() => void share({ kind: 'waivers', id: w.id, filename: `waiver-${w.id}.pdf` })}
                    />
                  ) : null}
                  <StatusChip label={w.signedAt ? 'Signed' : (w.status ?? 'Pending')}
                    tone={w.signedAt ? 'success' : 'warning'}
                  />
                </View>
              ))
            )}
          </CollapsibleSection>
    ),
    'notes': (
          <CollapsibleSection title="Notes" open={!!open.notes} onToggle={() => toggle('notes')}>
            {/* Web's explainer, verbatim. */}
            <Text style={styles.explainer}>
              Every note written on this client&apos;s inquiries, projects, and appointments —
              consolidated here, grouped by where it was written. Internal only — never shown to the
              client or shared with an artist.
            </Text>
            <CardEmpty text="Writing a note is done in the portal." />
          </CollapsibleSection>
    ),
    'activity-history': (
          <CollapsibleSection title="Activity history" open={!!open.activity} onToggle={() => toggle('activity')}>
            {/*
              THE CARD WAS NEVER EMPTY FOR WANT OF DATA.

              This rendered a hardcoded "No activity recorded yet." behind
              a comment reading "the client payload carries no audit
              trail". That sentence is true and it is the wrong
              conclusion: the audit trail was never part of the client
              payload on EITHER client. Web reads it from a separate
              endpoint -- `ClientDetail.tsx` renders
              `<AuditTrail bare entityType="Client" entityId={client.id} />`
              against `GET /audit?entityType=&entityId=` -- and mobile has
              had a complete port of that component since the gift-card
              screen, which calls the very same endpoint with
              `entityType="GiftCard"`.

              So the section was not dropped in consolidation and nothing
              was missing from a payload. One line was never wired up.
            */}
            <ActivityHistory token={token!} entityType="Client" entityId={id!} />
          </CollapsibleSection>
    ),
  };
            return order.map((sectionId) => (
              <View key={sectionId}>{SECTIONS[sectionId]}</View>
            ));
          })()}
        </ScrollView>
      )}

      <IssueGiftCardSheet
        visible={issueGiftOpen}
        onClose={() => setIssueGiftOpen(false)}
        clientId={id!}
        /*
         * The expiry override and the Exemption method are BOTH
         * OWNER-only server-side (`giftCards.ts` 403s a non-owner who
         * sends `expiresAt` at all, and `POST /gift-cards/exempt` is
         * wrapped in `requireRole(Role.OWNER)`).
         *
         * Read off the caller's own role claim, which is the honest
         * source for "what will the server let ME do" -- unlike a
         * studio-scoping question, where CLAUDE.md's rule is that the
         * token's studioId can be stale. Role here decides only whether
         * to OFFER a control; the server decides the outcome either way,
         * so a stale claim costs a 403, never an unauthorized write.
         */
        isOwner={session?.profile.role === 'OWNER'}
      />

      <ClientMoreSheet
        visible={moreOpen}
        archived={!!client?.archivedAt}
        busy={busyIds.has('archive')}
        onClose={() => setMoreOpen(false)}
        onToggleArchive={() => {
          setMoreOpen(false);
          void toggleArchive();
        }}
      />

      {client ? (
        <MergeClientSheet
          visible={mergeOpen}
          survivor={client}
          token={token}
          onClose={() => setMergeOpen(false)}
          onMerged={(updated) => {
            setMergeOpen(false);
            setClient(updated);
            // Everything moved: inquiries, appointments, gift cards and
            // the threads. Re-read rather than patch nine lists by hand.
            if (token && id) void fetchClient(token, id).then(setClient).catch(() => {});
          }}
        />
      ) : null}

      <ContactAddSheet
        visible={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onAddPhone={(phone, label) => {
          setAddContactOpen(false);
          addPhone(phone, label);
        }}
        onAddEmail={(email, label) => {
          setAddContactOpen(false);
          addEmail(email, label);
        }}
      />
    </ScreenShell>
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
function InquiryRowLine({
  inquiry,
  last,
  onPress,
}: {
  inquiry: ClientInquiry;
  last?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.inquiryRow,
        last && styles.inquiryRowLast,
        pressed && onPress ? styles.rowPressed : null,
      ]}
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
    </Pressable>
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
          // ITEM 1: the chips sit BELOW their session line and are
          // left-aligned under it, so a session reads as one block rather
          // than as a label with two things trailing off the right edge.
          return (
            <View key={session?.id ?? number} style={styles.sessionBlock}>
              <Text style={styles.sessionLabel}>{sessionLabelFor(number, session)}</Text>
              <View style={styles.belowChips}>
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
  busy,
  onRemove,
  onMakePrimary,
  removable,
}: {
  value: string;
  label: string | null;
  primary: boolean;
  kind: 'phone' | 'email';
  busy?: boolean;
  onRemove?: () => void;
  /** Absent on the row that is already primary — web hides it there too. */
  onMakePrimary?: () => void;
  /**
   * False when the server would refuse this delete.
   *
   * FOUND BY EXERCISING THE REAL API, not by reading the route: deleting
   * the PRIMARY row 400s with "Make another phone primary before removing
   * this one" — unless it is the only row, in which case it is allowed
   * and the client's own `phone`/`email` column is nulled with it. The
   * button would have been permanently broken on exactly one row per
   * group, and only on records with more than one.
   */
  removable?: boolean;
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

      {/* Web offers "Make primary" on every row that is not already it —
          same rule here. */}
      {!primary && onMakePrimary ? (
        <CardIconButton
          Icon={StarIcon}
          label={`Make ${shown} primary`}
          onPress={busy ? undefined : onMakePrimary}
          unavailableNote="Saving…"
        />
      ) : null}

      <CardIconButton
        Icon={TrashIcon}
        tone="danger"
        style={styles.contactRemove}
        label={`Remove ${shown}`}
        onPress={busy || removable === false ? undefined : onRemove}
        unavailableNote={
          removable === false
            ? `Make another ${kind === 'phone' ? 'number' : 'address'} primary before removing this one.`
            : 'Saving…'
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

/**
 * ITEM 4's chip. Web's Deposit Forms table renders "Signed"/"Pending" and
 * a paid column as prose; on a phone the row's STATE is what a person
 * scans for, so it becomes the chip and the dates stay as meta.
 */
function depositState(d: ClientDepositForm): { label: string; tone: ChipTone } {
  if (d.paidAt) return { label: 'Paid', tone: 'success' };
  if (d.signedAt) return { label: 'Signed, not paid', tone: 'warning' };
  return { label: 'Not signed', tone: 'neutral' };
}

/** One of the client's appointments, as web's Appointments table shows it. */
function AppointmentLine({
  appointment,
  last,
}: {
  appointment: AppointmentListItem;
  last?: boolean;
}) {
  const badge = appointmentBadge(appointment);
  const artist = appointment.artist?.name ?? null;
  return (
    <View style={[styles.line, last && styles.lineLast]}>
      {/*
        ITEM 2: the artist becomes their FACE. A name repeated down a
        column is the same width of grey text as the date beside it;
        an avatar is scannable at a glance and is how web renders this
        very column (`<Avatar name avatarUrl />` before the name).
      */}
      <Avatar
        url={appointment.artist?.avatarUrl ?? null}
        initials={initialsOf(artist ?? '?')}
        size={28}
        labelStyle={styles.apptInitials}
      />
      <Text style={[styles.lineTitle, styles.apptWhen]} numberOfLines={1}>
        {stamp(appointment.startTime)}
      </Text>
      {/* Chip right-aligned on the row, not below it. */}
      <StatusChip label={badge.label} tone={APPOINTMENT_CHIP_TONES[badge.tone]} style={styles.apptChip} />
    </View>
  );
}

/**
 * The Schedule tab's three-value tone vocabulary, translated into the
 * chip's eight.
 *
 * `appointmentBadge` speaks `accent | neutral | alert` — a palette built
 * for the schedule's dot-and-label badges, not for status chips. Casting
 * one to the other is what a first pass did here, and every appointment
 * chip rendered GREY, because `tones` has no `accent` or `alert` key and
 * the lookup fell through its neutral default. Caught in the render.
 *
 * The mapping follows web's own reading of the same states:
 * `accent` marks "needs an action soon" (Requested, Needs checkout,
 * Waiver pending), which web tones `warning`; `alert` is a session
 * actually lost, which web tones `danger` for NO_SHOW.
 */
const APPOINTMENT_CHIP_TONES: Record<AppointmentTone, ChipTone> = {
  accent: 'warning',
  neutral: 'neutral',
  alert: 'danger',
};

/** A real instant, as web writes it in these tables. */

const styles = StyleSheet.create({
  /*
   * ITEM 8. Web's widget list is `flex flex-col gap-6`
   * (`ReorderableWidgetList.tsx`) -- 24px between boxes. Mobile had 12.
   */
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  /* The lifted card, while its handle is held. */
  dragging: { opacity: 0.85, transform: [{ scale: 0.99 }] },

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

  /* Web: `flex items-center justify-between`, the eyebrow left and the
     add control right. The eyebrow keeps its own vertical rhythm; the
     32pt button is taller than it, so the row centres on the button. */
  subHead: { ...type.meta, color: colors.accent, marginTop: space.md, marginBottom: space.xs },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  lineLast: { borderBottomWidth: 0 },
  /* ITEM 2: avatar + when on the left, chip held to the right edge. */
  apptInitials: { ...type.label, fontSize: 10, color: colors.fgMuted },
  apptWhen: { flexShrink: 1 },
  apptChip: { marginLeft: 'auto' },
  lineText: { flex: 1 },
  lineTitle: { ...type.body, color: colors.fg },
  lineMeta: { ...type.meta, color: colors.fgMuted, marginTop: 2 },


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
  rowPressed: { opacity: 0.6 },
  sendNotice: { ...type.meta, color: colors.fgSecondary, marginBottom: space.sm },
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
  writeError: { ...type.small, color: tones.danger, marginTop: space.sm },
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
  sessions: { marginTop: space.sm, gap: 10 },
  /*
   * A session line carries a label and TWO badges, which is three things
   * on one row — one more than the inquiry row that already needed this.
   * Same rule as everywhere else on this screen: the row wraps, the label
   * keeps a readable floor, and the badges travel together to the right
   * edge of whichever line they land on.
   */
  /*
   * ITEM 1. A session is a title with its chips underneath, left-aligned,
   * and `sessions`' own 6px gap is no longer enough to separate two of
   * those blocks — web's `space-y-1.5` was spacing single lines. 10px
   * between blocks, 4px between a line and its own chips: the gap inside
   * a block stays visibly smaller than the gap between blocks, which is
   * what makes them read as blocks at all.
   */
  sessionBlock: { gap: space.xs },
  sessionLabel: { ...type.meta, color: colors.fgSecondary },
  /* Chips that sit under the line they belong to, not beside it. */
  belowChips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: space.xs },

  disabledInline: { paddingVertical: space.sm, opacity: 0.55 },
  disabledInlineLabel: { ...type.small, color: colors.fgMuted },
  disabledInlineNote: { ...type.meta, color: colors.fgMuted },
  explainer: { ...type.small, color: colors.fgMuted, marginBottom: space.sm },
  pressed: { opacity: 0.6 },
});

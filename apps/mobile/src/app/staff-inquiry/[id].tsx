import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AssignArtistSheet } from '@/components/AssignArtistSheet';
import { CardActionRow, CardIconButton } from '@/components/CardIconButton';
import { ConsultationSheet } from '@/components/ConsultationSheet';
import { EstimateSheet } from '@/components/EstimateSheet';
import { AttachmentChip } from '@/components/AttachmentChip';
import { NoteBody } from '@/components/NoteBody';
import { NoteEditor } from '@/components/NoteEditor';
import { CalendarIcon, PersonIcon, PlusIcon, SendIcon, TrashIcon } from '@/components/icons';
import { Avatar, initialsOf } from '@/components/Avatar';
import { Banner } from '@/components/Banner';
import { Card, CardEmpty, Fact } from '@/components/editorial';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { QuickAction, QuickActionRow } from '@/components/QuickAction';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenShell } from '@/components/ScreenShell';
import { InquiryStatusChip } from '@/components/StatusChip';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { stamp } from '@/lib/format';
import { formatMoney } from '@/lib/giftCards';
import {
  buildSendBody,
  draftFromInquiry,
  sendEstimate,
  type EstimateChannel,
  type EstimateDraft,
} from '@/lib/estimate';
import { buildBookingBody, createConsultation, type BookingDraft } from '@/lib/booking';
import { channelLabel } from '@/lib/inquiryDisplay';
import {
  canModifyNote,
  createInquiryNote,
  deleteInquiryNote,
  fetchInquiryNotes,
  updateInquiryNote,
  type NoteAttachment,
  type InquiryNote,
} from '@/lib/inquiryNotes';
import { screenErrorMessage } from '@/lib/screenError';
import {
  artistName,
  assignInquiryArtist,
  fetchStaffInquiryDetail,
  pipelineStages,
  type StaffInquiryDetail,
} from '@/lib/staffInquiry';
import { colors, hairline, space, type } from '@/theme';

/**
 * The OWNER / FRONT_DESK view of an inquiry.
 *
 * Why this screen exists at all: mobile's `inquiry/[id]` renders the
 * ARTIST payload (`GET /inquiries/assigned-to-me/:id`), which is a
 * different shape, so the inquiries list deliberately made owner rows
 * inert rather than open something that could not load. Session J's
 * diagnosis confirmed the cause is exactly that and NOT the API scoping
 * inconsistency in PARITY-AUDIT.md Finding B — `GET /inquiries/:id`
 * returns 200 for an owner. This screen is the missing half.
 *
 * Section order mirrors apps/web's InquiryDetail: pipeline, assignment,
 * estimate, deposit, appointment, the intake answers, then the closing
 * state.
 *
 * **READ-ONLY.** Web's version also assigns and reassigns artists, sends
 * and revises estimates, sends deposit forms, schedules consultations and
 * appointments, edits every field, and marks lost / archives / deletes.
 * Each of those is either an outbound message to a real client, money, or
 * destructive — and this run's contract is explicit that none of those
 * gets built unattended off a guess. Their exact contracts are recorded
 * in the session report so the next session starts from a finished
 * investigation rather than this one.
 *
 * ─── AND IT IS THE CLIENT PAGE'S DESIGN SYSTEM ──────────────────────
 *
 * It was not. This screen had grown its own `Section` (an `Eyebrow` over
 * a plain bordered box), its own `Fact`, its own `Empty` and its own
 * `stamp` — the last of which was byte-for-byte `lib/format`'s. Counting
 * the client page and `DetailSection.tsx`, the app held THREE different
 * `Fact` components, and they disagreed: this one aligned its rows to the
 * top and padded 12, the client page's centred them and padded 10.
 *
 * All four are gone. What renders here is what renders on the client
 * page — `Card`, `CollapsibleSection`, `Fact`, `CardEmpty`, `Banner`,
 * `QuickAction` — imported, not reproduced.
 */
/** Newest first, matching the route's own ordering. */
function byNewest(a: InquiryNote, b: InquiryNote): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export default function StaffInquiryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [inquiry, setInquiry] = useState<StaffInquiryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  /* Shown on the card itself after a failed write, not only inside the
     sheet — the sheet closes on the optimistic update, so a failure that
     spoke only there would be invisible. */
  const [revertNotice, setRevertNotice] = useState<string | null>(null);

  /*
   * Whether this caller may assign at all.
   *
   * The PERMISSION, never the role: `PATCH /:id/assign` has no
   * requireRole and gates on hasPermissionAt(..., 'inquiries.assignArtist')
   * at the record's studio. By default FRONT_DESK has it and ARTIST does
   * not, but the matrix is studio-editable, so reading the role here
   * would be a second source of truth that can disagree with the server.
   */
  const canAssign = (session?.profile.permissions ?? []).includes('inquiries.assignArtist');
  /* Same rule as assignment: the PERMISSION, at the record's studio. All
     four note routes gate on this one key. */
  const canManageNotes = (session?.profile.permissions ?? []).includes('inquiries.notes.manage');

  /*
   * Attaching is the ONE control on this screen gated on a ROLE rather
   * than a permission, because the server gates it that way:
   * `GET /uploads/note-attachment-signature` is
   * `requireRole(Role.OWNER, Role.FRONT_DESK)` with no permission key
   * behind it. An ARTIST holding `inquiries.notes.manage` can still
   * write notes — they simply cannot obtain an upload signature, so
   * offering them the control would produce a 403 and nothing else.
   */
  const canAttachToNote =
    session?.profile.role === 'OWNER' || session?.profile.role === 'FRONT_DESK';

  /*
   * `inquiries.sendEstimate` — FRONT_DESK holds it by default, ARTIST
   * does NOT (they have `inquiries.artistSendEstimate`, a different key
   * for their own scoped flow on their own assigned inquiry). Gate on
   * the permission, never the role, for the same reason as assignment:
   * the route has no requireRole and the matrix is studio-editable.
   */
  const canSendEstimate = (session?.profile.permissions ?? []).includes('inquiries.sendEstimate');

  const [estimateOpen, setEstimateOpen] = useState(false);
  const [estimateDraft, setEstimateDraft] = useState<EstimateDraft | null>(null);
  const [sendingEstimate, setSendingEstimate] = useState(false);
  /** Synchronous in-flight guard for the send. See onSendEstimate. */
  const sendInFlight = useRef(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  /* `appointments.create`, the key POST /appointments is gated on. */
  const canBook = (session?.profile.permissions ?? []).includes('appointments.create');

  const [consultOpen, setConsultOpen] = useState(false);
  const [consultDraft, setConsultDraft] = useState<BookingDraft>({
    date: '',
    startTime: '',
    endTime: '',
    artistId: null,
    notes: '',
  });
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  /* The server's own scheduling-buffer warning, shown AFTER a successful
     booking. Never used to block — see ConsultationSheet's note. */
  const [bufferWarning, setBufferWarning] = useState<string | null>(null);
  /* Same synchronous guard the estimate send needed: React state reads
     stale within a tick, so two presses would both pass `!booking`. */
  const bookInFlight = useRef(false);

  const [notes, setNotes] = useState<InquiryNote[] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  /* null = composing a new note; a note = editing that one. */
  const [editing, setEditing] = useState<InquiryNote | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteNotice, setNoteNotice] = useState<string | null>(null);

  /* Nine sections would be a lot to scroll past; these are seven and the
     top three are the ones an owner opens this screen for. The rest stay
     one tap away, which is the client page's own balance. */
  const [open, setOpen] = useState<Record<string, boolean>>({
    pipeline: true,
    assignment: true,
    estimate: true,
  });
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  /*
   * OPTIMISTIC, with a visible revert.
   *
   * The card shows the new artist immediately, because the common case
   * is success and a spinner on a name is worse than the name. On
   * failure the previous inquiry is put back verbatim — not re-fetched,
   * which could race with whatever else changed — and a notice appears
   * ON THE CARD saying so, because by then the sheet has closed.
   *
   * The success path settles on the route's OWN response rather than the
   * guess: a first assignment also moves status NEW -> ARTIST_ASSIGNED
   * server-side, and the optimistic object cannot know that.
   */
  const onAssign = useCallback(
    async (artist: { id: string; user: { name: string | null; email: string } }) => {
      if (!token || !id || !inquiry) return;
      const previous = inquiry;

      setAssigning(true);
      setAssignError(null);
      setRevertNotice(null);
      setInquiry({
        ...inquiry,
        assignedArtistId: artist.id,
        assignedAt: new Date().toISOString(),
        assignedArtist: { id: artist.id, user: { name: artist.user.name, email: artist.user.email } },
      });
      setAssignOpen(false);

      try {
        const updated = await assignInquiryArtist(token, id, artist.id);
        setInquiry(updated);
      } catch (err) {
        setInquiry(previous);
        /*
         * A NOUN, not a clause. screenErrorMessage substitutes its
         * second argument into its own sentences -- "Your role does not
         * have access to ${subject}." -- so passing "that artist could
         * not be assigned" produced "Your role does not have access to
         * that artist could not be assigned." It only escaped the AR-2
         * evidence because that fixture returned 400, which takes the
         * err.message branch instead.
         */
        const message = screenErrorMessage(err, 'that artist');
        setAssignError(message);
        setRevertNotice(message);
      } finally {
        setAssigning(false);
      }
    },
    [token, id, inquiry],
  );

  const loadNotes = useCallback(async () => {
    if (!token || !id) return;
    try {
      setNotes(await fetchInquiryNotes(token, id));
    } catch {
      /* The notes card degrades to empty rather than taking the screen
         down with it — the inquiry itself is still perfectly readable
         without them. */
      setNotes([]);
    }
  }, [token, id]);

  /*
   * Create and update share one path, because the routes do: identical
   * body, identical permission, and the only difference is the URL.
   *
   * NOT optimistic, unlike assignment, and the difference is deliberate.
   * An assignment is one field with an obvious previous value to put
   * back. A note is a body someone just typed; showing it as saved and
   * then removing it would be worse than a moment's wait, and the
   * server also normalises (`bodyHtml.trim()`) and stamps `updatedAt`,
   * so the optimistic object would be a guess at its own content.
   */
  const onSaveNote = useCallback(
    async (bodyHtml: string, visibleToArtist: boolean, attachments: NoteAttachment[]) => {
      if (!token || !id) return;
      setSavingNote(true);
      setNoteError(null);
      try {
        const saved = editing
          ? await updateInquiryNote(token, id, editing.id, { bodyHtml, visibleToArtist, attachments })
          : await createInquiryNote(token, id, { bodyHtml, visibleToArtist, attachments });
        setNotes((current) => {
          const rest = (current ?? []).filter((n) => n.id !== saved.id);
          return editing ? [...rest, saved].sort(byNewest) : [saved, ...rest].sort(byNewest);
        });
        setEditorOpen(false);
        setEditing(null);
      } catch (err) {
        setNoteError(screenErrorMessage(err, 'that note'));
      } finally {
        setSavingNote(false);
      }
    },
    [token, id, editing],
  );

  /*
   * Delete IS optimistic, and reverts the same way assignment does. The
   * row vanishes on tap because that is what the tap means; on failure
   * it comes back in place and says why.
   */
  const onDeleteNote = useCallback(
    async (note: InquiryNote) => {
      if (!token || !id) return;
      const previous = notes;
      setNoteNotice(null);
      setNotes((current) => (current ?? []).filter((n) => n.id !== note.id));
      try {
        await deleteInquiryNote(token, id, note.id);
      } catch (err) {
        setNotes(previous);
        setNoteNotice(screenErrorMessage(err, 'that note'));
      }
    },
    [token, id, notes],
  );

  /*
   * SEND — and this puts a real message on a real phone. NOT optimistic,
   * for the obvious reason: there is no local state that can stand in
   * for "a text has left the building", and pretending otherwise would
   * be the worst possible thing to be wrong about. The sheet's own
   * confirmation gates the tap; this settles on the route's response,
   * which carries the new status (AWAITING_CLIENT_RESPONSE) and the
   * estimate URL.
   */
  const onSendEstimate = useCallback(
    async (channel: EstimateChannel) => {
      if (!token || !id || !estimateDraft) return;

      /*
       * A REF, not the state flag, and this is not belt-and-braces.
       *
       * The button already checks `!sending`, but setSendingEstimate is
       * React state: two presses in the same tick both read false and
       * both proceed. Caught in the harness, where a synthetic press
       * dispatches pointerup AND click and fired two identical
       * send-estimate requests -- on this endpoint that is two text
       * messages to a client, which is the single worst thing on this
       * screen to get wrong.
       *
       * A ref flips synchronously, so the second call returns before it
       * can reach the network.
       */
      if (sendInFlight.current) return;
      sendInFlight.current = true;

      setSendingEstimate(true);
      setEstimateError(null);
      try {
        const updated = await sendEstimate(token, id, buildSendBody(estimateDraft, channel));
        setInquiry(updated);
        setEstimateOpen(false);
        setEstimateDraft(null);
      } catch (err) {
        setEstimateError(screenErrorMessage(err, 'this estimate'));
      } finally {
        sendInFlight.current = false;
        setSendingEstimate(false);
      }
    },
    [token, id, estimateDraft],
  );

  const onBookConsultation = useCallback(async () => {
    if (!token || !id || !inquiry?.clientId) return;
    if (bookInFlight.current) return;
    bookInFlight.current = true;

    setBooking(true);
    setBookError(null);
    setBufferWarning(null);
    try {
      const created = await createConsultation(
        token,
        buildBookingBody(consultDraft, { clientId: inquiry.clientId, inquiryId: id }),
      );
      /*
       * The warning rides along with a SUCCESSFUL booking, so it is
       * surfaced on the card rather than in the sheet, which closes.
       *
       * AND THE CARD IS OPENED when there is one. Caught in the harness:
       * the Appointment section is collapsed by default and its header
       * action is what opens the sheet, so a booking made from the
       * collapsed card put the warning somewhere nobody could see it.
       * The route returns this specifically so staff can decide, and
       * they cannot decide what is hidden.
       */
      setBufferWarning(created.bufferWarning ?? null);
      if (created.bufferWarning) setOpen((o) => ({ ...o, appointment: true }));
      setConsultOpen(false);
      setConsultDraft({ date: '', startTime: '', endTime: '', artistId: null, notes: '' });
      await load();
    } catch (err) {
      setBookError(screenErrorMessage(err, 'this appointment'));
    } finally {
      bookInFlight.current = false;
      setBooking(false);
    }
    // `load` is defined below and is stable for this screen's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, inquiry?.clientId, consultDraft]);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      setInquiry(await fetchStaffInquiryDetail(token, id));
    } catch (err) {
      setError(screenErrorMessage(err, "That inquiry couldn't be loaded."));
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const clientLabel = inquiry?.client
    ? `${inquiry.client.firstName} ${inquiry.client.lastName}`
    : 'Inquiry';

  return (
    <ScreenShell edges={['top']}>
      {/* Bare — the name leads the hero card, as on the client page. */}
      <ScreenHeader onBack={() => router.back()} />

      {error ? (
        <StateMessage
          eyebrow="Not loaded"
          title="That inquiry couldn't be loaded"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      ) : !inquiry ? (
        <ScreenLoading />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <View style={styles.headerTop}>
              <Avatar url={null} initials={initialsOf(clientLabel)} size={44} labelStyle={styles.headerInitials} />
              <View style={styles.headerText}>
                <Text style={styles.headerName} numberOfLines={2}>
                  {clientLabel}
                </Text>
                {inquiry.channel ? (
                  <Text style={styles.headerContact} numberOfLines={1}>
                    {channelLabel(inquiry.channel)} · {stamp(inquiry.createdAt)}
                  </Text>
                ) : (
                  <Text style={styles.headerContact} numberOfLines={1}>
                    {stamp(inquiry.createdAt)}
                  </Text>
                )}
              </View>
            </View>

            {/*
              THE REAL CHIP, not a hand-rolled pill.

              This was a bordered box that uppercased the raw status and
              painted itself `colors.accent` REGARDLESS of what the status
              was — a lost inquiry and a booked one drew the same gold.
              `InquiryStatusChip` maps every one of the 15 enum values to
              its own tone, and it is what the inquiries list and the
              client page's inquiries card already use, so a status reads
              the same in all three places now.

              Its own row rather than the card's top-right corner, for the
              reason measured on the artist screen: that slot is sized for
              a short identifier, and an 88pt status chip in it costs the
              client's name the width it needs.
            */}
            <View style={styles.statusRow}>
              <InquiryStatusChip status={inquiry.status} />
            </View>

            {/*
              The continuity links. Both routes already exist and both ids
              are on this payload; the artist-side screen cannot offer the
              client one at all, because `InquiryClientRef` carries only a
              first and last name. Recorded as a finding, not worked
              around here.
            */}
            <QuickActionRow>
              <QuickAction
                icon="user"
                label="Client"
                onPress={
                  inquiry.client?.id
                    ? () => router.push({ pathname: '/client/[id]', params: { id: inquiry.client!.id } })
                    : undefined
                }
                note={inquiry.client?.id ? undefined : 'This inquiry has no client record yet.'}
              />
              <QuickAction
                icon="calendar"
                label="Appointment"
                onPress={
                  inquiry.appointmentId
                    ? () => router.push({ pathname: '/appointment/[id]', params: { id: inquiry.appointmentId! } })
                    : undefined
                }
                note={inquiry.appointmentId ? undefined : 'No appointment booked yet.'}
              />
            </QuickActionRow>
          </Card>

          <CollapsibleSection title="Pipeline" open={!!open.pipeline} onToggle={() => toggle('pipeline')}>
            {pipelineStages(inquiry).map((stage) => (
              <View key={stage.key} style={styles.stage}>
                <Feather
                  name={stage.done ? 'check-circle' : stage.current ? 'target' : 'circle'}
                  size={15}
                  color={stage.done || stage.current ? colors.accent : colors.fgMuted}
                />
                <Text
                  style={[
                    styles.stageLabel,
                    stage.done && styles.stageDone,
                    stage.current && styles.stageCurrent,
                  ]}
                >
                  {stage.label}
                </Text>
              </View>
            ))}
          </CollapsibleSection>

          <CollapsibleSection
            title="Assignment"
            open={!!open.assignment}
            onToggle={() => toggle('assignment')}
            headerActions={
              canAssign ? (
                <CardActionRow>
                  <CardIconButton
                    Icon={PersonIcon}
                    label={inquiry.assignedArtistId ? 'Reassign artist' : 'Assign an artist'}
                    onPress={() => setAssignOpen(true)}
                    busy={assigning}
                  />
                </CardActionRow>
              ) : undefined
            }
          >
            <Fact label="Artist" value={artistName(inquiry) ?? 'Unassigned'} last={!inquiry.assignedAt} />
            {inquiry.assignedAt ? <Fact label="Assigned" value={stamp(inquiry.assignedAt)} last /> : null}
            {/* The revert's own voice. See onAssign. */}
            {revertNotice ? <Text style={styles.revert}>{revertNotice}</Text> : null}
          </CollapsibleSection>

          <CollapsibleSection
            title="Estimate"
            open={!!open.estimate}
            onToggle={() => toggle('estimate')}
            headerActions={
              canSendEstimate ? (
                <CardActionRow>
                  <CardIconButton
                    Icon={SendIcon}
                    label={inquiry.estimateSentAt ? 'Send a new estimate' : 'Compose an estimate'}
                    onPress={() => {
                      /* Seeded from whatever the inquiry already carries,
                         so a resend starts from the last numbers rather
                         than from nothing. */
                      setEstimateDraft(draftFromInquiry(inquiry, false));
                      setEstimateError(null);
                      setEstimateOpen(true);
                    }}
                    busy={sendingEstimate}
                  />
                </CardActionRow>
              ) : undefined
            }
          >
            {inquiry.priceEstimateLow != null && inquiry.priceEstimateHigh != null ? (
              <Fact
                label="Price"
                value={`$${inquiry.priceEstimateLow} – $${inquiry.priceEstimateHigh}`}
              />
            ) : (
              <CardEmpty text="No estimate entered." />
            )}
            {inquiry.timeEstimateHoursMin != null ? (
              <Fact
                label="Time"
                value={
                  inquiry.timeEstimateHoursMax != null &&
                  inquiry.timeEstimateHoursMax !== inquiry.timeEstimateHoursMin
                    ? `${inquiry.timeEstimateHoursMin}–${inquiry.timeEstimateHoursMax} hours`
                    : `${inquiry.timeEstimateHoursMin} hours`
                }
              />
            ) : null}
            {/* Web shows this as a timeline with deltas; the facts are the
                same three timestamps. */}
            {inquiry.estimateSentAt ? <Fact label="Sent" value={stamp(inquiry.estimateSentAt)} /> : null}
            {inquiry.estimateOpenedAt ? (
              <Fact label="Opened" value={stamp(inquiry.estimateOpenedAt)} />
            ) : null}
            {inquiry.estimateRespondedAt ? (
              <Fact label="Responded" value={stamp(inquiry.estimateRespondedAt)} />
            ) : null}
            {inquiry.estimateRevisionSentAt ? (
              <Fact
                label="Revision"
                value={
                  inquiry.estimateRevisionApproved === true
                    ? 'Approved'
                    : inquiry.estimateRevisionApproved === false
                      ? 'Declined'
                      : 'Awaiting response'
                }
              />
            ) : null}
            {inquiry.estimateRevisionReason ? (
              <Fact label="Revision reason" value={inquiry.estimateRevisionReason} multiline />
            ) : null}
          </CollapsibleSection>

          <CollapsibleSection
            title={`Deposits (${inquiry.depositForms.length})`}
            open={!!open.deposits}
            onToggle={() => toggle('deposits')}
          >
            {inquiry.depositForms.length === 0 ? (
              <CardEmpty text="No deposit form sent." />
            ) : (
              inquiry.depositForms.map((d, i) => (
                <View
                  key={d.id}
                  style={[styles.line, i === inquiry.depositForms.length - 1 && styles.lineLast]}
                >
                  <View style={styles.lineText}>
                    <Text style={styles.lineTitle}>
                      {formatMoney(Math.round(d.totalCharged * 100))}
                    </Text>
                    <Text style={styles.lineMeta}>
                      {d.paidAt ? `Paid ${stamp(d.paidAt)}` : 'Awaiting payment'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Appointment"
            open={!!open.appointment}
            onToggle={() => toggle('appointment')}
            headerActions={
              canBook ? (
                <CardActionRow>
                  <CardIconButton
                    Icon={CalendarIcon}
                    label="Schedule a consultation"
                    onPress={() => {
                      setBookError(null);
                      setConsultOpen(true);
                    }}
                    busy={booking}
                  />
                </CardActionRow>
              ) : undefined
            }
          >
            {/*
              The studio's scheduling buffer, reported after the fact.
              The route returns this ALONGSIDE a successful booking so
              staff can decide -- it is not an error and the appointment
              exists either way.
            */}
            {bufferWarning ? <Text style={styles.bufferWarning}>{bufferWarning}</Text> : null}
            {inquiry.appointmentId ? (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/appointment/[id]', params: { id: inquiry.appointmentId! } })
                }
                accessibilityRole="button"
                style={({ pressed }) => [styles.line, styles.lineLast, pressed && styles.pressed]}
              >
                <View style={styles.lineText}>
                  <Text style={styles.lineTitle}>Booked</Text>
                  {inquiry.appointment?.startTime ?? inquiry.appointment?.startAt ? (
                    <Text style={styles.lineMeta}>
                      {stamp((inquiry.appointment.startTime ?? inquiry.appointment.startAt)!)}
                    </Text>
                  ) : null}
                </View>
                <Feather name="chevron-right" size={16} color={colors.fgMuted} />
              </Pressable>
            ) : (
              <CardEmpty text="No appointment booked yet." />
            )}
          </CollapsibleSection>

          <CollapsibleSection title="The request" open={!!open.request} onToggle={() => toggle('request')}>
            {inquiry.description ? <Fact label="Wants" value={inquiry.description} multiline /> : null}
            {inquiry.placement ? <Fact label="Placement" value={inquiry.placement} /> : null}
            {inquiry.estimatedSize ? <Fact label="Size" value={inquiry.estimatedSize} /> : null}
            {inquiry.colorOrBlackGrey ? (
              <Fact label="Colour" value={inquiry.colorOrBlackGrey} />
            ) : null}
            {inquiry.desiredTiming ? <Fact label="Timing" value={inquiry.desiredTiming} /> : null}
            {inquiry.clientStatedBudget || inquiry.budget ? (
              <Fact label="Client budget" value={inquiry.clientStatedBudget ?? inquiry.budget} />
            ) : null}
            {inquiry.hasBeenTattooedBefore != null ? (
              <Fact label="Tattooed before" value={inquiry.hasBeenTattooedBefore ? 'Yes' : 'No'} last />
            ) : null}
          </CollapsibleSection>

          {inquiry.closedReason || inquiry.declineNote || inquiry.archivedAt ? (
            <CollapsibleSection title="Closed" open={!!open.closed} onToggle={() => toggle('closed')}>
              {inquiry.closedReason ? <Fact label="Reason" value={inquiry.closedReason} multiline /> : null}
              {inquiry.declineNote ? <Fact label="Note" value={inquiry.declineNote} multiline /> : null}
              {inquiry.archivedAt ? <Fact label="Archived" value={stamp(inquiry.archivedAt)} last /> : null}
            </CollapsibleSection>
          ) : null}

          <AssignArtistSheet
            visible={assignOpen}
            onClose={() => setAssignOpen(false)}
            token={token!}
            currentArtistId={inquiry.assignedArtistId}
            assigning={assigning}
            error={assignError}
            onAssign={onAssign}
          />

          {/*
            NOTES. Staff-facing and internal: the schema's own note says a
            note is "never shown to the client or shared with an artist"
            unless `visibleToArtist` is set, and this card shows every
            note regardless of that flag because the staff routes always
            do.
          */}
          <CollapsibleSection
            title="Notes"
            open={!!open.notes}
            onToggle={() => toggle('notes')}
            headerActions={
              canManageNotes ? (
                <CardActionRow>
                  <CardIconButton
                    Icon={PlusIcon}
                    label="Write a note"
                    onPress={() => {
                      setEditing(null);
                      setNoteError(null);
                      setEditorOpen(true);
                    }}
                  />
                </CardActionRow>
              ) : undefined
            }
          >
            {noteNotice ? <Text style={styles.revert}>{noteNotice}</Text> : null}

            {notes === null ? (
              <CardEmpty text="Loading…" />
            ) : notes.length === 0 ? (
              <CardEmpty text="No notes yet." />
            ) : (
              notes.map((note, i) => {
                const mine = canModifyNote(note, session?.profile ?? null);
                return (
                  <View key={note.id} style={i > 0 ? styles.noteFollowing : undefined}>
                    <View style={styles.noteHead}>
                      <Text style={styles.noteAuthor}>
                        {(note.author?.name ?? note.author?.email ?? 'Studio').toUpperCase()}
                      </Text>
                      {/* The share state is visible on the note itself —
                          whether an artist can see it is the single most
                          consequential thing about a note. */}
                      {note.visibleToArtist ? <Text style={styles.shared}>SHARED WITH ARTIST</Text> : null}
                      {canManageNotes && mine ? (
                        <View style={styles.noteActions}>
                          <CardIconButton
                            Icon={PersonIcon}
                            label="Edit this note"
                            onPress={() => {
                              setEditing(note);
                              setNoteError(null);
                              setEditorOpen(true);
                            }}
                          />
                          <CardIconButton
                            Icon={TrashIcon}
                            label="Delete this note"
                            tone="danger"
                            onPress={() => void onDeleteNote(note)}
                          />
                        </View>
                      ) : null}
                    </View>
                    <NoteBody html={note.bodyHtml} />
                    {/* Below the body, matching web's own order. No
                        remove control here — a posted note's attachments
                        change through the editor, so the chip is a link. */}
                    {note.attachments && note.attachments.length > 0 ? (
                      <View style={styles.noteAttachments}>
                        {note.attachments.map((attachment, i) => (
                          <AttachmentChip key={`${attachment.url}-${i}`} attachment={attachment} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </CollapsibleSection>

          <ConsultationSheet
            visible={consultOpen}
            onClose={() => setConsultOpen(false)}
            token={token!}
            clientName={clientLabel}
            draft={consultDraft}
            onDraftChange={setConsultDraft}
            booking={booking}
            error={bookError}
            onBook={onBookConsultation}
          />

          {estimateDraft ? (
            <EstimateSheet
              visible={estimateOpen}
              onClose={() => {
                setEstimateOpen(false);
                setEstimateDraft(null);
              }}
              clientName={clientLabel}
              draft={estimateDraft}
              onDraftChange={setEstimateDraft}
              sending={sendingEstimate}
              error={estimateError}
              onSend={onSendEstimate}
            />
          ) : null}

          <NoteEditor
            visible={editorOpen}
            onClose={() => {
              setEditorOpen(false);
              setEditing(null);
            }}
            initialHtml={editing?.bodyHtml ?? ''}
            initialVisibleToArtist={editing?.visibleToArtist ?? false}
            initialAttachments={editing?.attachments ?? []}
            token={token!}
            canAttach={canAttachToNote}
            saving={savingNote}
            error={noteError}
            onSave={onSaveNote}
          />

          <Banner
            icon="info"
            align="top"
            text="Assigning, sending estimates and deposit forms, scheduling and closing are done in the portal. This screen shows the inquiry; it doesn't change it."
          />
        </ScrollView>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  /* The client page's scaffold: `space.xl` between cards, not `space.lg`.
     A card carries 24 of its own padding, so 16 between them read as
     cramped next to the client page's 24. */
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  headerTop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', marginBottom: space.md },
  headerText: { flex: 1, gap: 2 },
  headerInitials: { ...type.label, fontSize: 14, color: colors.fgMuted },
  headerName: { ...type.heading, color: colors.fg },
  headerContact: { ...type.meta, color: colors.fgMuted },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },

  stage: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  stageLabel: { ...type.body, color: colors.fgMuted },
  stageDone: { color: colors.fg },
  // Web draws the current step in red. Here it is gold: red is
  // punctuation in this design system (CLAUDE.md), reserved for errors
  // and destructive actions, and "the next ordinary step" is neither.
  // Divergence logged rather than silently copied.
  stageCurrent: { color: colors.accent },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm + 2,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  /* A trailing hairline under a card's last row is a stray line — the
     client page's rule, and now `Fact`'s `last` prop does the same job
     for the rows next to these. */
  lineLast: { borderBottomWidth: 0 },
  lineText: { flex: 1 },
  lineTitle: { ...type.body, color: colors.fg },
  lineMeta: { ...type.meta, color: colors.fgMuted, marginTop: 2 },

  revert: { ...type.small, color: colors.danger, paddingTop: space.sm },
  noteAttachments: { gap: space.xs, alignItems: 'flex-start', paddingTop: space.sm },
  /* Accent, not danger: a buffer breach is information the studio asked
     to be told, not a failure. */
  bufferWarning: { ...type.small, color: colors.accent, paddingBottom: space.sm },

  noteFollowing: { marginTop: space.lg },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  noteAuthor: { ...type.meta, color: colors.fgMuted },
  shared: { ...type.label, fontSize: 9, color: colors.accent },
  noteActions: { flexDirection: 'row', gap: space.xs, marginLeft: 'auto' },
  pressed: { opacity: 0.6 },
});

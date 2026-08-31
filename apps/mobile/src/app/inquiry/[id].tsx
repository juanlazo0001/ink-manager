import type { ArtistInquiryDetail } from '@ink-manager/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { Banner } from '@/components/Banner';
import { Card, Fact } from '@/components/editorial';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { NoteBody } from '@/components/NoteBody';
import { InquiryRespondSheet, type RespondMode } from '@/components/InquiryRespondSheet';
import { PhotoStrip, PhotoViewer } from '@/components/PhotoViewer';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenShell } from '@/components/ScreenShell';
import { InquiryStatusChip } from '@/components/StatusChip';
import { GoldButton, QuietButton, ScreenLoading, StateMessage } from '@/components/ui';
import { ArrowUpRightIcon } from '@/components/icons';
import { useAuth } from '@/context/auth';
import { ApiError } from '@/lib/api';
import { fetchArtistInquiry, respondToInquiry } from '@/lib/inquiries';
import {
  channelLabel,
  formatEstimateRange,
  inquiryClientName,
  isClosedStatus,
  statusLabel,
} from '@/lib/inquiryDisplay';
import { formatHourRange, inquiryImages, inquiryVisibility } from '@/lib/inquiryVisibility';
import { screenErrorMessage } from '@/lib/screenError';
import { relativeStamp } from '@/lib/time';
import { colors, hairline, space, type } from '@/theme';

/**
 * The 403 this route can return is a KNOWN, documented state, not a
 * generic failure: the list is scoped by the caller's home studio while
 * this route checks the inquiry's own (PARITY-AUDIT.md, Finding B). Web
 * currently renders "Loading project..." forever when it happens. This
 * screen says what is true and offers the way back.
 */
function detailErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.fromApi && err.status === 403) {
    return "This project is at another studio, and that studio hasn't given you access to its inquiries.";
  }
  if (err instanceof ApiError && err.fromApi && err.status === 404) {
    return 'This project is not assigned to you, or no longer exists.';
  }
  return screenErrorMessage(err, 'this project');
}

/**
 * ─── BUILT FROM THE CLIENT PAGE'S COMPONENTS ────────────────────────
 *
 * Not from web, and not from a vocabulary of its own. This screen used to
 * render `DetailSection` + `DetailField`: a bordered box titled with an
 * EYEBROW (11px letterspaced caps, red ticks) over stacked
 * label-above-value rows. The client page renders `Card` +
 * `CollapsibleSection` + `Fact`: a translucent card carrying a top
 * highlight, titled with a 20px sentence-case `SectionHeader`, over
 * label/value rows set on one line.
 *
 * Those are two different design systems, two screens apart in one app.
 * The surfaces did not even agree — `DetailSection`'s box has no gradient
 * highlight and pads 16/4, `Card` pads 24 and has one — so a project
 * opened from a client read as a different product than the client it was
 * opened from.
 *
 * Every component here is now the client page's own, imported rather than
 * reimplemented. Where this screen needed something the client page
 * lacked, the SHARED component grew a prop — `Banner`'s `align` and
 * `tone`, `Fact`'s `multiline` and its null handling, `PhotoStrip`'s
 * `inset` — instead of a local copy being written next to it. That is the
 * rule that keeps the two from drifting again: there is only one of each
 * of these now, and it lives outside both screens.
 */
export default function InquiryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const permissions = useMemo(() => session?.profile.permissions ?? [], [session?.profile.permissions]);

  const [inquiry, setInquiry] = useState<ArtistInquiryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [respondMode, setRespondMode] = useState<RespondMode | null>(null);
  const [responding, setResponding] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);
  const requestRef = useRef(0);

  /*
   * Every section starts OPEN.
   *
   * The client page starts three of its nine open, because it has nine
   * and a client's history is something you browse. This screen has at
   * most five and an artist opens it to READ THE BRIEF — collapsing them
   * by default would put the whole point of the screen behind five taps.
   *
   * Adopting a component does not mean adopting the other screen's
   * defaults. It means the section behaves identically once touched.
   */
  const [open, setOpen] = useState<Record<string, boolean>>({
    photos: true,
    work: true,
    estimate: true,
    planned: true,
    booked: true,
    notes: true,
  });
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!token || !id) return;
      const seq = ++requestRef.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const next = await fetchArtistInquiry(token, id);
        if (seq !== requestRef.current) return;
        setInquiry(next);
        setError(null);
      } catch (err) {
        if (seq !== requestRef.current) return;
        setError(detailErrorMessage(err));
      } finally {
        if (seq === requestRef.current && mode === 'refresh') setRefreshing(false);
      }
    },
    [token, id],
  );

  useEffect(() => {
    load('initial');
  }, [load]);
  useEffect(() => () => void ++requestRef.current, []);

  const visibility = useMemo(() => inquiryVisibility({ permissions, inquiry }), [permissions, inquiry]);
  const images = useMemo(
    () =>
      inquiry
        ? inquiryImages(inquiry).map((i) => ({
            url: i.url,
            caption: i.kind === 'reference' ? 'Reference' : 'Placement photo',
          }))
        : [],
    [inquiry],
  );

  const onDecline = useCallback(
    async (note: string) => {
      if (!token || !id || !inquiry) return;
      setResponding(true);
      setRespondError(null);
      try {
        // Declining does NOT close the inquiry -- the API sets it back to
        // NEW and clears assignedArtistId. So it stops being this
        // artist's project entirely rather than becoming a closed one,
        // and there is nothing left on this screen to show. Confirmed
        // against the route, not assumed: an earlier version of this
        // optimistically set CLOSED_LOST, which would have been a lie.
        await respondToInquiry(token, id, { decision: 'DECLINE', declineNote: note });
        setRespondMode(null);
        // The list refetches on focus, so it comes back without this row.
        router.back();
      } catch (err) {
        // Nothing to revert -- the optimistic step here is navigation,
        // and it only happens after the call succeeds. Staying put with a
        // readable error beats a screen that moved and then bounced back.
        setRespondError(screenErrorMessage(err, 'this project'));
      } finally {
        setResponding(false);
      }
    },
    [token, id, router],
  );

  if (!inquiry) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Project" onBack={() => router.back()} right={<View style={styles.headerSpacer} />} />
        {error ? (
          <View style={styles.centre}>
            <StateMessage
              eyebrow="Not available"
              tone="alert"
              title={error}
              body="Nothing is wrong with your account — this is about where the project lives."
              action={{ label: 'Back to inquiries', onPress: () => router.back() }}
            />
          </View>
        ) : (
          <ScreenLoading />
        )}
      </ScreenShell>
    );
  }

  const dimmed = isClosedStatus(inquiry.status);
  const name = inquiryClientName(inquiry.client);
  const estimate = visibility.canSeePricing
    ? formatEstimateRange(inquiry.priceEstimateLow ?? null, inquiry.priceEstimateHigh ?? null)
    : null;
  const timeEstimate = visibility.canSeePricing
    ? formatHourRange(inquiry.timeEstimateHoursMin, inquiry.timeEstimateHoursMax)
    : null;
  const notes = visibility.canSeeNotes ? (inquiry.notes ?? []) : [];

  return (
    <ScreenShell edges={['top']}>
      {/*
        BARE, no title — the client page's own header. The name is the
        first thing in the hero card at full size, and repeating it in the
        nav row says the same thing twice in two type sizes. That is the
        client page's recorded reasoning, and it applies here unchanged.
      */}
      <ScreenHeader onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {/*
          The hero: the client page's anatomy, with ONE MEASURED
          DIVERGENCE.

          On the client page the top-right slot across from the avatar
          holds the client CODE — six or so characters, about 60pt. The
          obvious port puts the status chip there, and it was there until
          it was measured at 393: the chip is 88pt wide, which left the
          name column 114pt, and "Sebastian Oyelaran-Whitmore" wrapped to
          two lines and STILL truncated to "Oyelaran-...".

          The slot is sized for a short identifier and a status chip is
          not one — `InquiryStatus` has 15 values and the longest set
          wider than the code ever gets. So the chip takes its own row
          beneath the identity block, where it is full-width-safe at any
          status and at 320pt, and the name gets the whole column back.
        */}
        <Card style={dimmed ? styles.dimmed : undefined}>
          <View style={styles.headerTop}>
            <Avatar url={null} initials={initialsOf(name)} size={44} labelStyle={styles.headerInitials} />
            <View style={styles.headerText}>
              <Text style={styles.headerName} numberOfLines={2}>
                {name}
              </Text>
              <Text style={styles.headerContact} numberOfLines={1}>
                {channelLabel(inquiry.channel)} · {relativeStamp(inquiry.createdAt)}
              </Text>
            </View>
          </View>

          <View style={styles.statusRow}>
            <InquiryStatusChip status={inquiry.status} />
          </View>

          <Text style={styles.description}>{inquiry.description}</Text>
        </Card>

        {inquiry.fromGuestStudio ? (
          <Banner
            icon="map-pin"
            tone="accent"
            text={`At ${inquiry.fromGuestStudio.name} — you are a guest here`}
          />
        ) : null}

        {images.length > 0 ? (
          <CollapsibleSection
            title={images.length === 1 ? 'Photo' : `Photos (${images.length})`}
            open={!!open.photos}
            onToggle={() => toggle('photos')}
          >
            {/* inset 0 — the card already pads 24 on each side. */}
            <PhotoStrip images={images} onPress={setViewerIndex} inset={0} />
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection title="The work" open={!!open.work} onToggle={() => toggle('work')}>
          <Fact label="Placement" value={inquiry.placement} />
          <Fact label="Size" value={inquiry.estimatedSize} />
          <Fact label="Colour or black & grey" value={inquiry.colorOrBlackGrey} />
          <Fact label="Timing wanted" value={inquiry.desiredTiming} />
          <Fact
            label="Tattooed before"
            value={inquiry.hasBeenTattooedBefore == null ? null : inquiry.hasBeenTattooedBefore ? 'Yes' : 'No'}
            last
          />
        </CollapsibleSection>

        {/* Pricing is a whole section the studio can switch off. Saying so
            beats rendering dashes, which would read as "no estimate". */}
        <CollapsibleSection title="Estimate" open={!!open.estimate} onToggle={() => toggle('estimate')}>
          {visibility.canSeePricing ? (
            <>
              <Fact label="Client budget" value={inquiry.budget ?? null} />
              <Fact label="Estimate" value={estimate} />
              <Fact label="Time" value={timeEstimate} last={!inquiry.service} />
              {inquiry.service ? (
                <Fact label="Service" value={`${inquiry.service.name} · ${inquiry.service.pricingModel}`} last />
              ) : null}
            </>
          ) : (
            <Fact label="Hidden" value="Your studio doesn't show pricing detail to artists." multiline last />
          )}
        </CollapsibleSection>

        {inquiry.plannedSessions.length > 0 ? (
          <CollapsibleSection title="Session plan" open={!!open.planned} onToggle={() => toggle('planned')}>
            {inquiry.plannedSessions.map((planned, i) => (
              <Fact
                key={planned.id}
                label={`Session ${planned.sessionNumber}`}
                value={
                  [
                    formatHourRange(planned.estimatedHoursMin, planned.estimatedHoursMax),
                    visibility.canSeePricing
                      ? formatEstimateRange(planned.estimatedPriceLow, planned.estimatedPriceHigh)
                      : null,
                    planned.depositForm?.paidAt
                      ? 'deposit paid'
                      : planned.depositForm?.signedAt
                        ? 'deposit signed'
                        : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || null
                }
                last={i === inquiry.plannedSessions.length - 1}
              />
            ))}
          </CollapsibleSection>
        ) : null}

        {inquiry.sessions.length > 0 ? (
          <CollapsibleSection
            title={inquiry.sessions.length === 1 ? 'Booked session' : 'Booked sessions'}
            open={!!open.booked}
            onToggle={() => toggle('booked')}
          >
            {inquiry.sessions.map((s, i) => (
              <Fact
                key={s.id}
                label={new Date(s.startTime).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                value={[statusLabel(s.status), s.checkedOutAt ? 'checked out' : null].filter(Boolean).join(' · ')}
                last={i === inquiry.sessions.length - 1}
              />
            ))}
          </CollapsibleSection>
        ) : null}

        {notes.length > 0 ? (
          <CollapsibleSection title="Notes from the studio" open={!!open.notes} onToggle={() => toggle('notes')}>
            {/*
              RENDERED now, not stripped.

              This used to be `bodyHtml.replace(/<[^>]*>/g, '')` with a
              comment explaining that mobile had no sanitiser — which was
              true and was the right call while mobile could only read
              notes. `NoteBody` parses the stored HTML into data and
              renders native primitives from it, so no markup is ever
              interpreted and no sanitiser is required; see its own note.
            */}
            {notes.map((note, i) => (
              <View key={note.id} style={i > 0 ? styles.noteFollowing : undefined}>
                <Text style={styles.noteAuthor}>
                  {(note.author?.name ?? note.author?.email ?? 'Studio').toUpperCase()}
                </Text>
                <NoteBody html={note.bodyHtml} />
              </View>
            ))}
          </CollapsibleSection>
        ) : null}

        {/* The deep flows. Named, so an artist knows they exist and where
            they live, rather than silently absent. */}
        <Banner
          Icon={ArrowUpRightIcon}
          align="top"
          text="Scheduling, deposits and the full estimate builder live in the portal — this screen shows them, it doesn't change them."
        />

        <Text style={styles.footerText}>
          Opened {relativeStamp(inquiry.createdAt)} · updated {relativeStamp(inquiry.updatedAt)}
        </Text>
      </ScrollView>

      {/* The artist's own decision. Present only while the project is
          genuinely awaiting them and they hold the permission. */}
      {visibility.canRespond ? (
        <View style={styles.actions}>
          <QuietButton label="Decline" onPress={() => setRespondMode('decline')} style={styles.declineButton} />
          <GoldButton label="Approve" onPress={() => setRespondMode('approve')} style={styles.approveButton} />
        </View>
      ) : null}

      <InquiryRespondSheet
        mode={respondMode}
        onClose={() => {
          setRespondMode(null);
          setRespondError(null);
        }}
        onDecline={onDecline}
        submitting={responding}
        error={respondError}
        approveSendsToClient={visibility.approveSendsToClient}
        clientName={name}
      />

      <PhotoViewer
        images={images}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  headerSpacer: { width: 36 },
  centre: { flex: 1, justifyContent: 'center' },

  /*
   * The client page's page scaffold, value for value. The padding is on
   * the SCROLL CONTENT and the gap between cards is what separates
   * sections. The old screen put `paddingHorizontal` on each section
   * individually and `paddingTop` on each — which is why its sections and
   * the client page's never lined up, and why the spacing between them
   * drifted section by section.
   */
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },

  headerTop: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', marginBottom: space.md },
  headerText: { flex: 1, gap: 2 },
  headerInitials: { ...type.label, fontSize: 14, color: colors.fgMuted },
  headerName: { ...type.heading, color: colors.fg },
  headerContact: { ...type.meta, color: colors.fgMuted },
  /* `flex-start` so the chip is its own width, not the card's. */
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },

  /*
   * The brief itself. It stays heavier than body copy — it is the reason
   * the screen exists — but it came DOWN from 22/28. At 22 inside the
   * hero card it outweighed the client's own name directly above it,
   * which `type.heading` sets at 20, so the card led with the tattoo
   * description rather than with whose it is.
   */
  description: { ...type.body, fontSize: 17, lineHeight: 24, color: colors.fg },

  dimmed: { opacity: 0.55 },

  footerText: { ...type.meta, color: colors.fgMuted },

  /* The author line keeps `Fact`'s label treatment so a note still reads
     as one of this card's rows, but the body below it is no longer a
     Fact's single value — it is blocks. */
  noteAuthor: { ...type.meta, color: colors.fgMuted, marginBottom: space.xs },
  noteFollowing: { marginTop: space.md },

  actions: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceInset,
  },
  declineButton: { flex: 1 },
  approveButton: { flex: 1 },
});

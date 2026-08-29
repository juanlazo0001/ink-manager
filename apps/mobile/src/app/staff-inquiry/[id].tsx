import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
import { channelLabel } from '@/lib/inquiryDisplay';
import { screenErrorMessage } from '@/lib/screenError';
import {
  artistName,
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
export default function StaffInquiryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [inquiry, setInquiry] = useState<StaffInquiryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Nine sections would be a lot to scroll past; these are seven and the
     top three are the ones an owner opens this screen for. The rest stay
     one tap away, which is the client page's own balance. */
  const [open, setOpen] = useState<Record<string, boolean>>({
    pipeline: true,
    assignment: true,
    estimate: true,
  });
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

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

          <CollapsibleSection title="Assignment" open={!!open.assignment} onToggle={() => toggle('assignment')}>
            <Fact label="Artist" value={artistName(inquiry) ?? 'Unassigned'} last={!inquiry.assignedAt} />
            {inquiry.assignedAt ? <Fact label="Assigned" value={stamp(inquiry.assignedAt)} last /> : null}
          </CollapsibleSection>

          <CollapsibleSection title="Estimate" open={!!open.estimate} onToggle={() => toggle('estimate')}>
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
          >
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

  pressed: { opacity: 0.6 },
});

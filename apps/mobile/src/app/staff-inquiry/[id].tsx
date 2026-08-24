import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Eyebrow, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { formatMoney } from '@/lib/giftCards';
import { screenErrorMessage } from '@/lib/screenError';
import {
  artistName,
  fetchStaffInquiryDetail,
  pipelineStages,
  type StaffInquiryDetail,
} from '@/lib/staffInquiry';
import { colors, hairline, radius, space, type } from '@/theme';

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
 */
export default function StaffInquiryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [inquiry, setInquiry] = useState<StaffInquiryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title={clientLabel} onBack={() => router.back()} />

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
          <View style={styles.statusRow}>
            <View style={styles.statusPill}>
              <Text style={styles.statusLabel}>
                {inquiry.status.replace(/_/g, ' ').toUpperCase()}
              </Text>
            </View>
            {inquiry.channel ? <Text style={styles.channel}>{inquiry.channel}</Text> : null}
          </View>

          <Section title="Pipeline">
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
          </Section>

          <Section title="Assignment">
            <Fact label="Artist" value={artistName(inquiry) ?? 'Unassigned'} />
            {inquiry.assignedAt ? <Fact label="Assigned" value={stamp(inquiry.assignedAt)} /> : null}
          </Section>

          <Section title="Estimate">
            {inquiry.priceEstimateLow != null && inquiry.priceEstimateHigh != null ? (
              <Fact
                label="Price"
                value={`$${inquiry.priceEstimateLow} – $${inquiry.priceEstimateHigh}`}
              />
            ) : (
              <Empty text="No estimate entered." />
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
              <Fact label="Revision reason" value={inquiry.estimateRevisionReason} />
            ) : null}
          </Section>

          <Section title={`Deposits (${inquiry.depositForms.length})`}>
            {inquiry.depositForms.length === 0 ? (
              <Empty text="No deposit form sent." />
            ) : (
              inquiry.depositForms.map((d) => (
                <View key={d.id} style={styles.line}>
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
          </Section>

          <Section title="Appointment">
            {inquiry.appointmentId ? (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/appointment/[id]', params: { id: inquiry.appointmentId! } })
                }
                accessibilityRole="button"
                style={({ pressed }) => [styles.line, pressed && styles.pressed]}
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
              <Empty text="No appointment booked yet." />
            )}
          </Section>

          <Section title="The request">
            {inquiry.description ? <Fact label="Wants" value={inquiry.description} /> : null}
            {inquiry.placement ? <Fact label="Placement" value={inquiry.placement} /> : null}
            {inquiry.estimatedSize ? <Fact label="Size" value={inquiry.estimatedSize} /> : null}
            {inquiry.colorOrBlackGrey ? (
              <Fact label="Colour" value={inquiry.colorOrBlackGrey} />
            ) : null}
            {inquiry.desiredTiming ? <Fact label="Timing" value={inquiry.desiredTiming} /> : null}
            {inquiry.clientStatedBudget || inquiry.budget ? (
              <Fact label="Client budget" value={(inquiry.clientStatedBudget ?? inquiry.budget)!} />
            ) : null}
            {inquiry.hasBeenTattooedBefore != null ? (
              <Fact label="Tattooed before" value={inquiry.hasBeenTattooedBefore ? 'Yes' : 'No'} />
            ) : null}
          </Section>

          {inquiry.closedReason || inquiry.declineNote || inquiry.archivedAt ? (
            <Section title="Closed">
              {inquiry.closedReason ? <Fact label="Reason" value={inquiry.closedReason} /> : null}
              {inquiry.declineNote ? <Fact label="Note" value={inquiry.declineNote} /> : null}
              {inquiry.archivedAt ? <Fact label="Archived" value={stamp(inquiry.archivedAt)} /> : null}
            </Section>
          ) : null}

          <View style={styles.note}>
            <Feather name="info" size={13} color={colors.fgMuted} />
            <Text style={styles.noteText}>
              Assigning, sending estimates and deposit forms, scheduling and closing are done in the
              portal. This screen shows the inquiry; it doesn&apos;t change it.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
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
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

/**
 * A real instant, shown in the viewer's own zone. Deliberately NOT forced
 * to UTC: unlike a gift card's `expiresAt`, these are moments (an
 * estimate went out, a deposit was paid), and CLAUDE.md's rule is that
 * the two conventions must not be mixed.
 */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusPill: {
    borderWidth: hairline,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  statusLabel: { ...type.meta, color: colors.accent },
  channel: { ...type.meta, color: colors.fgMuted },

  section: { gap: space.sm },
  sectionBody: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: space.lg,
  },

  stage: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  stageLabel: { ...type.body, color: colors.fgMuted },
  stageDone: { color: colors.fg },
  // Web draws the current step in red. Here it is gold: red is
  // punctuation in this design system (CLAUDE.md), reserved for errors
  // and destructive actions, and "the next ordinary step" is neither.
  // Divergence logged rather than silently copied.
  stageCurrent: { color: colors.accent },

  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  factLabel: { ...type.meta, color: colors.fgMuted, flexShrink: 0 },
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

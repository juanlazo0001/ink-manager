import type { InquiryStatus } from '@ink-manager/shared-types';

/**
 * Status presentation, mirroring `apps/web/src/components/StatusPill.tsx`
 * so the same inquiry reads the same on both clients.
 *
 * Tones carry meaning, not colour: `warning` is "someone needs to act",
 * `success` is "moving", `danger` is reserved for a genuinely lost
 * inquiry, and `hold`/`neutral` are the two flavours of paused. Web's own
 * comments are explicit that red is punctuation here — CLOSED_LOST is a
 * deliberate staff action, while COLD_LEAD (the automated sweep's quieter
 * outcome) stays grey rather than reusing it.
 */
export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'progress' | 'highlight' | 'hold';

const STATUS_TONES: Record<string, StatusTone> = {
  CANDIDACY_REVIEW: 'warning',
  NEW: 'info',
  ARTIST_ASSIGNED: 'progress',
  AWAITING_CLIENT_RESPONSE: 'warning',
  BUDGET_NEGOTIATION: 'warning',
  DEPOSIT_PENDING: 'highlight',
  SCHEDULING: 'success',
  WAITLISTED: 'success',
  CONFIRMED: 'success',
  CLOSED_LOST: 'danger',
  COLD_LEAD: 'neutral',
};

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status] ?? 'neutral';
}

const STATUS_LABELS: Record<string, string> = {
  CANDIDACY_REVIEW: 'Candidacy review',
  NEW: 'New',
  ARTIST_ASSIGNED: 'Artist assigned',
  AWAITING_CLIENT_RESPONSE: 'Awaiting client',
  BUDGET_NEGOTIATION: 'Budget',
  DEPOSIT_PENDING: 'Deposit pending',
  SCHEDULING: 'Scheduling',
  WAITLISTED: 'Waitlisted',
  CONFIRMED: 'Confirmed',
  CLOSED_LOST: 'Closed lost',
  COLD_LEAD: 'Cold lead',
};

/**
 * Unknown statuses de-snake rather than disappearing — a value added
 * server-side should show as itself, not vanish from mobile until someone
 * updates this map.
 */
export function statusLabel(status: string): string {
  return (
    STATUS_LABELS[status] ??
    status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/** Closed inquiries recede in a list — they are history, not pipeline. */
export function isClosedStatus(status: InquiryStatus | string): boolean {
  return status === 'CLOSED_LOST' || status === 'COLD_LEAD';
}

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  WALK_IN: 'Walk-in',
  PHONE: 'Phone',
  WEBSITE: 'Website',
  OTHER: 'Other',
};

export function channelLabel(channel: string): string {
  return (
    CHANNEL_LABELS[channel] ??
    channel
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/** One line of client name, falling back rather than rendering blank. */
export function inquiryClientName(client: { firstName: string; lastName: string } | null): string {
  if (!client) return 'No client';
  const name = `${client.firstName} ${client.lastName}`.trim();
  return name || 'No client';
}

/** `$400 – $600`, `From $400`, `Up to $600`, or null. Same rules as the appointment screen. */
export function formatEstimateRange(low: number | null, high: number | null): string | null {
  const fmt = (v: number) => `$${v.toLocaleString()}`;
  if (low != null && high != null) return low === high ? fmt(low) : `${fmt(low)} – ${fmt(high)}`;
  if (low != null) return `From ${fmt(low)}`;
  if (high != null) return `Up to ${fmt(high)}`;
  return null;
}

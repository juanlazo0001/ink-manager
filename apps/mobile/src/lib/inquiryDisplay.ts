import { InquiryStatus } from '@ink-manager/shared-types';

/**
 * Status presentation, mirroring `apps/web/src/components/StatusPill.tsx`
 * and `apps/web/src/lib/format.ts` so the same inquiry reads the same on
 * both clients.
 *
 * Tones carry meaning, not colour: `warning` is "someone needs to act",
 * `success` is "moving", `danger` is reserved for a genuinely lost
 * inquiry, `hold` is paused, `neutral` is out of the pipeline. Web's own
 * comments are explicit that red is punctuation here — CLOSED_LOST is a
 * deliberate staff action, while COLD_LEAD (the automated sweep's quieter
 * outcome) and TRANSFERRED both stay neutral rather than reusing it.
 */
export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'progress' | 'highlight' | 'hold';

/**
 * Every value of the generated `InquiryStatus`, keyed off the enum itself
 * rather than string literals — so adding a status to schema.prisma turns
 * this into a compile error rather than a silent `neutral`.
 *
 * Values copied from web's own `STATUS_TONE`. TRANSFERRED has no entry
 * there and therefore takes web's `?? 'neutral'` fallback; it is written
 * out explicitly here so the intent is visible rather than incidental.
 */
const STATUS_TONES: Record<InquiryStatus, StatusTone> = {
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
  TRANSFERRED: 'neutral',
  FLASH_PENDING_APPROVAL: 'warning',
  FLASH_PAYMENT_PENDING: 'warning',
  ON_HOLD: 'hold',
};

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status as InquiryStatus] ?? 'neutral';
}

/**
 * Web's `formatStatus` exactly: lowercase, split on underscores,
 * title-case each word.
 *
 * Derived rather than a lookup table on purpose. A label map is a second
 * place to drift from the enum — which is the whole reason this file is
 * being rewritten. `FLASH_PAYMENT_PENDING` becomes "Flash Payment
 * Pending" without anyone maintaining an entry for it.
 */
export function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Web's "Inactive" column: terminal, out-of-pipeline statuses.
 *
 * TRANSFERRED belongs here — web's own comment calls it "the same
 * terminal, out-of-pipeline treatment as CLOSED_LOST/COLD_LEAD …
 * regardless of whether the inquiry was still a lead or already a
 * converted project when it transferred". Mobile omitted it before this
 * session, which left transferred inquiries sitting in the OPEN segment.
 *
 * ON_HOLD is deliberately NOT here: it is paused, not finished, and web
 * keeps it on the Projects board rather than in Inactive.
 */
const INACTIVE_STATUSES: InquiryStatus[] = [
  InquiryStatus.CLOSED_LOST,
  InquiryStatus.COLD_LEAD,
  InquiryStatus.TRANSFERRED,
];

export function isClosedStatus(status: InquiryStatus | string): boolean {
  return (INACTIVE_STATUSES as string[]).includes(status);
}

/** The two flash-sourced lead statuses, which web groups into their own column. */
export function isFlashRequestStatus(status: InquiryStatus | string): boolean {
  return status === InquiryStatus.FLASH_PENDING_APPROVAL || status === InquiryStatus.FLASH_PAYMENT_PENDING;
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
  return CHANNEL_LABELS[channel] ?? statusLabel(channel);
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

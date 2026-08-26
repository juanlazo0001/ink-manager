import { FlashPieceStatus, type FlashPiece } from '@ink-manager/shared-types';

import { tones } from '@/theme';

/**
 * How a flash piece reads on screen. Pure — no React, no fetch.
 *
 * `STATUS_TONES` and `STATUS_LABELS` are typed `Record<FlashPieceStatus, …>`
 * deliberately: a new value added to the Prisma enum becomes a compile
 * error here rather than an unlabelled grey pill on someone's phone. That
 * is the same guard that would have caught `InquiryStatus` shipping with
 * 11 of its 15 values (PARITY-AUDIT.md, Finding A).
 */

export type StatusTone = keyof typeof tones;

/**
 * Mapped from web's own `STATUS_TONE` classes. `PENDING_APPROVAL` is
 * amber because it means someone has to act; `RETIRED` is neutral because
 * nothing is wrong with it. Nothing here is red — none of these four
 * states is an error, and red is punctuation.
 */
export const STATUS_TONES: Record<FlashPieceStatus, StatusTone> = {
  [FlashPieceStatus.AVAILABLE]: 'success',
  [FlashPieceStatus.PENDING_APPROVAL]: 'warning',
  [FlashPieceStatus.BOOKED]: 'highlight',
  [FlashPieceStatus.RETIRED]: 'neutral',
};

/** Verbatim from web's `STATUS_LABEL`. */
export const STATUS_LABELS: Record<FlashPieceStatus, string> = {
  [FlashPieceStatus.AVAILABLE]: 'Available',
  [FlashPieceStatus.PENDING_APPROVAL]: 'Pending approval',
  [FlashPieceStatus.BOOKED]: 'Booked',
  [FlashPieceStatus.RETIRED]: 'Retired',
};

/** The filter's options, in the enum's own order. */
export const STATUS_FILTERS = [
  FlashPieceStatus.AVAILABLE,
  FlashPieceStatus.PENDING_APPROVAL,
  FlashPieceStatus.BOOKED,
  FlashPieceStatus.RETIRED,
] as const;

/**
 * Retiring is one-way and reachable only from AVAILABLE — a piece already
 * PENDING_APPROVAL or BOOKED has a live request that must be resolved
 * first, not pulled out from under the client waiting on it. The API
 * enforces this with a 400; showing the action anyway would be offering
 * something guaranteed to fail.
 */
export function canRetire(piece: Pick<FlashPiece, 'status'>): boolean {
  return piece.status === FlashPieceStatus.AVAILABLE;
}

/** `$180.00`. Always two decimals — this is a price a client will pay. */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * `90m`, `2h`, `2h 30m`. Minutes are what the API stores; hours are what
 * an artist thinks in, so anything under an hour stays in minutes and
 * anything over is spoken as hours.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Minutes → the hours string the editor shows. Matches web's rounding. */
export function minutesToHours(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100);
}

export function hoursToMinutes(value: string): number | null {
  const n = Number(value);
  if (!value.trim() || Number.isNaN(n)) return null;
  return Math.round(n * 60);
}

/**
 * Applies both filters. An empty selection means "everything" — web's own
 * rule, and the reason its trigger reads "All statuses" until you pick
 * something:
 *
 *     (statusFilter.length === 0 || statusFilter.includes(piece.status)) &&
 *     (artistFilter.length === 0 || artistFilter.includes(piece.artist.id))
 *
 * The two are ANDed, so picking two statuses and one artist means "either
 * of those statuses, by that artist".
 */
export function filterPieces(
  pieces: FlashPiece[],
  statuses: FlashPieceStatus[],
  artistIds: string[] = [],
): FlashPiece[] {
  if (statuses.length === 0 && artistIds.length === 0) return pieces;
  return pieces.filter(
    (piece) =>
      (statuses.length === 0 || statuses.includes(piece.status)) &&
      (artistIds.length === 0 || artistIds.includes(piece.artist.id)),
  );
}

/** `2 available · 1 booked` — the line under the gallery title. */
export function summarize(pieces: FlashPiece[]): string {
  if (pieces.length === 0) return 'No pieces yet.';
  const counts = new Map<FlashPieceStatus, number>();
  for (const piece of pieces) counts.set(piece.status, (counts.get(piece.status) ?? 0) + 1);
  return STATUS_FILTERS.filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${STATUS_LABELS[status].toLowerCase()}`)
    .join(' · ');
}

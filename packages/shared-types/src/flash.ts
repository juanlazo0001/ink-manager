import type { FlashPieceStatus } from './enums';

/**
 * A flash piece, as `GET /flash-pieces` returns it.
 *
 * The list route needs no `artistId` parameter from an ARTIST caller: it
 * resolves the caller's own artist id server-side and narrows to it,
 * across their HOME studio AND every studio they currently guest at.
 * A client that passed `artistId` would be ignored, and one that filtered
 * client-side would be second-guessing a decision already made correctly.
 */
export interface FlashPiece {
  id: string;
  imageUrl: string;
  title: string;
  description: string | null;
  priceCents: number;
  estimatedDurationMinutes: number;
  /**
   * A one-of-one leaves the gallery once it is booked; a repeatable piece
   * stays available permanently. It is the difference between selling a
   * drawing and selling the right to wear it.
   */
  isOneOfOne: boolean;
  status: FlashPieceStatus;
  artist: { id: string; user: { name: string | null; email: string; avatarUrl: string | null } };
  /**
   * Keyed by locale (`{ es: { title, description } }`), and absent
   * entirely on a piece that has never been translated.
   *
   * A write that OMITS this key leaves existing translations untouched —
   * the API only upserts the locales it is sent. A client that cannot
   * edit translations must therefore omit the key rather than send an
   * empty object, or it would be deciding to erase work it never showed.
   */
  translations?: Record<string, { title: string | null; description: string | null }>;
}

/**
 * The body `POST /flash-pieces` and `PATCH /flash-pieces/:id` accept.
 *
 * `artistId` is omitted by an ARTIST caller — the API resolves "for
 * myself" and rejects anything else. On PATCH every field is optional and
 * only what is sent is written.
 *
 * `priceCents` and `estimatedDurationMinutes` must both be positive; the
 * API rejects zero and negatives with a 400, so a piece has no way to be
 * free or instantaneous.
 */
export interface FlashPieceInput {
  imageUrl?: string;
  title?: string;
  description?: string | null;
  priceCents?: number;
  estimatedDurationMinutes?: number;
  isOneOfOne?: boolean;
  artistId?: string;
}

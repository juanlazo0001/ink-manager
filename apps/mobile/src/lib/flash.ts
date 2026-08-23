import type { FlashPiece, FlashPieceInput } from '@ink-manager/shared-types';

import { apiFetch } from './api';

/**
 * The flash gallery's four requests.
 *
 * Note what is NOT here: there is no delete. `POST /:id/retire` is the
 * only way a piece leaves the gallery, it is one-way, and it is reachable
 * only from AVAILABLE. That is the product's actual model — a piece with
 * a live request or a completed booking is history someone may need — and
 * a client must not invent a delete that the API would refuse.
 */

/**
 * `GET /flash-pieces`. Requires `flashGallery.manage`, which ARTIST holds
 * by default.
 *
 * No `artistId` is sent: the route resolves an ARTIST caller's own artist
 * id and narrows to it across every studio they currently belong to —
 * home and active guest stints alike. Passing one would be ignored.
 */
export function fetchFlashPieces(token: string, signal?: AbortSignal): Promise<FlashPiece[]> {
  return apiFetch<FlashPiece[]>('/flash-pieces', { token, signal });
}

/**
 * `POST /flash-pieces`.
 *
 * `artistId` is deliberately absent for an ARTIST caller — the API
 * resolves "for myself" and 403s if the id disagrees with the token.
 * `imageUrl`, `title`, `priceCents` and `estimatedDurationMinutes` are
 * all required, and the last two must be positive.
 *
 * `translations` is never sent. Mobile has no Spanish editor, and the API
 * only upserts locales it receives — so omitting the key leaves any
 * translation web created untouched, where an empty object would not.
 */
export function createFlashPiece(token: string, body: FlashPieceInput): Promise<FlashPiece> {
  return apiFetch<FlashPiece>('/flash-pieces', { method: 'POST', token, body: JSON.stringify(body) });
}

/**
 * `PATCH /flash-pieces/:id`. Partial — only the fields sent are written.
 *
 * Editing your OWN piece is never gated by any studio permission; this
 * client only ever edits the caller's own, so a 403 here would mean the
 * piece is not theirs.
 */
export function updateFlashPiece(token: string, id: string, body: FlashPieceInput): Promise<FlashPiece> {
  return apiFetch<FlashPiece>(`/flash-pieces/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });
}

/**
 * `POST /flash-pieces/:id/retire`.
 *
 * Answers 400 with `Can't retire a piece that's currently BOOKED` (or
 * PENDING_APPROVAL / RETIRED) when the status has moved on since the list
 * was fetched — a real race on a shared gallery, and a message worth
 * showing as-is.
 */
export function retireFlashPiece(token: string, id: string): Promise<FlashPiece> {
  return apiFetch<FlashPiece>(`/flash-pieces/${encodeURIComponent(id)}/retire`, { method: 'POST', token });
}

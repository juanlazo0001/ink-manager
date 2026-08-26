/**
 * Prisma enums, as they cross the wire.
 *
 * The VALUES are no longer written here. They are generated into
 * `enums.generated.ts` from `apps/api/prisma/schema.prisma` — see
 * `scripts/generate-enums.mjs` for why codegen rather than a type import,
 * and the package README for the workflow. This file re-exports them and
 * adds the documentation and the few derived constants that are genuinely
 * this package's own.
 *
 * That split exists because hand-retyping is how `InquiryStatus` shipped
 * with 11 of its 15 values (PARITY-AUDIT.md). `npm run typecheck` in this
 * package re-derives from the schema and fails on drift, so the standard
 * verification bar catches it now.
 *
 * Each is a frozen `as const` object plus a string-literal union, not a
 * TypeScript `enum` — `enum` emits runtime code and is not erasable.
 */

export {
  Role,
  ConversationType,
  MessageChannel,
  MessageDirection,
  InquiryStatus,
  AppointmentStatus,
  AppointmentType,
  WaiverStatus,
  FlashReviewMode,
  FlashPieceStatus,
  NotificationType,
} from './enums.generated';

import { MessageChannel } from './enums.generated';

/**
 * The channels a CLIENT thread accepts, in the order the web composer
 * lists them.
 *
 * NOT generated: this is a deliberate subset of `MessageChannel`, not the
 * enum itself. `IN_APP` is reserved for STAFF/GROUP threads and the API
 * rejects it with a 400 on a CLIENT thread.
 *
 * Two of these can produce a REAL outbound send to a real person — `SMS`
 * (Twilio) and `EMAIL` (Gmail) — but only when the studio has that
 * integration connected AND the caller holds `conversations.sendLive`.
 * Every other combination is logged to the thread and goes nowhere.
 */
export const CLIENT_CHANNELS = [
  MessageChannel.SMS,
  MessageChannel.EMAIL,
  MessageChannel.INSTAGRAM,
  MessageChannel.FACEBOOK,
  MessageChannel.PHONE,
  MessageChannel.OTHER,
] as const;
export type ClientChannel = (typeof CLIENT_CHANNELS)[number];

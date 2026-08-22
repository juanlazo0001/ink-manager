/**
 * Prisma enums, restated as string-literal unions plus a frozen value
 * object.
 *
 * Restated rather than imported: the real definitions live in
 * `apps/api/prisma/schema.prisma` and are only available to the API as
 * generated Prisma client code, which pulls in a runtime this package is
 * deliberately not allowed to have. Everything below is the *wire* form —
 * what actually crosses the HTTP boundary as JSON — which is a plain
 * string in every case.
 *
 * Each `const` object exists so callers can write `MessageChannel.SMS`
 * instead of a bare `'SMS'` literal, without a TypeScript `enum` (which
 * emits runtime code and is not erasable).
 */

/** `Role` — apps/api/prisma/schema.prisma */
export const Role = {
  OWNER: 'OWNER',
  FRONT_DESK: 'FRONT_DESK',
  ARTIST: 'ARTIST',
  CUSTOMER: 'CUSTOMER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** `ConversationType` — CLIENT threads are external, STAFF/GROUP are internal. */
export const ConversationType = {
  CLIENT: 'CLIENT',
  STAFF: 'STAFF',
  GROUP: 'GROUP',
} as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];

/**
 * `MessageChannel`.
 *
 * `IN_APP` is reserved for STAFF/GROUP threads — the API rejects it with a
 * 400 on a CLIENT thread, and rejects everything else on a STAFF/GROUP one.
 * See `CLIENT_CHANNELS` below for the set a client-thread composer may
 * actually offer.
 */
export const MessageChannel = {
  IN_APP: 'IN_APP',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  INSTAGRAM: 'INSTAGRAM',
  FACEBOOK: 'FACEBOOK',
  PHONE: 'PHONE',
  OTHER: 'OTHER',
} as const;
export type MessageChannel = (typeof MessageChannel)[keyof typeof MessageChannel];

/**
 * The channels a CLIENT thread accepts, in the order the web composer
 * lists them.
 *
 * Two of these can produce a REAL outbound send to a real person —
 * `SMS` (Twilio) and `EMAIL` (Gmail) — but only when the studio has that
 * integration connected AND the caller holds `conversations.sendLive`.
 * Every other combination is logged to the thread and goes nowhere. See
 * `ConversationThreadResponse['conversation']['callerPermissions']`.
 */
export const CLIENT_CHANNELS = ['SMS', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'PHONE', 'OTHER'] as const;
export type ClientChannel = (typeof CLIENT_CHANNELS)[number];

/** `MessageDirection` — from the studio's point of view. */
export const MessageDirection = {
  /** The client said this; staff is logging it after the fact. */
  INBOUND: 'INBOUND',
  /** The studio said this. */
  OUTBOUND: 'OUTBOUND',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

/** `InquiryStatus` — only consumed here for a conversation's `primaryInquiry` badge. */
export const InquiryStatus = {
  CANDIDACY_REVIEW: 'CANDIDACY_REVIEW',
  NEW: 'NEW',
  ARTIST_ASSIGNED: 'ARTIST_ASSIGNED',
  AWAITING_CLIENT_RESPONSE: 'AWAITING_CLIENT_RESPONSE',
  BUDGET_NEGOTIATION: 'BUDGET_NEGOTIATION',
  SCHEDULING: 'SCHEDULING',
  WAITLISTED: 'WAITLISTED',
  DEPOSIT_PENDING: 'DEPOSIT_PENDING',
  CONFIRMED: 'CONFIRMED',
  CLOSED_LOST: 'CLOSED_LOST',
  COLD_LEAD: 'COLD_LEAD',
} as const;
export type InquiryStatus = (typeof InquiryStatus)[keyof typeof InquiryStatus];

/** `AppointmentStatus`. */
export const AppointmentStatus = {
  REQUESTED: 'REQUESTED',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

/**
 * `AppointmentType`. A consultation is the same Appointment record as a
 * tattoo session -- it reuses the calendar, availability and conflict
 * logic -- and differs only in skipping the gift-card requirement and
 * closing out via "mark complete" rather than full financial checkout.
 */
export const AppointmentType = {
  TATTOO_SESSION: 'TATTOO_SESSION',
  CONSULTATION: 'CONSULTATION',
} as const;
export type AppointmentType = (typeof AppointmentType)[keyof typeof AppointmentType];

/** `LiabilityWaiverStatus`, as it appears on an appointment's waiver summary. */
export const WaiverStatus = {
  PENDING: 'PENDING',
  SIGNED: 'SIGNED',
  VERIFIED: 'VERIFIED',
} as const;
export type WaiverStatus = (typeof WaiverStatus)[keyof typeof WaiverStatus];

// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Source: apps/api/prisma/schema.prisma
// Regenerate: npm run generate:enums --workspace=packages/shared-types
//
// Hand-retyping these is how apps/mobile shipped an InquiryStatus with
// 11 of its 15 values (see PARITY-AUDIT.md). `npm run typecheck` in this
// package re-derives them and fails if this file has drifted.

export const Role = {
  OWNER: 'OWNER',
  FRONT_DESK: 'FRONT_DESK',
  ARTIST: 'ARTIST',
  CUSTOMER: 'CUSTOMER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];


export const ConversationType = {
  CLIENT: 'CLIENT',
  STAFF: 'STAFF',
  GROUP: 'GROUP',
} as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];


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


export const MessageDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];


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
  TRANSFERRED: 'TRANSFERRED',
  FLASH_PENDING_APPROVAL: 'FLASH_PENDING_APPROVAL',
  FLASH_PAYMENT_PENDING: 'FLASH_PAYMENT_PENDING',
  ON_HOLD: 'ON_HOLD',
} as const;
export type InquiryStatus = (typeof InquiryStatus)[keyof typeof InquiryStatus];


export const AppointmentStatus = {
  REQUESTED: 'REQUESTED',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];


export const AppointmentType = {
  TATTOO_SESSION: 'TATTOO_SESSION',
  CONSULTATION: 'CONSULTATION',
} as const;
export type AppointmentType = (typeof AppointmentType)[keyof typeof AppointmentType];


/** Prisma: `LiabilityWaiverStatus`. */
export const WaiverStatus = {
  PENDING: 'PENDING',
  SIGNED: 'SIGNED',
  VERIFIED: 'VERIFIED',
} as const;
export type WaiverStatus = (typeof WaiverStatus)[keyof typeof WaiverStatus];


export const FlashReviewMode = {
  ARTIST: 'ARTIST',
  STUDIO: 'STUDIO',
  NONE: 'NONE',
} as const;
export type FlashReviewMode = (typeof FlashReviewMode)[keyof typeof FlashReviewMode];


export const FlashPieceStatus = {
  AVAILABLE: 'AVAILABLE',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  BOOKED: 'BOOKED',
  RETIRED: 'RETIRED',
} as const;
export type FlashPieceStatus = (typeof FlashPieceStatus)[keyof typeof FlashPieceStatus];


export const GiftCardStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REDEEMED: 'REDEEMED',
  EXPIRED: 'EXPIRED',
  VOID: 'VOID',
  EXEMPT: 'EXEMPT',
} as const;
export type GiftCardStatus = (typeof GiftCardStatus)[keyof typeof GiftCardStatus];

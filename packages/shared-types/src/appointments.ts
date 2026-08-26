import type { AppointmentStatus, AppointmentType, WaiverStatus } from './enums';

export interface AppointmentArtistRef {
  id: string;
  /** Already collapsed by the API to `user.name ?? user.email`. */
  name: string;
  avatarUrl: string | null;
}

export interface AppointmentClientRef {
  id: string;
  firstName: string;
  lastName: string;
}

/** The project this session belongs to, with its description pre-truncated to 60 chars. */
export interface AppointmentInquiryRef {
  id: string;
  label: string;
}

/**
 * One row of `GET /appointments`.
 *
 * Scalars come straight off the `Appointment` model; `artist`, `client`,
 * `inquiry` and `liabilityWaiver` are the shaped relations the list route
 * returns (`shapeListAppointment`).
 *
 * Narrower than the full model — but note this interface once claimed the
 * route "does not return money fields, notes, Stripe ids, or reminder
 * timestamps" while the route used a Prisma `include`, so every one of
 * those scalars was in fact on the wire. It is true now because the route
 * projects the response per caller (`lib/appointmentVisibility.ts`), not
 * because the query was ever narrow. `finalCostCents` and `closeoutNotes`
 * DO still reach a caller holding `appointments.checkout` at the row's own
 * studio — web's ClientDetail session-history table depends on that — so
 * they are declared, optionally, below.
 */
export interface AppointmentListItem {
  id: string;
  /** A real UTC instant. Rendering it as a wall-clock time REQUIRES a timezone — see below. */
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  appointmentType: AppointmentType;
  depositPaid: boolean;
  /**
   * Operational status, NOT a financial field — deliberately ungated, and
   * the same value `ARTIST_INQUIRY_SELECT` already hands artists on their
   * own projects. It is what tells "Session Complete" apart from
   * "Scheduled" in the project-stage derivation.
   */
  checkedOutAt: string | null;
  /** Present only with `appointments.checkout` at this row's own studio. */
  finalCostCents?: number | null;
  /** Present only with `appointments.checkout` at this row's own studio. */
  closeoutNotes?: string | null;
  archivedAt: string | null;
  studioId: string;
  clientId: string | null;
  artistId: string;
  client: AppointmentClientRef | null;
  artist: AppointmentArtistRef;
  inquiry: AppointmentInquiryRef | null;
  /** Present so a client can tell "waiver pending" apart from a plain CONFIRMED. */
  liabilityWaiver: { status: WaiverStatus } | null;
}

/**
 * Query parameters for `GET /appointments`.
 *
 * **`start`/`end` are instants, and the filter is an OVERLAP, not a
 * containment**: the API matches `startTime < end AND endTime > start`. A
 * session that begins before the window and ends inside it is therefore
 * included — which is what makes a day view correct for a session that
 * runs across midnight, and what makes it wrong to assume every returned
 * appointment starts within the range.
 *
 * There is no pagination. The route caps results at 500 when a valid
 * range is supplied and 100 when it is not, ordered `startTime` ascending.
 *
 * `artistId` only ever narrows: an ARTIST caller is forced to their own id
 * server-side regardless of what is sent, and their results span every
 * studio they currently belong to (home plus active guest memberships).
 */
export interface AppointmentListQuery {
  /** ISO instant. Send with `end` or neither — one alone is ignored. */
  start?: string;
  /** ISO instant, exclusive upper bound on `startTime`. */
  end?: string;
  clientId?: string;
  artistId?: string;
}

/**
 * `GET /studio-settings` — the subset a scheduling client needs.
 *
 * Open to OWNER, FRONT_DESK and ARTIST alike. The real response is the
 * whole settings row; narrowed here on purpose.
 */
export interface StudioSettingsResponse {
  /**
   * IANA identifier, e.g. `"America/New_York"`. Defaults to
   * `America/New_York` at the schema level, so it is never null.
   *
   * **This is the timezone every scheduling question must be answered in.**
   * "What is on today", where a day starts and ends, and what wall-clock
   * time an appointment reads at are all questions about the STUDIO's
   * clock, not the device's or the server's. The two differ constantly in
   * practice — a travelling artist, a guest residency, or simply a phone
   * that has not caught up after a flight.
   */
  timezone: string;
  /**
   * One entry per weekday. A missing or `isOpen: false` day is closed —
   * never treat an absent entry as "open all day".
   */
  businessHours: BusinessHoursEntry[] | null;
}

export interface BusinessHoursEntry {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  isOpen: boolean;
  /** `"HH:MM"` in the studio's own timezone. Absent when closed. */
  openTime?: string;
  closeTime?: string;
}

// ---------------------------------------------------------------------
// GET /appointments/:id — the detail response
// ---------------------------------------------------------------------
//
// Considerably richer than a list row. **The API now projects this
// response per caller** (`apps/api/src/lib/appointmentVisibility.ts`) —
// it did not always, and the difference matters to how you read the types
// below.
//
// Previously the whole row was returned to anyone with `appointments.view`
// (which an ARTIST has by DEFAULT) and every rule below was enforced
// client-side, independently, in this repo's two clients. Both agreed;
// neither bound `curl`. The server now enforces the same three rules, each
// evaluated at the APPOINTMENT's own studio and against the caller's
// EFFECTIVE role there — so a solo owner-artist reaching a host studio's
// appointment through a guest membership is judged as the ARTIST they are
// there, not the OWNER they are at home:
//   - final cost / tip / closeout notes / payment plumbing / who closed it
//     out sit behind `appointments.checkout`
//   - the gift-card stack sits behind `giftCards.view` (the same financial
//     detail `reports.viewFinancial` keeps off an artist's dashboard)
//   - client phone / email / SMS-consent state sit behind staff standing:
//     a real OWNER/FRONT_DESK role AND `fromGuestStudio === null`
//   - the embedded project's `budget` / `priceEstimateLow` / `High` are
//     additionally subject to the studio's own
//     `artistFieldVisibility.pricingDetail` setting for an ARTIST, the
//     same way every `inquiries` route already applies it
// None of `appointments.checkout`, `giftCards.view` or `clients.view` is
// in an ARTIST's default permission set.
//
// Withheld fields are ABSENT from the JSON, never null — `null` would be a
// claim ("closed out at no charge"), absence is not. That is why every
// gated field below is `?`-optional: reaching for one without first
// checking the matching permission is a type error, which is the point.
// Clients should still gate their UI on the same permissions rather than
// on `undefined`; the optionality is a backstop, not the design.

export interface AppointmentDetailArtist {
  id: string;
  /** Note: NOT flattened the way the list route flattens it. */
  user: { email: string; name: string | null; avatarUrl: string | null };
}

/**
 * Contact fields reach only a caller with staff standing on this record —
 * see the note above. `phones`/`emails` are presence-only (ids), which is
 * all the web uses them for, inside its staff-gated send-channel picker.
 */
export interface AppointmentDetailClient {
  id: string;
  firstName: string;
  lastName: string;
  /**
   * Rendered only inside the checkout-complete panel, so it travels with
   * `appointments.checkout` rather than with the contact fields below.
   */
  referralCode?: string | null;
  phone?: string | null;
  email?: string | null;
  smsConsentGivenAt?: string | null;
  smsOptedOutAt?: string | null;
  phones?: { id: string }[];
  emails?: { id: string }[];
}

/** The project this session belongs to. Null for a session booked outside one. */
export interface AppointmentDetailInquiry {
  id: string;
  description: string;
  clientId: string;
  colorOrBlackGrey: string | null;
  placement: string | null;
  /**
   * Withheld from an ARTIST whose studio has switched
   * `artistFieldVisibility.pricingDetail` off — the same setting, and the
   * same three fields, every `inquiries` route already honours.
   */
  budget?: string | null;
  priceEstimateLow?: number | null;
  priceEstimateHigh?: number | null;
  referenceImages: string[];
  placementImages: string[];
}

/**
 * Which session of a multi-session plan this is. Null when the project has
 * no plan, or when this booking sits outside it.
 */
export interface AppointmentPlannedSession {
  sessionNumber: number;
  estimatedHoursMin: number | null;
  estimatedHoursMax: number | null;
  /** How many sessions the plan has in total — the "of Y" in "Session X of Y". */
  totalSessions: number;
}

export interface AppointmentGiftCard {
  id: string;
  code: string;
  amountCents: number;
  status: string;
  expiresAt: string | null;
  exemptionReason: string | null;
}

export interface AppointmentPhoto {
  id: string;
  url: string;
  uploadedAt: string;
  uploadedBy: { id: string; name: string | null; email: string } | null;
}

/** Non-PII summary only. The health answers and ID image live behind `GET /waivers/:id`. */
export interface AppointmentWaiverSummary {
  id: string;
  status: WaiverStatus;
  signedAt: string | null;
  verifiedAt: string | null;
}

export interface AppointmentDetail {
  id: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  appointmentType: AppointmentType;
  depositPaid: boolean;
  /** The booking's own note. Distinct from `closeoutNotes`, written at checkout. */
  notes: string | null;
  createdAt: string;
  archivedAt: string | null;
  studioId: string;
  clientId: string | null;
  artistId: string;

  /** Financial — present only with `appointments.checkout` at this row's own studio. */
  finalCostCents?: number | null;
  tipCents?: number | null;
  closeoutNotes?: string | null;
  /** Operational status, not a financial figure — always present. See `AppointmentListItem`. */
  checkedOutAt: string | null;
  /** WHO closed it out travels with the money, not with `checkedOutAt`. */
  checkedOutBy?: { id: string; name: string | null; email: string } | null;

  artist: AppointmentDetailArtist;
  client: AppointmentDetailClient | null;
  inquiry: AppointmentDetailInquiry | null;
  plannedSession: AppointmentPlannedSession | null;
  liabilityWaiver: AppointmentWaiverSummary | null;
  /** Present only with `giftCards.view` at this row's own studio. */
  giftCards?: AppointmentGiftCard[];
  photos: AppointmentPhoto[];

  studio: { id: string; name: string };
  /**
   * Non-null when this appointment lives at a studio the caller reaches
   * only through an active GUEST membership — i.e. NOT their home studio.
   *
   * A caller can hold a real OWNER role at home and still have no staff
   * standing here; `effectiveRoleAt` enforces that server-side on every
   * action. Any staff-only UI must therefore require this to be null, or
   * it renders a panel whose every button returns 403.
   */
  fromGuestStudio: { id: string; name: string } | null;
  referralProgramEnabled: boolean;
}

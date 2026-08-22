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
 * returns (`shapeListAppointment`). Deliberately narrower than the full
 * model — the list route does not return money fields, notes, Stripe ids,
 * or reminder timestamps.
 */
export interface AppointmentListItem {
  id: string;
  /** A real UTC instant. Rendering it as a wall-clock time REQUIRES a timezone — see below. */
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  appointmentType: AppointmentType;
  depositPaid: boolean;
  checkedOutAt: string | null;
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
// Considerably richer than a list row, and returned in full to anyone
// with `appointments.view` at the appointment's own studio — including an
// ARTIST, for whom that permission is on by default. The API does NOT
// project this response per-role, so **deciding what a role should
// actually SEE is the client's job**, and getting it wrong leaks.
//
// `apps/web`'s own AppointmentDetail is the precedent worth matching
// rather than re-deciding:
//   - final cost / tip / closeout notes sit behind `appointments.checkout`
//   - gift card amounts sit behind `giftCards.view` (its comment: the same
//     financial detail `reports.viewFinancial` keeps off an artist's
//     dashboard by default)
//   - client phone/email are never rendered at all — only their presence,
//     and only inside a staff-gated send-channel picker
//   - staff management UI additionally requires the record to be at the
//     caller's HOME studio, i.e. `fromGuestStudio === null`
// None of `appointments.checkout`, `giftCards.view` or `clients.view` is
// in an ARTIST's default permission set.

export interface AppointmentDetailArtist {
  id: string;
  /** Note: NOT flattened the way the list route flattens it. */
  user: { email: string; name: string | null; avatarUrl: string | null };
}

/**
 * Contact fields are present on the wire but should not be displayed —
 * see the note above. `phones`/`emails` are presence-only (ids), which is
 * all the web uses them for.
 */
export interface AppointmentDetailClient {
  id: string;
  firstName: string;
  lastName: string;
  referralCode: string | null;
  phone: string | null;
  email: string | null;
  smsConsentGivenAt: string | null;
  smsOptedOutAt: string | null;
  phones: { id: string }[];
  emails: { id: string }[];
}

/** The project this session belongs to. Null for a session booked outside one. */
export interface AppointmentDetailInquiry {
  id: string;
  description: string;
  clientId: string;
  colorOrBlackGrey: string | null;
  placement: string | null;
  budget: string | null;
  priceEstimateLow: number | null;
  priceEstimateHigh: number | null;
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

  /** Financial — gate on `appointments.checkout` before displaying. */
  finalCostCents: number | null;
  tipCents: number | null;
  closeoutNotes: string | null;
  checkedOutAt: string | null;
  checkedOutBy: { id: string; name: string | null; email: string } | null;

  artist: AppointmentDetailArtist;
  client: AppointmentDetailClient | null;
  inquiry: AppointmentDetailInquiry | null;
  plannedSession: AppointmentPlannedSession | null;
  liabilityWaiver: AppointmentWaiverSummary | null;
  /** Gate on `giftCards.view` before displaying amounts. */
  giftCards: AppointmentGiftCard[];
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

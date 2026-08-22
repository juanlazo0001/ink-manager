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

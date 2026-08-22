import type { AppointmentDetail } from '@ink-manager/shared-types';

/**
 * What a given caller may SEE on an appointment detail screen.
 *
 * `GET /appointments/:id` returns the whole record to anyone holding
 * `appointments.view` at that appointment's studio — which an ARTIST has
 * by default. The API does not project the response per role, so every
 * one of these decisions is the client's, and getting one wrong shows an
 * artist a figure the studio deliberately keeps from them.
 *
 * Each rule below mirrors `apps/web`'s own AppointmentDetail rather than
 * being re-decided here, so the two clients cannot disagree about who
 * sees what. Kept as a pure function, deliberately: this is the part of
 * the screen most worth testing without rendering anything.
 */
export interface AppointmentVisibility {
  /**
   * Final cost, tip and closeout notes.
   *
   * Web gates this whole section on `appointments.checkout`, which is NOT
   * in an ARTIST's default set. Money an artist is not meant to see is
   * exactly the kind of thing that must fail closed.
   */
  canSeeFinancials: boolean;
  /**
   * Gift card amounts and statuses.
   *
   * Its own permission on web, separate from the above, with the
   * reasoning spelled out there: these are the same financial figures
   * `reports.viewFinancial` already keeps off an artist's dashboard.
   */
  canSeeGiftCards: boolean;
  /**
   * Staff standing on THIS record — a real OWNER/FRONT_DESK role AND the
   * record being at the caller's home studio.
   *
   * The second half matters: a solo owner-artist reaching a host studio's
   * appointment through an active guest membership carries a real OWNER
   * role but has no staff standing there, and `effectiveRoleAt` rejects
   * every action server-side. Nothing is gated on this yet — the screen is
   * read-only this session — but it is computed here so the first action
   * added cannot forget it.
   */
  hasStaffStanding: boolean;
  /**
   * Always false, and not configurable.
   *
   * The client's phone and email are on the wire, but `apps/web` never
   * renders them on this page — only their presence, inside a staff-gated
   * send-channel picker. `clients.view` is not in an ARTIST's default set,
   * so displaying them here would be a genuine leak rather than a
   * convenience. Present as a named field so the decision is visible and
   * has somewhere to be revisited, rather than being an absence someone
   * later fills in by accident.
   */
  canSeeClientContact: false;
}

export function appointmentVisibility(params: {
  role: string;
  permissions: string[];
  appointment: Pick<AppointmentDetail, 'fromGuestStudio'> | null;
}): AppointmentVisibility {
  const { role, permissions, appointment } = params;
  const has = (key: string) => permissions.includes(key);

  return {
    canSeeFinancials: has('appointments.checkout'),
    canSeeGiftCards: has('giftCards.view'),
    // `appointment == null` (still loading) reads as false, the same way
    // every appointment-dependent flag on the web does — a panel that
    // flashes into existence and then disappears is worse than one that
    // arrives late.
    hasStaffStanding: (role === 'OWNER' || role === 'FRONT_DESK') && !!appointment && !appointment.fromGuestStudio,
    canSeeClientContact: false,
  };
}

/** `$1,234.00`. Matches `apps/web/src/lib/money.ts`'s `formatCents` for whole values. */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `$400 – $600`, `From $400`, `Up to $600`, or null when neither bound is set. */
export function formatPriceEstimate(low: number | null, high: number | null): string | null {
  const fmt = (v: number) => `$${v.toLocaleString()}`;
  if (low != null && high != null) return low === high ? fmt(low) : `${fmt(low)} – ${fmt(high)}`;
  if (low != null) return `From ${fmt(low)}`;
  if (high != null) return `Up to ${fmt(high)}`;
  return null;
}

/** `Session 2 of 4`, or `Session 2` when the plan's length is unknown. */
export function formatPlannedSession(session: {
  sessionNumber: number;
  totalSessions: number;
}): string {
  return session.totalSessions > 0
    ? `Session ${session.sessionNumber} of ${session.totalSessions}`
    : `Session ${session.sessionNumber}`;
}

/** `4–6 hours estimated`, `4 hours estimated`, or null. */
export function formatEstimatedHours(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) return `${min}–${max} hours estimated`;
  const single = min ?? max;
  return `${single} hour${single === 1 ? '' : 's'} estimated`;
}

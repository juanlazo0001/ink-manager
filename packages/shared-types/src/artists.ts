import type { FlashReviewMode } from './enums';

/**
 * The artist profile, as `GET /artists/:id` returns it.
 *
 * One artist has exactly ONE of each of these — they are fields on
 * `Artist`, not per-studio rows. That is not a detail: it is why the API
 * refuses to let a guest studio write rates, scheduling buffer, services,
 * or preferred schedule, and why a client must never present them as
 * "this studio's settings for you."
 */
export interface ArtistProfile {
  id: string;
  bio: string | null;
  specialties: string[];
  portfolioImages: string[];
  instagramHandle: string | null;
  facebookProfileUrl: string | null;
  publicContactEmail: string | null;
  preferredSchedule: ScheduleBlock[] | null;
  /**
   * A scheduling-only availability window on `Artist` itself. It predates
   * the real `StudioMembership` system and has NO connection to it — web
   * renamed its section to "Limited Availability Window" precisely
   * because two real artists were shown a stale "Guest (ended)" badge
   * derived from this field while their actual membership was HOME.
   * Never derive "is this person a guest here" from it.
   */
  isGuest: boolean;
  /** UTC-midnight ISO strings. Read with `.slice(0, 10)`, never local getters. */
  guestStartDate: string | null;
  guestEndDate: string | null;
  hourlyRateCents: number | null;
  flatRateCents: number | null;
  /** null means "use the studio's own StudioSettings default". */
  schedulingBufferMinutes: number | null;
  allowsClientSelfScheduling: boolean;
  flashReviewMode: FlashReviewMode;
  publicSlug: string | null;
  publishedAt: string | null;
  artistServices: { serviceId: string }[];
  user: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    avatarUrl: string | null;
    studioId: string;
    studio: { slug: string };
  };
  /**
   * The one ACTIVE membership joining this artist to the VIEWING studio.
   * An array because that is the shape Prisma's include returns, though
   * only one row can ever be active here.
   */
  memberships: { allowsStudioProfileEdits: boolean; type: 'HOME' | 'GUEST' }[];
}

/**
 * One weekly availability block. `PATCH /artists/:id/preferred-schedule`
 * validates exactly this shape and rejects anything else with a 400.
 *
 * `startTime`/`endTime` are wall-clock `"HH:MM"` in the studio's own
 * timezone — not instants, and not the device's clock. Nothing here
 * should ever be round-tripped through a `Date`.
 */
export interface ScheduleBlock {
  /** 0 = Sunday, matching `Date.prototype.getDay()`. */
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/** `GET /services` — the subset a profile editor needs. */
export interface ServiceOption {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * `GET|PUT /widget-layouts/:pageKey` — one person's section order and
 * collapsed state for one page.
 *
 * An empty `widgetOrder` means "never customised", not "no sections":
 * fall back to the page's own default order rather than rendering
 * nothing. The API does not validate `pageKey` or the ids inside, so a
 * client must tolerate ids it no longer knows and supply any it is
 * missing.
 */
export interface WidgetLayout {
  widgetOrder: string[];
  collapsedWidgetIds: string[];
}

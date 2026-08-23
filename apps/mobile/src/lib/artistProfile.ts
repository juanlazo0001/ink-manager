import type { ArtistProfile, ScheduleBlock, ServiceOption } from '@ink-manager/shared-types';

/**
 * The artist profile as a set of sections, and the translation between
 * the API's shape and the form's.
 *
 * Pure on purpose — no React, no fetch. Every rule here is one that has a
 * right answer independent of how it is rendered, and keeping them out of
 * the screens is what makes them checkable.
 */

/**
 * Section ids, matching web's `ARTIST_WIDGET_ORDER` exactly. They are the
 * keys persisted to `PUT /widget-layouts/artist-detail`, so they are a
 * cross-client contract: renaming one here would silently discard a
 * person's saved order, and reordering on one client must be visible on
 * the other.
 *
 * Web's list has a tenth id, `guest-artist` — the "Limited Availability
 * Window". It is omitted here rather than shown read-only because web
 * renders that widget only for a caller with `artists.manage`, which an
 * artist does not have by default, and the API strips those fields from
 * any self-edit anyway. An artist has never seen it on web, so mobile
 * showing it would be a difference, not parity.
 */
export const ARTIST_SECTIONS = [
  'bio',
  'rates',
  'scheduling-buffer',
  'social-links',
  'public-presence',
  'specialties',
  'services',
  'preferred-schedule',
  'portfolio',
] as const;

export type ArtistSectionId = (typeof ARTIST_SECTIONS)[number];

/** Titles, verbatim from web's `<Widget title=…>`. */
export const SECTION_TITLES: Record<ArtistSectionId, string> = {
  bio: 'Bio',
  rates: 'Rates',
  'scheduling-buffer': 'Scheduling Buffer',
  'social-links': 'Social Links',
  'public-presence': 'Public presence',
  specialties: 'Specialties',
  services: 'Services Offered',
  'preferred-schedule': 'Preferred Schedule',
  portfolio: 'Portfolio',
};

/**
 * The saved order, repaired.
 *
 * `GET /widget-layouts/:pageKey` returns whatever was last written, and
 * the API validates neither the page key nor the ids inside it. Three
 * things therefore have to be survivable, and all three are real: an
 * empty array (never customised), an id this client doesn't know
 * (`guest-artist`, saved by web), and an id missing from the saved order
 * (a section added after the person last reordered).
 *
 * Unknown ids are dropped and missing ones appended in their default
 * position, so a section can never vanish from the screen because of what
 * some other client wrote.
 */
export function resolveSectionOrder(savedOrder: string[]): ArtistSectionId[] {
  const known = new Set<string>(ARTIST_SECTIONS);
  const seen = new Set<string>();
  const ordered: ArtistSectionId[] = [];

  for (const id of savedOrder) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id as ArtistSectionId);
    }
  }
  for (const id of ARTIST_SECTIONS) {
    if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}

/** Moves one section one step. Returns the same array when it can't move. */
export function moveSection(order: ArtistSectionId[], id: ArtistSectionId, delta: -1 | 1): ArtistSectionId[] {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/**
 * The form's shape: strings, because that is what a text input holds.
 * Converting at the boundary — rather than storing numbers and coercing
 * on every keystroke — is what lets "" mean "unset" instead of 0.
 */
export interface ProfileFormValues extends Record<string, unknown> {
  bio: string;
  hourlyRate: string;
  flatRate: string;
  schedulingBufferMinutes: string;
  flashReviewMode: ArtistProfile['flashReviewMode'];
  instagramHandle: string;
  facebookProfileUrl: string;
  publicContactEmail: string;
  specialties: string[];
  serviceIds: string[];
  portfolioImages: string[];
}

export function profileFormFrom(artist: ArtistProfile): ProfileFormValues {
  return {
    bio: artist.bio ?? '',
    hourlyRate: artist.hourlyRateCents != null ? String(artist.hourlyRateCents / 100) : '',
    flatRate: artist.flatRateCents != null ? String(artist.flatRateCents / 100) : '',
    schedulingBufferMinutes: artist.schedulingBufferMinutes != null ? String(artist.schedulingBufferMinutes) : '',
    flashReviewMode: artist.flashReviewMode,
    instagramHandle: artist.instagramHandle ?? '',
    facebookProfileUrl: artist.facebookProfileUrl ?? '',
    publicContactEmail: artist.publicContactEmail ?? '',
    specialties: artist.specialties,
    serviceIds: artist.artistServices.map((s) => s.serviceId),
    portfolioImages: artist.portfolioImages,
  };
}

/**
 * The body `PATCH /artists/:id` receives.
 *
 * Whole-document, exactly as web sends it: every field every time, so a
 * cleared value really clears. Two deliberate omissions:
 *
 *   isGuest / guestStartDate / guestEndDate / allowsClientSelfScheduling
 *     The API strips all four from a self-edit (`req.viaSelfArtistBypass`).
 *     Sending them would be sending something guaranteed to be discarded.
 *
 *   preferredSchedule
 *     Its own route, its own button, its own permission — see
 *     `scheduleBlocks` below.
 *
 * `flashReviewMode` IS included: it is self-only on the API, and this
 * client only ever edits the caller's own profile.
 */
export function artistPatchFrom(values: ProfileFormValues) {
  return {
    bio: values.bio.trim() || null,
    specialties: values.specialties,
    serviceIds: values.serviceIds,
    portfolioImages: values.portfolioImages,
    instagramHandle: values.instagramHandle.trim() || null,
    facebookProfileUrl: values.facebookProfileUrl.trim() || null,
    publicContactEmail: values.publicContactEmail.trim() || null,
    hourlyRateCents: values.hourlyRate.trim() ? Math.round(Number(values.hourlyRate) * 100) : null,
    flatRateCents: values.flatRate.trim() ? Math.round(Number(values.flatRate) * 100) : null,
    schedulingBufferMinutes: values.schedulingBufferMinutes.trim()
      ? Math.round(Number(values.schedulingBufferMinutes))
      : null,
    flashReviewMode: values.flashReviewMode,
  };
}

/** Sunday-first, matching `dayOfWeek` 0–6 and `Date.prototype.getDay()`. */
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** One editable row per day, `null` where the artist isn't available. */
export type ScheduleDays = (ScheduleBlock | null)[];

export function scheduleDaysFrom(blocks: ScheduleBlock[] | null): ScheduleDays {
  const days: ScheduleDays = [null, null, null, null, null, null, null];
  for (const block of blocks ?? []) {
    if (block.dayOfWeek >= 0 && block.dayOfWeek <= 6) days[block.dayOfWeek] = block;
  }
  return days;
}

/**
 * Back to the wire shape. `null` rather than `[]` for an empty week —
 * that is the difference between "no preference recorded" and "available
 * zero hours", and the route accepts null explicitly for the first.
 */
export function scheduleBlocksFrom(days: ScheduleDays): ScheduleBlock[] | null {
  const blocks = days
    .map((block, dayOfWeek) => (block ? { ...block, dayOfWeek } : null))
    .filter((b): b is ScheduleBlock => b !== null);
  return blocks.length > 0 ? blocks : null;
}

/** `"09:00"` → `"9:00 AM"`. Wall clock, never a Date — see ScheduleBlock. */
export function formatClockTime(value: string): string {
  const [rawHour, rawMinute] = value.split(':');
  const hour = Number(rawHour);
  if (!Number.isInteger(hour) || rawMinute == null) return value;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${rawMinute} ${suffix}`;
}

/** Accepts `9`, `09:5`, `9:30`; returns a padded `"HH:MM"` or null. */
export function normalizeClockTime(input: string): string | null {
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] == null ? 0 : Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** `$180.00/hr · $900.00 flat`, or null when neither is set. */
export function formatRates(artist: Pick<ArtistProfile, 'hourlyRateCents' | 'flatRateCents'>): string | null {
  const parts: string[] = [];
  if (artist.hourlyRateCents != null) parts.push(`$${(artist.hourlyRateCents / 100).toFixed(2)}/hr`);
  if (artist.flatRateCents != null) parts.push(`$${(artist.flatRateCents / 100).toFixed(2)} flat`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function serviceNames(artist: ArtistProfile, options: ServiceOption[]): string[] {
  const tagged = new Set(artist.artistServices.map((s) => s.serviceId));
  return options.filter((s) => tagged.has(s.id)).map((s) => s.name);
}

/**
 * The public web app's origin.
 *
 * Same shape and same reasoning as `API_URL` in `api.ts`: an
 * `EXPO_PUBLIC_`-prefixed variable inlined at build time, defaulting to
 * production because a phone cannot reach a dev machine's localhost.
 * `web.inkmanager.app` is the deployed frontend (apps/web/index.html), so
 * these links resolve to the same pages web's own Copy button produces
 * from `window.location.origin`.
 */
export const APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://web.inkmanager.app').replace(/\/+$/, '');

export function publicPageUrl(slug: string): string {
  return `${APP_URL}/artist/${encodeURIComponent(slug)}`;
}

export function flashGalleryUrl(studioSlug: string, artistId: string): string {
  return `${APP_URL}/flash/${encodeURIComponent(studioSlug)}/${encodeURIComponent(artistId)}`;
}

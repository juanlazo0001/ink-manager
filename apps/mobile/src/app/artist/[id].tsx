import type { ArtistProfile, ServiceOption } from '@ink-manager/shared-types';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, initialsOf } from '@/components/Avatar';
import { ProfileSection } from '@/components/ProfileSection';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenShell } from '@/components/ScreenShell';
import { ArrowUpRightIcon } from '@/components/icons';
import { Chip, Eyebrow, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import {
  WEEKDAY_LABELS,
  flashGalleryUrl,
  formatClockTime,
  formatRates,
  publicPageUrl,
  scheduleDaysFrom,
  serviceNames,
} from '@/lib/artistProfile';
import { fetchArtistProfile, fetchServices } from '@/lib/artists';
import { formatPhone } from '@/lib/format';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * An artist's profile, as STAFF see it — web's `/artists/:id`.
 *
 * Session AY built the artist CARD on the Team tab and recorded the gap
 * this closes: "Web's card is also a link to `/artists/:id`, a full
 * profile page this app does not have. The card is therefore not
 * pressable, rather than pressable and going nowhere. That page is the
 * obvious follow-up." This is it.
 *
 * ─── ALL TEN OF WEB'S SECTIONS, INCLUDING THE ONE MOBILE LACKED ─────
 *
 * Confirmed against the running web app rather than the source alone —
 * `design-refs/session-bc/web-artist-detail.png`. In web's own order:
 *
 *     Limited Availability Window   <- mobile had NO equivalent anywhere
 *     Bio
 *     Rates
 *     Scheduling Buffer             (+ client self-scheduling)
 *     Social Links
 *     Public presence
 *     Specialties
 *     Services Offered
 *     Preferred Schedule
 *     Portfolio
 *
 * `ARTIST_SECTIONS` in `lib/artistProfile.ts` lists nine — it has never
 * included `guest-artist`, and its own `resolveSectionOrder` comment
 * names that id as one "saved by web" that this client drops. That was
 * correct for the artist's own profile screens, which is all that list
 * served; it is not correct here, so this screen renders that section
 * explicitly rather than widening a constant two other screens read.
 *
 * ─── WHY THIS IS NOT `profile.tsx` WITH A PROP ──────────────────────
 *
 * `app/profile.tsx` renders nine of these sections already, for the
 * artist THEMSELF. Every line of its copy is second person — "booking
 * you", "your public page isn't published yet" — and web has two separate
 * pages here for exactly that reason. The wording below is web's own
 * third-person copy from `ArtistDetail.tsx`, verbatim. Merging the two
 * screens would mean a voice prop threaded through every string, which is
 * more coupling than the duplication costs.
 *
 * ─── READ-ONLY ──────────────────────────────────────────────────────
 *
 * Web's version edits most of these in place, gated on the artist having
 * granted `allowsStudioProfileEdits`. This screen shows and does not
 * change, which is what mobile's other staff surfaces do (Settings, the
 * permission matrix, the Team roster) and what the footer says. Building
 * ten editors without the delegation flow behind them would be the
 * half-built control this app keeps deciding not to ship.
 */
export default function ArtistDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!token || !id) return;
    setError(null);
    try {
      const profile = await fetchArtistProfile(token, id);
      setArtist(profile);
    } catch (err) {
      setError(screenErrorMessage(err, 'that artist'));
      return;
    }
    /* Services are a nice-to-have: they only turn tagged service IDS into
       NAMES. A failure here leaves that one section saying so, and is not
       a reason to fail the screen — the same trade `useArtistProfileData`
       makes for its own two secondary requests. */
    try {
      setServices(await fetchServices(token));
    } catch {
      /* Section renders the count without names. */
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (error) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Artist" onBack={() => router.back()} right={<View style={styles.spacer} />} />
        <StateMessage
          eyebrow="Not loaded"
          title="That artist couldn't be loaded"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      </ScreenShell>
    );
  }

  if (!artist) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Artist" onBack={() => router.back()} right={<View style={styles.spacer} />} />
        <ScreenLoading />
      </ScreenShell>
    );
  }

  const name = artist.user.name ?? artist.user.email;
  const days = scheduleDaysFrom(artist.preferredSchedule);
  const anySchedule = days.some(Boolean);
  const taggedNames = serviceNames(artist, services);
  const links = [
    artist.instagramHandle
      ? {
          label: 'Instagram',
          value: `@${artist.instagramHandle}`,
          url: `https://instagram.com/${artist.instagramHandle}`,
        }
      : null,
    artist.facebookProfileUrl
      ? { label: 'Facebook', value: artist.facebookProfileUrl, url: artist.facebookProfileUrl }
      : null,
    artist.publicContactEmail
      ? { label: 'Public email', value: artist.publicContactEmail, url: `mailto:${artist.publicContactEmail}` }
      : null,
  ].filter((x): x is { label: string; value: string; url: string } => x !== null);

  const section = (key: string, title: string, summary: string | null, body: React.ReactNode) => (
    <ProfileSection
      key={key}
      title={title}
      collapsed={collapsed.has(key)}
      onToggleCollapse={() => toggle(key)}
      summary={summary}
    >
      {body}
    </ProfileSection>
  );

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader title="Artist" onBack={() => router.back()} right={<View style={styles.spacer} />} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Avatar url={artist.user.avatarUrl} initials={initialsOf(name)} size={56} />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
            <Text style={styles.contact}>{artist.user.email}</Text>
            {artist.user.phone ? <Text style={styles.contact}>{formatPhone(artist.user.phone)}</Text> : null}
            {/* From the membership row and nothing else — `isGuest` below
                is a different question, and deriving this from it is the
                exact mistake that put a stale badge on two real artists. */}
            {artist.memberships[0]?.type === 'GUEST' ? (
              <View style={styles.badges}>
                <Chip label="GUEST" color={colors.accent} />
              </View>
            ) : null}
          </View>
        </View>

        {/* ─── the section web has and mobile did not ─────────────── */}
        {section(
          'guest-artist',
          'Limited Availability Window',
          artist.isGuest ? 'On' : 'Off',
          <>
            <Hint>
              Restricts this artist to a specific date range at your studio. Once the end date passes they drop out of
              Calendar&apos;s default resource columns and default assignment pickers, but stay fully visible here and
              their past appointments are never hidden. Unrelated to the &ldquo;Guest artist&rdquo; badge above, which
              reflects their real studio membership.
            </Hint>
            {artist.isGuest ? (
              <Body
                /* UTC-midnight calendar dates. `.slice(0, 10)` per the
                   shared type's own instruction — a local getter here
                   shows the wrong day west of UTC. */
                text={`${artist.guestStartDate?.slice(0, 10) ?? '—'} to ${artist.guestEndDate?.slice(0, 10) ?? '—'}`}
                empty="—"
              />
            ) : (
              <Body text={null} empty="No limited window — available indefinitely." />
            )}
          </>,
        )}

        {section('bio', 'Bio', artist.bio?.trim() ? artist.bio.trim().split('\n')[0] : 'Not set', (
          <Body text={artist.bio} empty="No bio yet." />
        ))}

        {section('rates', 'Rates', formatRates(artist) ?? 'Not set', (
          <>
            <Hint>
              Reference rate(s) for this artist. Purely informational — when assigned to an estimate, these suggest a
              starting price per session that staff can freely override.
            </Hint>
            <Body text={formatRates(artist)} empty="No rates set." />
          </>
        ))}

        {section(
          'scheduling-buffer',
          'Scheduling Buffer',
          artist.schedulingBufferMinutes != null ? `${artist.schedulingBufferMinutes} minutes` : "Studio's default",
          <>
            <Hint>
              Minimum gap flagged as a possible conflict when booking this artist. Overrides the studio&apos;s own
              default for this artist only.
            </Hint>
            <Body
              text={artist.schedulingBufferMinutes != null ? `${artist.schedulingBufferMinutes} minutes` : null}
              empty="Using the studio's default."
            />
            <View style={styles.subBlock}>
              <Eyebrow>Client self-scheduling</Eyebrow>
              <Hint>
                When a client accepts this artist&apos;s estimate, let them pick from the artist&apos;s real suggested
                availability. Their pick only creates a pending request — staff still confirm it.
              </Hint>
              <Body text={artist.allowsClientSelfScheduling ? 'On' : 'Off'} empty="Off" />
            </View>
            <View style={styles.subBlock}>
              <Eyebrow>Flash booking review</Eyebrow>
              <Body text={FLASH_REVIEW_LABELS[artist.flashReviewMode]} empty="—" />
            </View>
          </>,
        )}

        {section(
          'social-links',
          'Social Links',
          links.length > 0 ? `${links.length} link${links.length === 1 ? '' : 's'}` : 'None',
          links.length === 0 ? (
            <Body text={null} empty="No social links yet." />
          ) : (
            <View style={styles.linkList}>
              {links.map((link) => (
                <LinkOut key={link.label} label={link.label} value={link.value} url={link.url} />
              ))}
            </View>
          ),
        )}

        {section(
          'public-presence',
          'Public presence',
          artist.publishedAt ? 'Published' : 'Not published',
          <View style={styles.linkList}>
            {artist.publishedAt && artist.publicSlug ? (
              <LinkOut label="Public page" value={publicPageUrl(artist.publicSlug)} url={publicPageUrl(artist.publicSlug)} />
            ) : (
              /* Web's exact sentence, and it matters: it names who CAN
                 publish, which is not the person reading this screen. */
              <Body text={null} empty="Public page not published. Only the artist can publish it, from their own Profile page." />
            )}
            <LinkOut
              label="Flash gallery"
              value={flashGalleryUrl(artist.user.studio.slug, artist.id)}
              url={flashGalleryUrl(artist.user.studio.slug, artist.id)}
            />
          </View>,
        )}

        {section(
          'specialties',
          'Specialties',
          artist.specialties.length > 0 ? artist.specialties.join(', ') : 'None',
          artist.specialties.length > 0 ? (
            <View style={styles.chips}>
              {artist.specialties.map((s) => (
                <View key={s} style={styles.chip}>
                  <Text style={styles.chipLabel}>{s}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Body text={null} empty="No specialties listed." />
          ),
        )}

        {section(
          'services',
          'Services Offered',
          artist.artistServices.length > 0 ? `${artist.artistServices.length} tagged` : 'None',
          <>
            <Hint>
              Which of the studio&apos;s services this artist practises — only artists tagged here appear as
              practitioner options for an inquiry in that service.
            </Hint>
            {artist.artistServices.length === 0 ? (
              <Body text={null} empty="No services tagged yet." />
            ) : taggedNames.length === 0 ? (
              /* Tagged but unnamed is still a fact. Showing nothing would
                 misreport the profile as empty. */
              <Body text={null} empty={`${artist.artistServices.length} tagged — names couldn't be loaded.`} />
            ) : (
              <View style={styles.chips}>
                {taggedNames.map((n) => (
                  <View key={n} style={styles.chip}>
                    <Text style={styles.chipLabel}>{n}</Text>
                  </View>
                ))}
              </View>
            )}
          </>,
        )}

        {section(
          'preferred-schedule',
          'Preferred Schedule',
          anySchedule ? `${(artist.preferredSchedule ?? []).length} days` : 'Not set',
          <>
            <Hint>Advisory availability only — doesn&apos;t block scheduling, just informs staff.</Hint>
            {anySchedule ? (
              <View style={styles.scheduleList}>
                {days.map((block, index) => (
                  <View key={WEEKDAY_LABELS[index]} style={styles.scheduleRow}>
                    <Text style={[styles.scheduleDay, !block && styles.off]}>{WEEKDAY_LABELS[index]}</Text>
                    <Text style={[styles.scheduleHours, !block && styles.off]}>
                      {block ? `${formatClockTime(block.startTime)} – ${formatClockTime(block.endTime)}` : 'Not available'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Body text={null} empty="No preferred hours set." />
            )}
          </>,
        )}

        {section(
          'portfolio',
          'Portfolio',
          artist.portfolioImages.length > 0
            ? `${artist.portfolioImages.length} photo${artist.portfolioImages.length === 1 ? '' : 's'}`
            : 'None',
          artist.portfolioImages.length > 0 ? (
            <View style={styles.grid}>
              {artist.portfolioImages.map((url, index) => (
                <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.tile} contentFit="cover" transition={120} />
              ))}
            </View>
          ) : (
            <Body text={null} empty="No portfolio images yet." />
          ),
        )}

        <Text style={styles.footer}>
          Editing an artist&apos;s profile, and inviting or removing people, are done in the portal. This screen shows
          the profile; it doesn&apos;t change it.
        </Text>
      </ScrollView>
    </ScreenShell>
  );
}

/** Web's own labels for `FlashReviewMode`. */
const FLASH_REVIEW_LABELS: Record<string, string> = {
  ARTIST: 'Artist reviews each request',
  AUTO: 'Auto-accept requests',
  STUDIO: 'Studio reviews each request',
};

function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

function Body({ text, empty }: { text: string | null | undefined; empty: string }) {
  const shown = text && text.trim() ? text : null;
  return <Text style={[styles.body, !shown && styles.bodyEmpty]}>{shown ?? empty}</Text>;
}

function LinkOut({ label, value, url }: { label: string; value: string; url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={`${label}, opens outside the app`}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
    >
      <Text style={styles.linkLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.linkValue} numberOfLines={1}>
        {value}
      </Text>
      <ArrowUpRightIcon size={14} color={colors.fgMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  spacer: { width: 36 },
  content: { paddingBottom: space.xxxl, gap: space.md },

  identity: {
    flexDirection: 'row',
    gap: space.lg,
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  identityText: { flex: 1, gap: 2 },
  name: { ...type.welcome, fontSize: 24, lineHeight: 30, color: colors.fg },
  contact: { ...type.small, color: colors.fgSecondary },
  badges: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },

  hint: { ...type.meta, color: colors.fgMuted, marginBottom: space.sm },
  body: { ...type.body, color: colors.fg },
  bodyEmpty: { ...type.small, color: colors.fgMuted },
  subBlock: { marginTop: space.md, gap: space.xs },

  linkList: { gap: space.sm },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
  },
  linkLabel: { ...type.label, color: colors.fgMuted, width: 96 },
  linkValue: { ...type.small, color: colors.fg, flex: 1 },
  pressed: { opacity: 0.6 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  chipLabel: { ...type.meta, color: colors.fgSecondary },

  scheduleList: { gap: space.xs },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scheduleDay: { ...type.label, color: colors.fg, width: 56 },
  scheduleHours: { ...type.small, color: colors.fg },
  off: { color: colors.fgMuted },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.border,
  },

  footer: { ...type.meta, color: colors.fgMuted, paddingHorizontal: space.lg, paddingTop: space.md },
});

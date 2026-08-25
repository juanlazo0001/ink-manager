import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenShell } from '@/components/ScreenShell';
import { ProfileSection } from '@/components/ProfileSection';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Chip, Eyebrow, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ARTIST_LAYOUT_PAGE_KEY, useArtistProfileData } from '@/hooks/useArtistProfileData';
import {
  formatClockTime,
  formatRates,
  moveSection,
  publicPageUrl,
  flashGalleryUrl,
  scheduleDaysFrom,
  SECTION_TITLES,
  serviceNames,
  WEEKDAY_LABELS,
  type ArtistSectionId,
} from '@/lib/artistProfile';
import { saveWidgetLayout } from '@/lib/artists';
import { colors, hairline, radius, space, type } from '@/theme';
import { formatPhone } from '@/lib/format';

/**
 * The artist's own profile, read-only.
 *
 * Web has no separate view mode — its artist page is a form that is
 * simply disabled for a caller who can't edit it. Mobile splits the two
 * deliberately: a phone screen has room for either the content or the
 * controls, not both, and the common case by far is looking something up
 * rather than changing it. Everything editable is one tap away in the
 * editor, and the section order and collapsed state are shared with web
 * through the same saved layout.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const data = useArtistProfileData();
  const [reordering, setReordering] = useState(false);

  const token = session?.token ?? null;
  const artist = data.artist;

  /**
   * Layout writes are fire-and-forget. A failed one means a display
   * preference didn't stick — never worth an error in front of someone
   * who was only tidying their own screen. The local state moves either
   * way, so the screen always does what the tap asked.
   */
  const persistLayout = useCallback(
    (order: ArtistSectionId[], collapsed: string[]) => {
      data.setLayout({ order, collapsed });
      if (!token) return;
      saveWidgetLayout(token, ARTIST_LAYOUT_PAGE_KEY, { widgetOrder: order, collapsedWidgetIds: collapsed }).catch(
        () => {},
      );
    },
    [data, token],
  );

  const toggleCollapsed = useCallback(
    (id: ArtistSectionId) => {
      const next = data.collapsed.includes(id)
        ? data.collapsed.filter((x) => x !== id)
        : [...data.collapsed, id];
      persistLayout(data.order, next);
    },
    [data.collapsed, data.order, persistLayout],
  );

  const move = useCallback(
    (id: ArtistSectionId, delta: -1 | 1) => persistLayout(moveSection(data.order, id, delta), data.collapsed),
    [data.collapsed, data.order, persistLayout],
  );

  if (data.loading && !artist) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Profile" onBack={() => router.back()} right={<View />} />
        <ScreenLoading />
      </ScreenShell>
    );
  }

  if (data.noArtistProfile) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Profile" onBack={() => router.back()} right={<View />} />
        <StateMessage
          eyebrow="No artist profile"
          title="This account isn't an artist profile"
          body="Bio, rates, specialties and portfolio belong to an artist profile. Yours doesn't have one, so there's nothing to show here."
        />
      </ScreenShell>
    );
  }

  if (!artist) {
    return (
      <ScreenShell edges={['top']}>
        <ScreenHeader title="Profile" onBack={() => router.back()} right={<View />} />
        <StateMessage
          eyebrow="Not available"
          tone="alert"
          title="Your profile didn't load"
          body={data.error ?? undefined}
          action={{ label: 'Try again', onPress: data.reload }}
        />
      </ScreenShell>
    );
  }

  const displayName = artist.user.name?.trim() || artist.user.email;
  const isCollapsed = (id: ArtistSectionId) => data.collapsed.includes(id);

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader
        title="Profile"
        subtitle={session?.studio?.name ?? undefined}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => router.push('/profile-edit')}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            hitSlop={8}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
          >
            <Text style={styles.editLabel}>EDIT</Text>
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          {artist.user.avatarUrl ? (
            <Image source={{ uri: artist.user.avatarUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Text style={styles.avatarInitial}>{displayName.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={2}>
              {displayName}
            </Text>
            <Text style={styles.contact}>{artist.user.email}</Text>
            {artist.user.phone ? <Text style={styles.contact}>{formatPhone(artist.user.phone)}</Text> : null}
            <View style={styles.badges}>
              {session?.profile.role ? <Chip label={session.profile.role.replace('_', ' ')} /> : null}
              {/* Derived ONLY from the real membership row. Artist.isGuest
                  is a different, unrelated field and has produced a
                  misleading "Guest" badge before. */}
              {artist.memberships[0]?.type === 'GUEST' ? <Chip label="Guest artist" color={colors.accent} /> : null}
            </View>
          </View>
        </View>

        <Pressable
          onPress={() => setReordering((v) => !v)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.reorderToggle, pressed && styles.pressed]}
        >
          <Feather name={reordering ? 'check' : 'move'} size={14} color={colors.fgMuted} />
          <Text style={styles.reorderLabel}>{reordering ? 'DONE REORDERING' : 'REORDER SECTIONS'}</Text>
        </Pressable>

        {data.order.map((id, index) => (
          <ProfileSection
            key={id}
            title={SECTION_TITLES[id]}
            collapsed={isCollapsed(id)}
            onToggleCollapse={() => toggleCollapsed(id)}
            reordering={reordering}
            onMoveUp={index > 0 ? () => move(id, -1) : undefined}
            onMoveDown={index < data.order.length - 1 ? () => move(id, 1) : undefined}
            summary={summaryFor(id, data)}
          >
            {renderSection(id, data)}
          </ProfileSection>
        ))}
      </ScrollView>
    </ScreenShell>
  );
}

/** The one-line stand-in shown while a section is collapsed. */
function summaryFor(id: ArtistSectionId, data: ReturnType<typeof useArtistProfileData>): string | null {
  const artist = data.artist;
  if (!artist) return null;
  switch (id) {
    case 'bio':
      return artist.bio?.trim() ? artist.bio.trim().split('\n')[0] : 'Not set';
    case 'rates':
      return formatRates(artist) ?? 'Not set';
    case 'scheduling-buffer':
      return artist.schedulingBufferMinutes != null
        ? `${artist.schedulingBufferMinutes} minutes`
        : "Studio's default";
    case 'social-links': {
      const count = [artist.instagramHandle, artist.facebookProfileUrl, artist.publicContactEmail].filter(
        (v) => v && v.trim(),
      ).length;
      return count > 0 ? `${count} link${count === 1 ? '' : 's'}` : 'None';
    }
    case 'public-presence':
      return artist.publishedAt ? 'Published' : 'Not published';
    case 'specialties':
      return artist.specialties.length > 0 ? artist.specialties.join(', ') : 'None';
    case 'services':
      return artist.artistServices.length > 0 ? `${artist.artistServices.length} tagged` : 'None';
    case 'preferred-schedule': {
      const days = (artist.preferredSchedule ?? []).length;
      return days > 0 ? `${days} day${days === 1 ? '' : 's'}` : 'Not set';
    }
    case 'portfolio':
      return artist.portfolioImages.length > 0
        ? `${artist.portfolioImages.length} photo${artist.portfolioImages.length === 1 ? '' : 's'}`
        : 'None';
  }
}

function renderSection(id: ArtistSectionId, data: ReturnType<typeof useArtistProfileData>) {
  const artist = data.artist!;

  switch (id) {
    case 'bio':
      return <Body text={artist.bio} empty="No bio yet." />;

    case 'rates':
      return (
        <>
          <Hint>
            Reference rates only. When you're assigned to an estimate these suggest a starting price that staff can
            override.
          </Hint>
          <Body text={formatRates(artist)} empty="No rates set." />
        </>
      );

    case 'scheduling-buffer':
      return (
        <>
          <Hint>Minimum gap flagged as a possible conflict when booking you.</Hint>
          <Body
            text={artist.schedulingBufferMinutes != null ? `${artist.schedulingBufferMinutes} minutes` : null}
            empty="Using the studio's default."
          />
          <View style={styles.subBlock}>
            <Eyebrow>Client self-scheduling</Eyebrow>
            <Body text={artist.allowsClientSelfScheduling ? 'On' : 'Off'} empty="Off" />
          </View>
          <View style={styles.subBlock}>
            <Eyebrow>Flash booking review</Eyebrow>
            <Body text={FLASH_REVIEW_LABELS[artist.flashReviewMode]} empty="—" />
          </View>
        </>
      );

    case 'social-links': {
      const links = [
        artist.instagramHandle ? { label: 'Instagram', value: `@${artist.instagramHandle}`, url: `https://instagram.com/${artist.instagramHandle}` } : null,
        artist.facebookProfileUrl ? { label: 'Facebook', value: artist.facebookProfileUrl, url: artist.facebookProfileUrl } : null,
        artist.publicContactEmail ? { label: 'Public email', value: artist.publicContactEmail, url: `mailto:${artist.publicContactEmail}` } : null,
      ].filter((x): x is { label: string; value: string; url: string } => x !== null);

      if (links.length === 0) return <Body text={null} empty="No social links yet." />;
      return (
        <View style={styles.linkList}>
          {links.map((link) => (
            <Pressable
              key={link.label}
              onPress={() => void Linking.openURL(link.url)}
              accessibilityRole="link"
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            >
              <Text style={styles.linkLabel}>{link.label.toUpperCase()}</Text>
              <Text style={styles.linkValue} numberOfLines={1}>
                {link.value}
              </Text>
              <Feather name="external-link" size={14} color={colors.fgMuted} />
            </Pressable>
          ))}
        </View>
      );
    }

    case 'public-presence':
      return (
        <View style={styles.linkList}>
          {artist.publishedAt && artist.publicSlug ? (
            <LinkOut label="Public page" url={publicPageUrl(artist.publicSlug)} />
          ) : (
            <Body text={null} empty="Your public page isn't published yet. Publish it from the editor." />
          )}
          <LinkOut label="Flash gallery" url={flashGalleryUrl(artist.user.studio.slug, artist.id)} />
        </View>
      );

    case 'specialties':
      return artist.specialties.length > 0 ? (
        <View style={styles.chips}>
          {artist.specialties.map((s) => (
            <View key={s} style={styles.chip}>
              <Text style={styles.chipLabel}>{s}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Body text={null} empty="No specialties listed." />
      );

    case 'services': {
      const names = serviceNames(artist, data.services);
      if (artist.artistServices.length === 0) return <Body text={null} empty="No services tagged yet." />;
      // A tagged service whose name hasn't loaded is still a fact worth
      // stating — silently showing fewer chips than are really tagged
      // would misrepresent the profile.
      if (names.length === 0) {
        return <Body text={null} empty={`${artist.artistServices.length} tagged — names couldn't be loaded.`} />;
      }
      return (
        <View style={styles.chips}>
          {names.map((name) => (
            <View key={name} style={styles.chip}>
              <Text style={styles.chipLabel}>{name}</Text>
            </View>
          ))}
        </View>
      );
    }

    case 'preferred-schedule': {
      const days = scheduleDaysFrom(artist.preferredSchedule);
      const any = days.some(Boolean);
      return (
        <>
          <Hint>Advisory availability only — it doesn't block scheduling, it tells staff when you'd rather work.</Hint>
          {any ? (
            <View style={styles.scheduleList}>
              {days.map((block, index) => (
                <View key={WEEKDAY_LABELS[index]} style={styles.scheduleRow}>
                  <Text style={[styles.scheduleDay, !block && styles.scheduleDayOff]}>{WEEKDAY_LABELS[index]}</Text>
                  <Text style={[styles.scheduleHours, !block && styles.scheduleDayOff]}>
                    {block ? `${formatClockTime(block.startTime)} – ${formatClockTime(block.endTime)}` : 'Unavailable'}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Body text={null} empty="No preferred hours set." />
          )}
        </>
      );
    }

    case 'portfolio':
      return artist.portfolioImages.length > 0 ? (
        <View style={styles.grid}>
          {artist.portfolioImages.map((url, index) => (
            <Image
              key={`${url}-${index}`}
              source={{ uri: url }}
              style={styles.tile}
              contentFit="cover"
              transition={120}
            />
          ))}
        </View>
      ) : (
        <Body text={null} empty="No portfolio images yet." />
      );
  }
}

const FLASH_REVIEW_LABELS: Record<string, string> = {
  ARTIST: 'You review each request',
  STUDIO: 'Front desk reviews each request',
  NONE: 'No review — instant booking',
};

function Hint({ children }: { children: string }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/** A value, or the sentence that says why there isn't one. Never a bare dash. */
function Body({ text, empty }: { text: string | null | undefined; empty: string }) {
  const has = !!text && text.trim().length > 0;
  return <Text style={[styles.body, !has && styles.bodyEmpty]}>{has ? text : empty}</Text>;
}

function LinkOut({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
    >
      <Text style={styles.linkLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.linkValue} numberOfLines={1}>
        {url}
      </Text>
      <Feather name="external-link" size={14} color={colors.fgMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },

  editButton: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.button,
  },
  editLabel: { ...type.button, fontSize: 12, color: colors.accent },

  identity: { flexDirection: 'row', gap: space.lg, paddingVertical: space.xl },
  avatar: { width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.surface },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
  },
  avatarInitial: { ...type.display, color: colors.accent },
  identityText: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.fg },
  contact: { ...type.small, color: colors.fgSecondary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },

  reorderToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    paddingVertical: space.sm,
    paddingBottom: space.lg,
  },
  reorderLabel: { ...type.label, color: colors.fgMuted },

  hint: { ...type.meta, color: colors.fgMuted, paddingBottom: space.sm },
  body: { ...type.body, color: colors.fg },
  bodyEmpty: { color: colors.fgMuted },
  subBlock: { paddingTop: space.lg, gap: space.xs },

  linkList: { gap: space.sm },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surfaceInset,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  linkLabel: { ...type.label, color: colors.fgMuted },
  linkValue: { ...type.small, color: colors.fg, flex: 1 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  chipLabel: { ...type.small, color: colors.fgSecondary },

  scheduleList: { gap: space.xs },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.xs },
  scheduleDay: { ...type.label, color: colors.accent, width: 36 },
  scheduleDayOff: { color: colors.fgMuted },
  scheduleHours: { ...type.body, color: colors.fg },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: 104, height: 104, borderRadius: radius.card, backgroundColor: colors.surfaceInset },

  pressed: { opacity: 0.6 },
});

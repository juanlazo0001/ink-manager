import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CheckListField,
  ChipsField,
  RadioField,
  SwitchField,
  TextField,
} from '@/components/form/Fields';
import { FormScreen, useUnsavedChangesGuard } from '@/components/form/FormScreen';
import { AvatarField, ImageGridField } from '@/components/form/ImageFields';
import { ProfileSection } from '@/components/ProfileSection';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Eyebrow, ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ARTIST_LAYOUT_PAGE_KEY, useArtistProfileData } from '@/hooks/useArtistProfileData';
import { ApiError } from '@/lib/api';
import {
  artistPatchFrom,
  flashGalleryUrl,
  moveSection,
  normalizeClockTime,
  profileFormFrom,
  publicPageUrl,
  scheduleBlocksFrom,
  scheduleDaysFrom,
  SECTION_TITLES,
  WEEKDAY_LABELS,
  type ArtistSectionId,
  type ProfileFormValues,
  type ScheduleDays,
} from '@/lib/artistProfile';
import {
  saveArtistProfile,
  savePreferredSchedule,
  saveWidgetLayout,
  setProfileDelegation,
  setPublished,
  setSelfScheduling,
  updateAccount,
} from '@/lib/artists';
import { screenErrorMessage } from '@/lib/screenError';
import { rules, useForm } from '@/lib/useForm';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The artist profile editor — every field an artist can change about
 * themselves, in the sections and the order web uses.
 *
 * The shape of this screen is dictated by the API, not by taste: the
 * profile is NOT one resource behind one write. The nine sections save
 * together through `PATCH /artists/:id`, but the weekly schedule, the two
 * policy switches, the public page and the account fields each have their
 * own route and their own permission. So the main Save covers the
 * document, and the things that aren't part of it say so and act
 * immediately, rather than being folded into a save that would silently
 * drop them.
 */

/**
 * Validation, mirroring what web and the API enforce. Rates and buffer
 * are the only numeric fields, and blank is a legitimate value for every
 * one of these — "unset" is a real state, not an error.
 */
function validateProfile(values: ProfileFormValues) {
  const errors: Partial<Record<keyof ProfileFormValues, string>> = {};
  const hourly = rules.money(values.hourlyRate, 'Hourly rate');
  if (hourly) errors.hourlyRate = hourly;
  const flat = rules.money(values.flatRate, 'Flat rate');
  if (flat) errors.flatRate = flat;
  const buffer = rules.minutes(values.schedulingBufferMinutes, 'Buffer');
  if (buffer) errors.schedulingBufferMinutes = buffer;
  const email = rules.email(values.publicContactEmail, 'Public contact email');
  if (email) errors.publicContactEmail = email;
  const facebook = values.facebookProfileUrl.trim() ? rules.url(values.facebookProfileUrl, 'Facebook profile URL') : undefined;
  if (facebook) errors.facebookProfileUrl = facebook;
  const bio = rules.maxLength(values.bio, 5000, 'Bio');
  if (bio) errors.bio = bio;
  return errors;
}

interface AccountValues extends Record<string, unknown> {
  name: string;
  phone: string;
  avatarUrl: string | null;
}

export default function ProfileEditScreen() {
  const router = useRouter();
  const { session, applyProfile } = useAuth();
  const data = useArtistProfileData();

  const token = session?.token ?? null;
  const artist = data.artist;

  const form = useForm<ProfileFormValues>(EMPTY_PROFILE, validateProfile);
  const account = useForm<AccountValues>({ name: '', phone: '', avatarUrl: null });
  const [schedule, setSchedule] = useState<ScheduleDays>(() => scheduleDaysFrom(null));
  const [scheduleBaseline, setScheduleBaseline] = useState<string>('');
  const [order, setOrder] = useState<ArtistSectionId[]>(data.order);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [seededId, setSeededId] = useState<string | null>(null);

  // Section-level state that saves on its own, each with its own busy and
  // error, because each is its own request against its own permission.
  const [delegation, setDelegation] = useState(false);
  const [selfScheduling, setSelfSchedulingState] = useState(false);
  const [sideBusy, setSideBusy] = useState<string | null>(null);
  const [sideError, setSideError] = useState<{ key: string; message: string } | null>(null);
  const [slug, setSlug] = useState('');

  // Seeded once per artist, not on every refetch: a save returns the
  // artist and re-seeding from it mid-edit would clobber whatever else
  // the person had already changed.
  if (artist && artist.id !== seededId) {
    setSeededId(artist.id);
    form.reset(profileFormFrom(artist));
    account.reset({
      name: artist.user.name ?? '',
      phone: artist.user.phone ?? '',
      avatarUrl: artist.user.avatarUrl,
    });
    const days = scheduleDaysFrom(artist.preferredSchedule);
    setSchedule(days);
    setScheduleBaseline(JSON.stringify(days));
    setDelegation(artist.memberships[0]?.allowsStudioProfileEdits ?? false);
    setSelfSchedulingState(artist.allowsClientSelfScheduling);
    setSlug(artist.publicSlug ?? '');
  }

  useEffect(() => {
    setOrder(data.order);
    setCollapsed(data.collapsed);
  }, [data.order, data.collapsed]);

  const dirty = form.dirty || account.dirty;

  const persistLayout = useCallback(
    (nextOrder: ArtistSectionId[], nextCollapsed: string[]) => {
      setOrder(nextOrder);
      setCollapsed(nextCollapsed);
      data.setLayout({ order: nextOrder, collapsed: nextCollapsed });
      if (!token) return;
      saveWidgetLayout(token, ARTIST_LAYOUT_PAGE_KEY, {
        widgetOrder: nextOrder,
        collapsedWidgetIds: nextCollapsed,
      }).catch(() => {});
    },
    [data, token],
  );

  async function handleSave() {
    if (!token || !artist) return;
    if (!form.validate()) {
      form.setFormError('Fix the highlighted fields, then save again.');
      return;
    }

    setSaving(true);
    setSavedNote(null);
    try {
      // Account first: if it fails, nothing about the profile document
      // has been touched yet, so there is no half-saved state to explain.
      if (account.dirty) {
        const profile = await updateAccount(token, {
          name: account.values.name.trim() || null,
          phone: account.values.phone.trim() || null,
          avatarUrl: account.values.avatarUrl,
        });
        applyProfile(profile);
        account.commit(account.values);
      }

      const updated = await saveArtistProfile(token, artist.id, artistPatchFrom(form.values));
      data.applyArtist(updated);
      form.commit(profileFormFrom(updated));
      setSavedNote('Saved.');
    } catch (err) {
      form.setFormError(err instanceof ApiError ? err.message : screenErrorMessage(err, 'your profile'));
    } finally {
      setSaving(false);
    }
  }

  const scheduleDirty = JSON.stringify(schedule) !== scheduleBaseline;

  // The guard covers the schedule too, even though the save bar does not:
  // the schedule has its own button and is genuinely not part of Save, but
  // edited-and-unsaved hours are exactly as easy to lose to a back swipe
  // as anything else on this screen.
  useUnsavedChangesGuard(dirty || scheduleDirty);

  async function handleSaveSchedule() {
    if (!token || !artist) return;
    setSideBusy('schedule');
    setSideError(null);
    try {
      const updated = await savePreferredSchedule(token, artist.id, scheduleBlocksFrom(schedule));
      data.applyArtist(updated);
      setScheduleBaseline(JSON.stringify(schedule));
    } catch (err) {
      setSideError({ key: 'schedule', message: sideMessage(err, 'setting your own schedule') });
    } finally {
      setSideBusy(null);
    }
  }

  async function handleDelegation(next: boolean) {
    if (!token || !artist) return;
    setSideBusy('delegation');
    setSideError(null);
    setDelegation(next);
    try {
      await setProfileDelegation(token, artist.id, next);
    } catch (err) {
      setDelegation(!next);
      setSideError({ key: 'delegation', message: sideMessage(err, 'that setting') });
    } finally {
      setSideBusy(null);
    }
  }

  async function handleSelfScheduling(next: boolean) {
    if (!token || !artist) return;
    setSideBusy('self-scheduling');
    setSideError(null);
    setSelfSchedulingState(next);
    try {
      const updated = await setSelfScheduling(token, artist.id, next);
      data.applyArtist(updated);
    } catch (err) {
      setSelfSchedulingState(!next);
      setSideError({ key: 'self-scheduling', message: sideMessage(err, 'self-scheduling') });
    } finally {
      setSideBusy(null);
    }
  }

  async function handlePublish(publish: boolean) {
    if (!token || !artist) return;
    setSideBusy('publish');
    setSideError(null);
    try {
      const updated = await setPublished(
        token,
        artist.id,
        publish ? { publish: true, publicSlug: slug.trim() } : { publish: false },
      );
      data.applyArtist(updated);
      setSlug(updated.publicSlug ?? '');
    } catch (err) {
      setSideError({ key: 'publish', message: sideMessage(err, 'your public page') });
    } finally {
      setSideBusy(null);
    }
  }

  if (data.loading && !artist) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Edit profile" onBack={() => router.back()} right={<View />} />
        <ScreenLoading />
      </SafeAreaView>
    );
  }

  if (!artist) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Edit profile" onBack={() => router.back()} right={<View />} />
        <StateMessage
          eyebrow={data.noArtistProfile ? 'No artist profile' : 'Not available'}
          tone={data.noArtistProfile ? 'neutral' : 'alert'}
          title={data.noArtistProfile ? "This account isn't an artist profile" : "Your profile didn't load"}
          body={data.noArtistProfile ? 'There is nothing here to edit.' : (data.error ?? undefined)}
          action={data.noArtistProfile ? undefined : { label: 'Try again', onPress: data.reload }}
        />
      </SafeAreaView>
    );
  }

  const isCollapsed = (id: ArtistSectionId) => collapsed.includes(id);
  const toggleCollapsed = (id: ArtistSectionId) =>
    persistLayout(order, isCollapsed(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);

  // An arrow declared after the not-loaded guard above, not a hoisted
  // `function` — hoisting would put it before the guard and lose the
  // narrowing that makes `artist` non-null here.
  const sectionBody = (id: ArtistSectionId) => {
    switch (id) {
      case 'bio':
        return (
          <TextField
            label="Bio"
            hideLabel
            value={form.values.bio}
            onChange={(v) => form.setField('bio', v)}
            error={form.errors.bio}
            placeholder="A short bio about you…"
            multiline
          />
        );

      case 'rates':
        return (
          <>
            <Hint>
              Reference rates only. When you're assigned to an estimate these suggest a starting price that staff can
              freely override.
            </Hint>
            <TextField
              label="Hourly rate"
              value={form.values.hourlyRate}
              onChange={(v) => form.setField('hourlyRate', v)}
              error={form.errors.hourlyRate}
              keyboardType="decimal-pad"
              prefix="$"
              placeholder="0.00"
            />
            <TextField
              label="Flat rate"
              value={form.values.flatRate}
              onChange={(v) => form.setField('flatRate', v)}
              error={form.errors.flatRate}
              keyboardType="decimal-pad"
              prefix="$"
              placeholder="0.00"
            />
          </>
        );

      case 'scheduling-buffer':
        return (
          <>
            <Hint>
              Minimum gap flagged as a possible conflict when booking you. Overrides your studio's default — leave
              blank to just use that default.
            </Hint>
            <TextField
              label="Buffer (minutes)"
              value={form.values.schedulingBufferMinutes}
              onChange={(v) => form.setField('schedulingBufferMinutes', v)}
              error={form.errors.schedulingBufferMinutes}
              keyboardType="number-pad"
              placeholder="Studio default"
            />

            <View style={styles.divider} />
            <Hint>
              When a client accepts your estimate, let them pick from your suggested availability instead of waiting
              for staff. Their pick only creates a pending request — staff still confirms it.
            </Hint>
            <SwitchField
              label="Let clients self-schedule with me"
              value={selfScheduling}
              onChange={(v) => void handleSelfScheduling(v)}
              disabled={!session?.profile.isSoloStudioArtist || sideBusy === 'self-scheduling'}
              disabledNote={
                session?.profile.isSoloStudioArtist
                  ? undefined
                  : 'Your studio manages this — ask an owner to enable it for you.'
              }
            />
            <SideNote busy={sideBusy === 'self-scheduling'} error={sideError} forKey="self-scheduling" saveNote="Saved on its own — this one isn't part of Save." />

            <View style={styles.divider} />
            {/* Self-only on the API, with no staff bypass at all: this is
                the artist's own call on their own art. */}
            <RadioField
              label="Flash booking review"
              value={form.values.flashReviewMode}
              onChange={(v) => form.setField('flashReviewMode', v)}
              options={[
                {
                  value: 'ARTIST',
                  label: 'You review each request',
                  description:
                    'You review the placement photo and approve or decline before they can pay. Yours alone to decide.',
                },
                {
                  value: 'STUDIO',
                  label: 'Front desk reviews each request',
                  description: "Requests go to front desk's task queue instead of yours.",
                },
                {
                  value: 'NONE',
                  label: 'No review — instant booking',
                  description: 'The payment link goes out right away.',
                },
              ]}
            />
          </>
        );

      case 'social-links':
        return (
          <>
            <TextField
              label="Instagram handle"
              value={form.values.instagramHandle}
              onChange={(v) => form.setField('instagramHandle', v)}
              prefix="@"
              placeholder="studioname"
              autoCapitalize="none"
            />
            <TextField
              label="Facebook profile URL"
              value={form.values.facebookProfileUrl}
              onChange={(v) => form.setField('facebookProfileUrl', v)}
              error={form.errors.facebookProfileUrl}
              placeholder="https://facebook.com/studioname"
              autoCapitalize="none"
              keyboardType="url"
            />
            <TextField
              label="Public contact email"
              value={form.values.publicContactEmail}
              onChange={(v) => form.setField('publicContactEmail', v)}
              error={form.errors.publicContactEmail}
              hint="Optional — shown to clients on your public page. Separate from your login email, which is never shown publicly."
              placeholder="artist@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </>
        );

      case 'public-presence':
        return (
          <>
            <TextField
              label="Page URL"
              value={slug}
              onChange={setSlug}
              prefix="/artist/"
              placeholder="your-name"
              autoCapitalize="none"
              editable={sideBusy !== 'publish'}
              hint={artist.publishedAt ? undefined : 'Choose a URL, then publish.'}
            />
            <View style={styles.actionRow}>
              <SmallButton
                label={artist.publishedAt ? 'Update & republish' : 'Publish'}
                onPress={() => void handlePublish(true)}
                disabled={!slug.trim() || sideBusy === 'publish'}
                primary
              />
              {artist.publishedAt ? (
                <SmallButton
                  label="Unpublish"
                  onPress={() => void handlePublish(false)}
                  disabled={sideBusy === 'publish'}
                />
              ) : null}
            </View>
            <SideNote busy={sideBusy === 'publish'} error={sideError} forKey="publish" saveNote="Publishing takes effect immediately — it isn't part of Save." />
            {artist.publishedAt && artist.publicSlug ? (
              <Text style={styles.urlLine}>{publicPageUrl(artist.publicSlug)}</Text>
            ) : null}
            <Text style={styles.urlLine}>{flashGalleryUrl(artist.user.studio.slug, artist.id)}</Text>
          </>
        );

      case 'specialties':
        return (
          <ChipsField
            label="Specialties"
            hideLabel
            values={form.values.specialties}
            onChange={(v) => form.setField('specialties', v)}
            placeholder="Add a specialty"
          />
        );

      case 'services':
        return (
          <>
            <Hint>
              Which of your studio's services you practise — only artists tagged here appear as options for an
              inquiry in that service.
            </Hint>
            <CheckListField
              label="Services offered"
              hideLabel
              // An inactive service the artist is still tagged with stays
              // listed so it can be removed; a newly inactive one is not
              // silently dropped from their profile.
              options={data.services
                .filter((s) => s.isActive || form.values.serviceIds.includes(s.id))
                .map((s) => ({ id: s.id, label: s.isActive ? s.name : `${s.name} (inactive)` }))}
              selected={form.values.serviceIds}
              onChange={(v) => form.setField('serviceIds', v)}
            />
          </>
        );

      case 'preferred-schedule':
        return (
          <>
            <Hint>Advisory availability only — it doesn't block scheduling, it tells staff when you'd rather work.</Hint>
            <View style={styles.scheduleList}>
              {schedule.map((block, index) => (
                <ScheduleRow
                  key={WEEKDAY_LABELS[index]}
                  label={WEEKDAY_LABELS[index]}
                  block={block}
                  onChange={(next) =>
                    setSchedule((current) => current.map((b, i) => (i === index ? next : b)))
                  }
                />
              ))}
            </View>
            <View style={styles.actionRow}>
              <SmallButton
                label="Save schedule"
                onPress={() => void handleSaveSchedule()}
                disabled={!scheduleDirty || sideBusy === 'schedule'}
                primary
              />
            </View>
            <SideNote busy={sideBusy === 'schedule'} error={sideError} forKey="schedule" saveNote="Your schedule saves separately — it has its own permission." />
          </>
        );

      case 'portfolio':
        return (
          <ImageGridField
            label="Portfolio"
            hideLabel
            hint="Photos upload as you add them. The list itself is saved with the rest of your profile."
            token={token ?? ''}
            purpose="portfolio"
            urls={form.values.portfolioImages}
            onChange={(v) => form.setField('portfolioImages', v)}
          />
        );
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader
        title="Edit profile"
        subtitle={dirty ? 'Unsaved changes' : undefined}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => setReordering((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={reordering ? 'Done reordering' : 'Reorder sections'}
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Feather name={reordering ? 'check' : 'move'} size={16} color={colors.accent} />
          </Pressable>
        }
      />

      <FormScreen
        dirty={dirty}
        saving={saving}
        error={form.formError}
        note={savedNote}
        onSave={() => void handleSave()}
        onDiscard={() => {
          form.reset();
          account.reset();
          setSavedNote(null);
        }}
        saveLabel="Save changes"
      >
        <View style={styles.accountBlock}>
          <Eyebrow>Account</Eyebrow>
          <AvatarField
            label="Profile photo"
            value={account.values.avatarUrl}
            fallbackInitials={(account.values.name || artist.user.email).slice(0, 1).toUpperCase()}
            onChange={(next) => account.setField('avatarUrl', next)}
          />
          <TextField
            label="Name"
            value={account.values.name}
            onChange={(v) => account.setField('name', v)}
            autoCapitalize="words"
          />
          <TextField
            label="Phone"
            value={account.values.phone}
            onChange={(v) => account.setField('phone', v)}
            keyboardType="phone-pad"
          />
          <Text style={styles.hint}>
            Your email and password change from the web app — both need a confirmation step this screen doesn't have.
          </Text>

          <View style={styles.divider} />
          <SwitchField
            label="Let studio staff edit my profile"
            description="Staff can update your bio, rates, specialties, services and portfolio on your behalf."
            value={delegation}
            onChange={(v) => void handleDelegation(v)}
            disabled={sideBusy === 'delegation'}
          />
          <SideNote busy={sideBusy === 'delegation'} error={sideError} forKey="delegation" saveNote="Saved on its own — this one isn't part of Save." />
        </View>

        {order.map((id, index) => (
          <ProfileSection
            key={id}
            title={SECTION_TITLES[id]}
            collapsed={isCollapsed(id)}
            onToggleCollapse={() => toggleCollapsed(id)}
            reordering={reordering}
            onMoveUp={index > 0 ? () => persistLayout(moveSection(order, id, -1), collapsed) : undefined}
            onMoveDown={index < order.length - 1 ? () => persistLayout(moveSection(order, id, 1), collapsed) : undefined}
            summary={form.dirtyFields.includes(FIELD_FOR_SECTION[id] as keyof ProfileFormValues) ? 'Edited' : null}
          >
            {sectionBody(id)}
          </ProfileSection>
        ))}
      </FormScreen>
    </SafeAreaView>
  );
}

/** One representative field per section, for the collapsed "Edited" marker. */
const FIELD_FOR_SECTION: Record<ArtistSectionId, keyof ProfileFormValues | null> = {
  bio: 'bio',
  rates: 'hourlyRate',
  'scheduling-buffer': 'schedulingBufferMinutes',
  'social-links': 'instagramHandle',
  'public-presence': null,
  specialties: 'specialties',
  services: 'serviceIds',
  'preferred-schedule': null,
  portfolio: 'portfolioImages',
};

const EMPTY_PROFILE: ProfileFormValues = {
  bio: '',
  hourlyRate: '',
  flatRate: '',
  schedulingBufferMinutes: '',
  flashReviewMode: 'ARTIST',
  instagramHandle: '',
  facebookProfileUrl: '',
  publicContactEmail: '',
  specialties: [],
  serviceIds: [],
  portfolioImages: [],
};

/**
 * One day of the weekly schedule: available or not, and if so, from when
 * to when.
 *
 * Plain text entry rather than a picker. `ScheduleBlock` holds a wall
 * clock string in the studio's own zone, and every native time picker
 * hands back a `Date` — an instant in the device's zone, which is a
 * different kind of value and the exact conversion this repo has got
 * wrong four separate times. Typing "9:30" writes "09:30" and nothing
 * ever becomes a Date.
 */
function ScheduleRow({
  label,
  block,
  onChange,
}: {
  label: string;
  block: { dayOfWeek: number; startTime: string; endTime: string } | null;
  onChange: (next: { dayOfWeek: number; startTime: string; endTime: string } | null) => void;
}) {
  const [start, setStart] = useState(block?.startTime ?? '');
  const [end, setEnd] = useState(block?.endTime ?? '');

  function commit(nextStart: string, nextEnd: string) {
    const s = normalizeClockTime(nextStart);
    const e = normalizeClockTime(nextEnd);
    // Both ends must parse before this is a block at all. A half-typed
    // row stays local rather than writing an invalid one the route would
    // reject on save.
    onChange(s && e ? { dayOfWeek: 0, startTime: s, endTime: e } : null);
  }

  const on = block !== null;

  return (
    <View style={styles.scheduleRow}>
      <Pressable
        onPress={() => {
          if (on) {
            onChange(null);
          } else {
            const s = normalizeClockTime(start) ?? '10:00';
            const e = normalizeClockTime(end) ?? '18:00';
            setStart(s);
            setEnd(e);
            onChange({ dayOfWeek: 0, startTime: s, endTime: e });
          }
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={label}
        style={({ pressed }) => [styles.dayToggle, on && styles.dayToggleOn, pressed && styles.pressed]}
      >
        <Text style={[styles.dayLabel, on && styles.dayLabelOn]}>{label.toUpperCase()}</Text>
      </Pressable>

      {on ? (
        <View style={styles.timeInputs}>
          <TimeInput
            label={`${label} start`}
            value={start}
            onChange={(v) => {
              setStart(v);
              commit(v, end);
            }}
          />
          <Text style={styles.timeDash}>–</Text>
          <TimeInput
            label={`${label} end`}
            value={end}
            onChange={(v) => {
              setEnd(v);
              commit(start, v);
            }}
          />
        </View>
      ) : (
        <Text style={styles.unavailable}>Unavailable</Text>
      )}
    </View>
  );
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.timeBox}>
      <TextField label={label} value={value} onChange={onChange} placeholder="09:00" keyboardType="numbers-and-punctuation" />
    </View>
  );
}

function Hint({ children }: { children: string }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/**
 * The line under a control that saves on its own. It says which state it
 * is in AND that it is not part of the main Save — a switch that has
 * already written while a Save bar sits below it is otherwise genuinely
 * confusing.
 */
function SideNote({
  busy,
  error,
  forKey,
  saveNote,
}: {
  busy: boolean;
  error: { key: string; message: string } | null;
  forKey: string;
  saveNote: string;
}) {
  if (busy) return <Text style={styles.hint}>Saving…</Text>;
  if (error && error.key === forKey) {
    return (
      <Text style={styles.error} accessibilityRole="alert">
        {error.message}
      </Text>
    );
  }
  return <Text style={styles.hint}>{saveNote}</Text>;
}

function SmallButton({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.smallButton,
        primary && styles.smallButtonPrimary,
        disabled && styles.inactive,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.smallButtonLabel, primary && styles.smallButtonLabelPrimary]}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

/**
 * A 403 from these routes is a real answer, and usually one written for a
 * person: `/self-scheduling` replies "Self-scheduling is managed by your
 * studio -- ask an owner to enable it for you", which is far more useful
 * than any sentence this client could invent.
 *
 * The exception is the bare word "Forbidden", which
 * `/preferred-schedule` returns when a studio has revoked
 * `artistSchedules.manage` from ARTIST. Shown as-is it tells the person
 * nothing at all — so that one, and only that one, falls through to the
 * shared role sentence. Same shape as `loginErrorMessage`'s handling of
 * the one machine-written login error.
 */
function sideMessage(err: unknown, subject: string): string {
  if (err instanceof ApiError && err.fromApi && err.message.trim().toLowerCase() !== 'forbidden') {
    return err.message;
  }
  return screenErrorMessage(err, subject);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  accountBlock: { paddingTop: space.lg, paddingBottom: space.lg },
  accentTitle: { color: colors.accent },
  hint: { ...type.meta, color: colors.fgMuted, paddingVertical: space.xs },
  error: { ...type.meta, color: colors.danger, paddingVertical: space.xs },
  divider: { height: hairline, backgroundColor: colors.borderSoft, marginVertical: space.lg },

  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
  },

  actionRow: { flexDirection: 'row', gap: space.sm, paddingTop: space.md },
  smallButton: {
    paddingHorizontal: space.lg,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.button,
  },
  smallButtonPrimary: { backgroundColor: colors.accentButton, borderColor: colors.accentButton },
  smallButtonLabel: { ...type.button, fontSize: 12, color: colors.fgSecondary },
  smallButtonLabelPrimary: { color: colors.accentFg },
  inactive: { opacity: 0.4 },

  urlLine: { ...type.meta, color: colors.fgMuted, paddingTop: space.sm },

  scheduleList: { gap: space.xs, paddingTop: space.sm },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dayToggle: {
    width: 52,
    paddingVertical: space.sm,
    alignItems: 'center',
    borderWidth: hairline,
    borderColor: colors.borderSoft,
    borderRadius: radius.input,
  },
  dayToggleOn: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  dayLabel: { ...type.label, color: colors.fgMuted },
  dayLabelOn: { color: colors.accent },
  timeInputs: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  timeBox: { flex: 1 },
  timeDash: { ...type.body, color: colors.fgMuted },
  unavailable: { ...type.small, color: colors.fgMuted, flex: 1 },

  pressed: { opacity: 0.6 },
});

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FormDivider, RadioField, TextField } from '@/components/form/Fields';
import { ImageGridField } from '@/components/form/ImageFields';
import { FormScreen, useUnsavedChangesGuard } from '@/components/form/FormScreen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PhoneField } from '@/components/form/PhoneField';
import { ScreenShell } from '@/components/ScreenShell';
import { useAuth } from '@/context/auth';
import { artistLabel, fetchArtists, type ArtistOption } from '@/lib/artists';
import { createInquiry } from '@/lib/inquiries';
import { screenErrorMessage } from '@/lib/screenError';
import { useForm } from '@/lib/useForm';
import { space } from '@/theme';

/**
 * Log an inquiry — the Inquiries title row's action, and web's
 * `StaffInquiryForm` field for field.
 *
 * ─── WHY THIS EXISTS AS A SCREEN, NOT A MODAL ───────────────────────
 *
 * Web presents it in a `Modal`. It has fourteen inputs and two image
 * pickers; on a phone that is a scrolling page, and this app already has
 * exactly one idiom for "a long form you can leave" — `FormScreen` with
 * its unsaved-changes guard (client-edit, client-new, flash-piece). A
 * sheet that scrolls for three screenfuls is a page wearing a costume.
 *
 * ─── THE FIELD SET AND ITS RULES ARE WEB'S, NOTHING INVENTED ────────
 *
 * Required: first name, last name, email, channel, description, colour
 * choice, placement, estimated size, tattooed-before, and a referral
 * code when the channel is REFERRAL. Phone is optional but must be ten
 * digits if given (`isValidPhoneDigits`). At least one reference image
 * and at least one placement photo — both are web's own client-side
 * checks, and both match the server's `required: true` defaults.
 *
 * ─── THE CHANNEL LIST IS A DELIBERATE SUBSET ────────────────────────
 *
 * `Channel` has six values; web offers five here and hides REFERRAL
 * unless the studio runs a referral programme. FLASH_GALLERY is never
 * offered because staff cannot pick it — it is set only by the public
 * `POST /flash-pieces/:id/request` flow (the enum's own comment says so).
 * Same subset here, same condition.
 *
 * ─── WHAT IS DELIBERATELY NOT PORTED ────────────────────────────────
 *
 * Web's client-search box, which looks up an existing client as you type
 * a name or email and locks the contact fields to that record
 * (`existingClientId`). It is a second search surface with its own
 * matched/locked states, and leaving it out changes nothing about what
 * gets created: the server matches on email either way. Mobile's own
 * client list is one tap away for anyone who wants to check first.
 */

/** Web's own five, in web's own order and wording. */
const CHANNELS = [
  { value: 'PHONE', label: 'Phone / Walk-in' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'FACEBOOK', label: 'Facebook' },
] as const;

const REFERRAL_CHANNEL = { value: 'REFERRAL', label: 'A friend referred them' } as const;

const COLOUR_OPTIONS = [
  { value: 'Color', label: 'Color' },
  { value: 'Black & Grey', label: 'Black & Grey' },
] as const;

const TATTOOED_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

export default function InquiryNewScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [saving, setSaving] = useState(false);
  const [artists, setArtists] = useState<ArtistOption[]>([]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [placementImages, setPlacementImages] = useState<string[]>([]);

  /*
   * ─── OPTIONAL PREFILL, ADDITIVE ─────────────────────────────
   *
   * The client page can arrive here with the person already known, which
   * is web's `lockedClient` on its StaffInquiryForm. The Inquiries tab's
   * `+` passes nothing and is unchanged — the same additive shape
   * `client-new` took in session 15, and for the same reason: a screen
   * with one caller can grow parameters without a contract change.
   *
   * `clientId` rides along for the return trip rather than the form: the
   * create route resolves the client from the contact fields exactly as
   * it does for a walk-in, so passing an id into the body would be
   * inventing an API shape.
   */
  const params = useLocalSearchParams<{
    clientId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  }>();
  const fromClientId = params.clientId ?? null;

  const form = useForm(
    {
      firstName: params.firstName ?? '',
      lastName: params.lastName ?? '',
      email: params.email ?? '',
      phone: params.phone ?? '',
      channel: 'PHONE',
      referralCode: '',
      description: '',
      colorOrBlackGrey: '',
      placement: '',
      estimatedSize: '',
      hasBeenTattooedBefore: '',
      preferredArtistId: '',
      budget: '',
      desiredTiming: '',
    },
    (values) => {
      const errors: Record<string, string> = {};
      if (!values.firstName.trim()) errors.firstName = 'A first name is required.';
      if (!values.lastName.trim()) errors.lastName = 'A last name is required.';
      if (!values.email.trim()) errors.email = 'An email address is required.';
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) {
        errors.email = 'That does not look like an email address.';
      }
      // Web's rule exactly: blank is fine, ten digits is fine, nothing else.
      const digits = values.phone;
      if (digits.length > 0 && digits.length !== 10) {
        errors.phone = 'Enter a complete 10-digit phone number, or leave it blank.';
      }
      if (values.channel === 'REFERRAL' && !values.referralCode.trim()) {
        errors.referralCode = "The friend's referral code is required.";
      }
      if (!values.description.trim()) errors.description = 'Describe the tattoo.';
      if (!values.colorOrBlackGrey) errors.colorOrBlackGrey = 'Pick one.';
      if (!values.placement.trim()) errors.placement = 'Placement is required.';
      if (!values.estimatedSize.trim()) errors.estimatedSize = 'An estimated size is required.';
      if (!values.hasBeenTattooedBefore) errors.hasBeenTattooedBefore = 'Pick one.';
      return errors;
    },
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchArtists(token)
      .then((rows) => {
        if (!cancelled) setArtists(rows);
      })
      .catch(() => {
        // "No preference" is the default and still works — web leaves the
        // picker empty on failure rather than blocking the form.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const imagesDirty = referenceImages.length > 0 || placementImages.length > 0;
  useUnsavedChangesGuard(form.dirty || imagesDirty);

  async function save() {
    if (!token) return;
    if (!form.validate()) return;

    // The two image rules are web's, and they live outside `validate`
    // because the pickers hold their own state rather than form fields.
    if (referenceImages.length === 0) {
      form.setFormError('Please add at least one reference image.');
      return;
    }
    if (placementImages.length === 0) {
      form.setFormError('Please add at least one placement photo.');
      return;
    }

    setSaving(true);
    form.setFormError(null);
    try {
      const created = await createInquiry(token, {
        firstName: form.values.firstName.trim(),
        lastName: form.values.lastName.trim(),
        email: form.values.email.trim(),
        phone: form.values.phone.trim(),
        channel: form.values.channel,
        referralCode: form.values.referralCode.trim().toUpperCase(),
        description: form.values.description.trim(),
        colorOrBlackGrey: form.values.colorOrBlackGrey,
        placement: form.values.placement.trim(),
        estimatedSize: form.values.estimatedSize.trim(),
        hasBeenTattooedBefore: form.values.hasBeenTattooedBefore === 'yes',
        budget: form.values.budget.trim(),
        desiredTiming: form.values.desiredTiming.trim(),
        preferredArtistId: form.values.preferredArtistId,
        referenceImages,
        placementImages,
      });
      // Commit before navigating, or the guard fires leaving a screen
      // whose work is already saved.
      form.commit(form.values);
      setReferenceImages([]);
      setPlacementImages([]);
      /*
       * Arriving from a client page returns THERE, with the list picking
       * the new inquiry up on its focus refetch — web navigates to the
       * inquiry instead, but web keeps the client page open behind a
       * modal and mobile replaced it. Landing on a screen the operator
       * never left is the mobile equivalent of web's "the card now shows
       * it".
       */
      if (fromClientId) {
        router.replace({ pathname: '/client/[id]', params: { id: fromClientId } });
        return;
      }
      router.replace({ pathname: '/staff-inquiry/[id]', params: { id: created.id } });
    } catch (err) {
      // The server's own sentence when it disagrees — it knows this
      // studio's configured required fields and this form does not.
      form.setFormError(screenErrorMessage(err, 'That inquiry was not created.'));
      setSaving(false);
    }
  }

  const channelOptions = [
    ...CHANNELS,
    // Web hides this unless the studio runs a referral programme. Mobile
    // has no settings read here yet, so it is always offered — the server
    // resolves an unknown code by ignoring it, and hiding a channel the
    // studio does support would be the worse failure.
    REFERRAL_CHANNEL,
  ];

  return (
    <ScreenShell>
      <ScreenHeader title="New inquiry" onBack={() => router.back()} right={<View style={styles.spacer} />} />

      <FormScreen
        dirty={form.dirty || imagesDirty}
        saving={saving}
        error={form.formError}
        onSave={() => void save()}
        onDiscard={() => {
          form.reset();
          setReferenceImages([]);
          setPlacementImages([]);
        }}
        saveLabel="Create"
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextField
            label="First name"
            value={form.values.firstName}
            onChange={(v) => form.setField('firstName', v)}
            error={form.errors.firstName}
            autoCapitalize="words"
          />
          <TextField
            label="Last name"
            value={form.values.lastName}
            onChange={(v) => form.setField('lastName', v)}
            error={form.errors.lastName}
            autoCapitalize="words"
          />
          <TextField
            label="Email"
            value={form.values.email}
            onChange={(v) => form.setField('email', v)}
            error={form.errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <PhoneField
            label="Phone"
            value={form.values.phone}
            onChange={(digits) => form.setField('phone', digits)}
            error={form.errors.phone}
            hint="Optional."
          />

          <FormDivider />

          <RadioField
            label="How was this inquiry received?"
            options={channelOptions.map((c) => ({ value: c.value, label: c.label }))}
            value={form.values.channel}
            onChange={(v) => form.setField('channel', v)}
          />
          {form.values.channel === 'REFERRAL' ? (
            <TextField
              label="Friend's referral code"
              value={form.values.referralCode}
              onChange={(v) => form.setField('referralCode', v.toUpperCase())}
              error={form.errors.referralCode}
              placeholder="e.g. AB23CDE"
              autoCapitalize="none"
            />
          ) : null}

          <FormDivider />

          <TextField
            label="Describe the tattoo"
            value={form.values.description}
            onChange={(v) => form.setField('description', v)}
            error={form.errors.description}
            multiline
          />
          <RadioField
            label="Color or Black & Grey?"
            options={COLOUR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={form.values.colorOrBlackGrey}
            onChange={(v) => form.setField('colorOrBlackGrey', v)}
            hint={form.errors.colorOrBlackGrey}
          />
          <TextField
            label="Placement"
            value={form.values.placement}
            onChange={(v) => form.setField('placement', v)}
            error={form.errors.placement}
            placeholder="e.g. forearm, left side"
          />
          <TextField
            label="Estimated size"
            value={form.values.estimatedSize}
            onChange={(v) => form.setField('estimatedSize', v)}
            error={form.errors.estimatedSize}
            placeholder="e.g. palm-sized"
          />
          <RadioField
            label="Been tattooed before?"
            options={TATTOOED_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={form.values.hasBeenTattooedBefore}
            onChange={(v) => form.setField('hasBeenTattooedBefore', v)}
            hint={form.errors.hasBeenTattooedBefore}
          />

          <FormDivider />

          <RadioField
            label="Preferred artist"
            options={[
              { value: '', label: 'No preference' },
              ...artists.map((a) => ({ value: a.id, label: artistLabel(a) })),
            ]}
            value={form.values.preferredArtistId}
            onChange={(v) => form.setField('preferredArtistId', v)}
          />
          <TextField
            label="Budget"
            value={form.values.budget}
            onChange={(v) => form.setField('budget', v)}
            placeholder="e.g. $300-500"
          />
          <TextField
            label="Desired timing"
            value={form.values.desiredTiming}
            onChange={(v) => form.setField('desiredTiming', v)}
            placeholder="e.g. within a month"
          />

          <FormDivider />

          {token ? (
            <>
              <ImageGridField
                label="Reference images"
                hint="Photos or designs showing the style. At least one."
                token={token}
                purpose="inquiry"
                urls={referenceImages}
                onChange={setReferenceImages}
              />
              <ImageGridField
                label="Placement photos"
                hint="A photo of the area for the tattoo. At least one."
                token={token}
                purpose="inquiry"
                urls={placementImages}
                onChange={setPlacementImages}
              />
            </>
          ) : null}
        </ScrollView>
      </FormScreen>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  spacer: { width: 44 },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
});

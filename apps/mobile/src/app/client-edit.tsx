import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FormDivider, TextField } from '@/components/form/Fields';
import { FormScreen, useUnsavedChangesGuard } from '@/components/form/FormScreen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenShell } from '@/components/ScreenShell';
import { ScreenLoading, StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { clientName, fetchClient, type ClientDetail } from '@/lib/clients';
import { updateClient } from '@/lib/clientWrites';
import { screenErrorMessage } from '@/lib/screenError';
import { useForm } from '@/lib/useForm';
import { space } from '@/theme';

/**
 * Edit a client — the header's Edit action, and mobile's first editing
 * screen for a record it does not own.
 *
 * ─── THE FIELD SET IS THE API'S, NOT A CHOICE ───────────────────────
 *
 * `PATCH /clients/:id` walks `EDITABLE_CLIENT_FIELDS` and IGNORES
 * anything else in the body — silently, not with a 400. So a form that
 * offered a field the server does not take would appear to save and
 * quietly discard it. These are exactly that list, minus
 * `preferredLocale`, which is a picker over the supported-locale set and
 * belongs with the i18n work rather than bolted on here:
 *
 *   firstName, lastName, email, phone, instagramHandle,
 *   facebookProfileUrl, otherContact, address
 *
 * ─── VALIDATION MIRRORS WEB'S, NO STRICTER ──────────────────────────
 *
 * The server requires firstName and lastName to be non-empty strings and
 * accepts null for everything else. Web adds a ten-digit check on phone
 * (`isValidPhoneDigits`) and leans on `type="email"` for the address.
 * Anything tighter here would refuse records the portal accepts, which
 * is the wrong kind of disagreement between two clients of one API.
 *
 * The unsaved-changes guard is session B's, unchanged.
 */
export default function ClientEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const form = useForm(
    {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      instagramHandle: '',
      facebookProfileUrl: '',
      otherContact: '',
      address: '',
    },
    (values) => {
      const errors: Record<string, string> = {};
      if (!values.firstName.trim()) errors.firstName = 'A first name is required.';
      if (!values.lastName.trim()) errors.lastName = 'A last name is required.';
      const digits = values.phone.replace(/\D/g, '');
      if (values.phone.trim() && digits.length < 10) {
        errors.phone = 'That does not look like a complete phone number.';
      }
      if (values.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) {
        errors.email = 'That does not look like an email address.';
      }
      return errors;
    },
  );

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoadError(null);
    try {
      const next = await fetchClient(token, id);
      setClient(next);
      form.reset({
        firstName: next.firstName ?? '',
        lastName: next.lastName ?? '',
        email: next.email ?? '',
        phone: next.phone ?? '',
        instagramHandle: next.instagramHandle ?? '',
        facebookProfileUrl: next.facebookProfileUrl ?? '',
        otherContact: next.otherContact ?? '',
        address: next.address ?? '',
      });
    } catch (err) {
      setLoadError(screenErrorMessage(err, "That client couldn't be loaded."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useUnsavedChangesGuard(form.dirty);

  async function save() {
    if (!token || !id) return;
    if (!form.validate()) return;
    setSaving(true);
    setSaved(false);
    form.setFormError(null);
    try {
      // Only what changed. Sending the whole object would rewrite fields
      // nobody touched, and the audit trail records every one of them.
      const patch: Record<string, string | null> = {};
      for (const key of form.dirtyFields) {
        const value = String(form.values[key] ?? '').trim();
        patch[key as string] =
          key === 'firstName' || key === 'lastName' ? value : value || null;
      }
      const updated = await updateClient(token, id, patch);
      setClient(updated);
      form.commit(form.values);
      setSaved(true);
    } catch (err) {
      form.setFormError(screenErrorMessage(err, 'That change did not save.'));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <ScreenShell>
        <ScreenHeader title="Edit client" onBack={() => router.back()} right={<View style={styles.spacer} />} />
        <StateMessage
          eyebrow="Not loaded"
          title="That client couldn't be loaded"
          body={loadError}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      </ScreenShell>
    );
  }

  if (!client) {
    return (
      <ScreenShell>
        <ScreenHeader title="Edit client" onBack={() => router.back()} right={<View style={styles.spacer} />} />
        <ScreenLoading />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScreenHeader
        title={clientName(client)}
        subtitle="Edit"
        onBack={() => router.back()}
        right={<View style={styles.spacer} />}
      />

      <FormScreen
        dirty={form.dirty}
        saving={saving}
        error={form.formError}
        onSave={() => void save()}
        onDiscard={() => form.reset()}
        note={saved && !form.dirty ? 'Saved' : null}
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

          <FormDivider />

          <TextField
            label="Email"
            value={form.values.email}
            onChange={(v) => form.setField('email', v)}
            error={form.errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            hint="The primary address. Others live in Contact info."
          />
          <TextField
            label="Phone"
            value={form.values.phone}
            onChange={(v) => form.setField('phone', v)}
            error={form.errors.phone}
            keyboardType="phone-pad"
            hint="The primary number. Others live in Contact info."
          />

          <FormDivider />

          <TextField
            label="Instagram"
            value={form.values.instagramHandle}
            onChange={(v) => form.setField('instagramHandle', v)}
            placeholder="@handle"
            autoCapitalize="none"
          />
          <TextField
            label="Facebook"
            value={form.values.facebookProfileUrl}
            onChange={(v) => form.setField('facebookProfileUrl', v)}
            placeholder="Profile URL"
            autoCapitalize="none"
          />
          <TextField
            label="Other contact"
            value={form.values.otherContact}
            onChange={(v) => form.setField('otherContact', v)}
          />
          <TextField
            label="Address"
            value={form.values.address}
            onChange={(v) => form.setField('address', v)}
            multiline
          />
        </ScrollView>
      </FormScreen>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  spacer: { width: 44 },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
});

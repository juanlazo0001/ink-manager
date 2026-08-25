import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FormDivider, TextField } from '@/components/form/Fields';
import { FormScreen, useUnsavedChangesGuard } from '@/components/form/FormScreen';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenShell } from '@/components/ScreenShell';
import { useAuth } from '@/context/auth';
import { createClient } from '@/lib/clientWrites';
import { screenErrorMessage } from '@/lib/screenError';
import { useForm } from '@/lib/useForm';
import { space } from '@/theme';

/**
 * Add a client — the Clients title row's `+`.
 *
 * ─── FOUR FIELDS, BECAUSE THAT IS WHAT THE ROUTE READS ──────────────
 *
 * `POST /clients` destructures `{ firstName, lastName, email, phone,
 * address }` and requires the two names. Web's own Add Client modal
 * offers the first four and leaves address to the edit form afterwards;
 * this does the same, so a record created on a phone and one created in
 * the portal are the same record. Everything else on a client —
 * Instagram, Facebook, additional numbers — is reachable the moment the
 * record exists, from Edit and Contact info.
 *
 * ─── VALIDATION IS WEB'S, TO THE DIGIT ──────────────────────────────
 *
 * `isValidPhoneDigits` accepts an empty string or exactly ten digits, and
 * web blocks the submit on anything else. The same rule, and the same
 * shape check on email that the edit screen uses, so the two mobile
 * client forms cannot disagree about what a valid phone number is.
 *
 * The screen is gated behind `clients.edit` at its entry point rather
 * than here: the `+` is simply absent without the permission, which is
 * how web hides its own Add Client button (`canAddClient`).
 */
export default function ClientNewScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [saving, setSaving] = useState(false);

  const form = useForm(
    { firstName: '', lastName: '', email: '', phone: '' },
    (values) => {
      const errors: Record<string, string> = {};
      if (!values.firstName.trim()) errors.firstName = 'A first name is required.';
      if (!values.lastName.trim()) errors.lastName = 'A last name is required.';
      const digits = values.phone.replace(/\D/g, '');
      if (values.phone.trim() && digits.length !== 10) {
        errors.phone = 'Enter a complete 10-digit phone number.';
      }
      if (values.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) {
        errors.email = 'That does not look like an email address.';
      }
      return errors;
    },
  );

  useUnsavedChangesGuard(form.dirty);

  async function save() {
    if (!token) return;
    if (!form.validate()) return;
    setSaving(true);
    form.setFormError(null);
    try {
      const created = await createClient(token, {
        firstName: form.values.firstName.trim(),
        lastName: form.values.lastName.trim(),
        email: form.values.email.trim(),
        phone: form.values.phone.trim(),
      });
      // Commit before navigating, or the unsaved-changes guard fires on
      // the way out of a screen whose work is already saved.
      form.commit(form.values);
      // Replace, not push: the new client's own screen is where this ends,
      // and a back gesture from there should reach the list, not a form
      // for a client that now exists.
      router.replace({ pathname: '/client/[id]', params: { id: created.id } });
    } catch (err) {
      form.setFormError(screenErrorMessage(err, 'That client was not created.'));
      setSaving(false);
    }
  }

  return (
    <ScreenShell>
      <ScreenHeader title="New client" onBack={() => router.back()} right={<View style={styles.spacer} />} />

      <FormScreen
        dirty={form.dirty}
        saving={saving}
        error={form.formError}
        onSave={() => void save()}
        onDiscard={() => form.reset()}
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

          <FormDivider />

          <TextField
            label="Email"
            value={form.values.email}
            onChange={(v) => form.setField('email', v)}
            error={form.errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            hint="Optional. More addresses can be added afterwards."
          />
          <TextField
            label="Phone"
            value={form.values.phone}
            onChange={(v) => form.setField('phone', v)}
            error={form.errors.phone}
            keyboardType="phone-pad"
            hint="Optional. More numbers can be added afterwards."
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

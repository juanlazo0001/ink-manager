import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/form/Fields';
import { Eyebrow } from '@/components/ui';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Web's "Invite team member" modal, on this app's form layer.
 *
 * ─── WHAT WEB ACTUALLY DOES, CHECKED RATHER THAN ASSUMED ────────────
 *
 * `Team.tsx`'s `handleInviteSubmit`:
 *
 *     POST /studios/:studioId/invites   { email, name, phone, role }
 *
 * and its own sentence to the invitee is kept verbatim below, because it
 * is a promise about what happens next and rewording it would make the
 * two clients promise different things.
 *
 * Web offers TWO controls here — "Add directly", which creates an
 * account with a password and no email, and "Invite team member", which
 * sends the link. Only the second is here. The first is an account
 * creation flow with an avatar upload and a password field, the owner
 * asked for the invite, and a half-built "add directly" would be worse
 * than its absence.
 *
 * ─── ROLE ───────────────────────────────────────────────────────────
 *
 * Web's select offers its `DISPLAYED_ROLES`; FRONT_DESK is the default
 * there and here. ARTIST is deliberately NOT on this list: web invites
 * artists through a different modal and a different endpoint
 * (`openInviteArtist`), because an artist needs an Artist record made
 * alongside the user. Sending an ARTIST through this route would make a
 * user with no artist profile, which is the kind of half-record that is
 * hard to find later.
 */
export function InviteTeamMemberSheet({
  visible,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: { email: string; name: string; phone: string; role: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('FRONT_DESK');

  /* Email is the only field the route requires (`"email is required"`),
     so it is the only one gating the button. Web validates the phone's
     length when one is given; an empty phone is allowed there too. */
  const canSubmit = email.trim().length > 0 && !busy;

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Close invite form">
      <Eyebrow style={styles.eyebrow}>Team</Eyebrow>
      <Text style={styles.title}>Invite team member</Text>
      <Text style={styles.note}>
        They&apos;ll get an email with a link to set their own password and activate their account.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TextField
        label="Email"
        value={email}
        onChange={setEmail}
        placeholder="them@studio.com"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextField label="Name" value={name} onChange={setName} placeholder="Their name" />
      <TextField label="Phone" value={phone} onChange={setPhone} keyboardType="phone-pad" />

      <Text style={styles.fieldLabel}>ROLE</Text>
      <View style={styles.roles}>
        <SegmentedControl
          segments={[
            { key: 'FRONT_DESK', label: 'Front desk' },
            { key: 'OWNER', label: 'Owner' },
          ]}
          value={role}
          onChange={setRole}
        />
      </View>

      <Pressable
        onPress={canSubmit ? () => onSubmit({ email: email.trim(), name, phone, role }) : undefined}
        accessibilityRole="button"
        accessibilityLabel="Send invite"
        accessibilityState={{ disabled: !canSubmit, busy: !!busy }}
        style={({ pressed }) => [
          styles.action,
          styles.confirm,
          !canSubmit && styles.disabled,
          pressed && canSubmit && styles.pressed,
        ]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        <Text style={[styles.actionLabel, styles.confirmLabel]}>{busy ? 'Sending…' : 'Send invite'}</Text>
      </Pressable>

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionLabel}>Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginBottom: space.sm },
  title: { ...type.body, color: colors.fg, marginBottom: space.xs },
  note: { ...type.meta, color: colors.fgMuted, marginBottom: space.md },
  error: { ...type.small, color: colors.danger, marginBottom: space.sm },
  fieldLabel: { ...type.label, color: colors.fgMuted, marginTop: space.sm },
  /* Cancels the strip's own inset so the pills line up with the fields
     above them -- the same correction PermissionsMatrix carries. */
  roles: { marginHorizontal: -space.lg },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  actionLabel: { ...type.body, color: colors.fg },
  confirm: {
    borderWidth: hairline,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    marginTop: space.md,
  },
  confirmLabel: { color: colors.accent },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.6 },
});

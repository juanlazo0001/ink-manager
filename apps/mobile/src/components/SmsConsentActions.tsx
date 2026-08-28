import { useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Sheet } from '@/components/Sheet';
import { Eyebrow } from '@/components/ui';
import { issueConsentLink, recordSmsConsent, type StaffConsentMethod } from '@/lib/consent';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Record consent · Get opt-in link — apps/web's `SmsConsentControls`,
 * ported. Two call sites share it: the client page's contact card, and
 * the failed-send sheet for a message the A2P gate refused.
 *
 * ─── THE ONE RULE THAT IS NOT A UI DECISION ─────────────────────────
 *
 * **The opt-in link is never sent over SMS from here.** Texting an
 * opt-in request to a number that has not consented is the exact act the
 * consent gate exists to prevent, so the link is only ever handed to the
 * operator — clipboard or the OS share sheet — to send through a channel
 * the client already opened. There is deliberately no "text this to
 * them" affordance, and there should never be one.
 *
 * Web does the same thing (`SmsConsentControls.tsx`'s `copyLink` writes
 * to the clipboard and nothing else); native simply has a share sheet as
 * well as a clipboard, so both are offered.
 *
 * ─── MIRRORED SEMANTICS, NOT APPROXIMATED ONES ──────────────────────
 *
 * Both endpoints are business logic and are called exactly as web calls
 * them; see `lib/consent.ts` for what each one does to the record.
 */
export function SmsConsentActions({
  clientId,
  token,
  consentGivenAt,
  onRecorded,
  compact,
}: {
  clientId: string;
  token: string | null;
  consentGivenAt: string | null;
  /** Handed the API's patch so the caller can update in place. */
  onRecorded: (patch: { smsConsentGivenAt: string | null; smsConsentSource: string | null }) => void;
  /** Tighter treatment for the failed-send sheet. */
  compact?: boolean;
}) {
  const [methodOpen, setMethodOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function record(method: StaffConsentMethod) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const patch = await recordSmsConsent(token, clientId, method);
      setMethodOpen(false);
      onRecorded(patch);
    } catch (err) {
      setError(screenErrorMessage(err, 'That consent was not recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function getLink() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setLink(await issueConsentLink(token, clientId));
    } catch (err) {
      setError(screenErrorMessage(err, 'That link was not created.'));
    } finally {
      setBusy(false);
    }
  }

  /* Consent is only ever SET, never overwritten — the API treats a second
     grant as a no-op preserving the original timestamp. So once it is on
     file there is nothing here to offer. */
  if (consentGivenAt) return null;

  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <View style={styles.actions}>
        <Pressable
          onPress={busy ? undefined : () => setMethodOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Record consent"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>RECORD CONSENT</Text>
        </Pressable>

        <Pressable
          onPress={busy ? undefined : () => void getLink()}
          accessibilityRole="button"
          accessibilityLabel="Get opt-in link"
          style={({ pressed }) => [styles.action, styles.actionQuiet, pressed && styles.pressed]}
        >
          <Text style={[styles.actionLabel, styles.actionLabelQuiet]}>GET OPT-IN LINK</Text>
        </Pressable>

        {busy ? <ActivityIndicator size="small" color={colors.fgMuted} /> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {link ? (
        <View style={styles.link}>
          <Text style={styles.linkUrl} numberOfLines={2}>
            {link.url}
          </Text>
          {/* Copy and share only. See the header: never an SMS. */}
          <View style={styles.linkActions}>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(link.url);
                setCopied(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Copy the opt-in link"
              style={({ pressed }) => [styles.action, styles.actionQuiet, pressed && styles.pressed]}
            >
              <Text style={[styles.actionLabel, styles.actionLabelQuiet]}>
                {copied ? 'COPIED' : 'COPY'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void Share.share({ message: link.url })}
              accessibilityRole="button"
              accessibilityLabel="Share the opt-in link"
              style={({ pressed }) => [styles.action, styles.actionQuiet, pressed && styles.pressed]}
            >
              <Text style={[styles.actionLabel, styles.actionLabelQuiet]}>SHARE</Text>
            </Pressable>
          </View>
          <Text style={styles.linkNote}>
            Send this through a channel they already use. It is never texted automatically.
          </Text>
        </View>
      ) : null}

      <Sheet visible={methodOpen} onClose={() => setMethodOpen(false)}>
        <Eyebrow style={styles.sheetEyebrow}>How was consent given?</Eyebrow>
        {/* Web's three methods, values verbatim — the API validates
            against exactly this set and maps each to the stored source. */}
        {(
          [
            ['verbal_in_person', 'Verbal — in person'],
            ['verbal_phone', 'Verbal — over the phone'],
            ['written_form', 'Signed paper form'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={busy ? undefined : () => void record(value)}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Text style={styles.optionLabel}>{label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setMethodOpen(false)} style={styles.done}>
          <Text style={styles.doneLabel}>CANCEL</Text>
        </Pressable>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.sm, gap: space.sm },
  wrapCompact: { marginTop: space.xs, gap: space.xs },

  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  action: {
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  actionQuiet: { backgroundColor: 'transparent', borderWidth: hairline, borderColor: colors.border },
  actionLabel: { ...type.label, fontSize: 10, color: colors.accentFg },
  actionLabelQuiet: { color: colors.fgSecondary },

  error: { ...type.meta, color: colors.danger },

  link: { gap: space.xs },
  linkUrl: { ...type.meta, color: colors.fgSecondary },
  linkActions: { flexDirection: 'row', gap: space.sm },
  linkNote: { ...type.meta, color: colors.fgMuted },

  sheetEyebrow: { marginBottom: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  optionLabel: { ...type.body, color: colors.fg },
  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.accent },
  pressed: { opacity: 0.6 },
});

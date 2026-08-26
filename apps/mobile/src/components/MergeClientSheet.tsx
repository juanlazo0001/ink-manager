import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Sheet } from '@/components/Sheet';

import { Eyebrow } from '@/components/ui';
import { clientName, fetchClients, filterClients, type ClientDetail, type ClientListItem } from '@/lib/clients';
import { mergeClients } from '@/lib/clientWrites';
import { screenErrorMessage } from '@/lib/screenError';
import { colors, hairline, radius, space, tones, type } from '@/theme';

/**
 * Merge another client into this one.
 *
 * ─── THE SEMANTICS THE CONFIRM COPY HAS TO BE HONEST ABOUT ──────────
 *
 * Read off `apps/api/src/lib/clientMerge.ts`'s `performMerge`, which runs
 * in one transaction:
 *
 *   1. every inquiry, appointment, gift card and the rest is REPOINTED
 *      to this client;
 *   2. the two clients' conversations are folded together;
 *   3. the other client's phones and emails carry over as aliases;
 *   4. the other client gets `mergedIntoId` — it is NOT deleted, it
 *      becomes a tombstone pointing here.
 *
 * IT CANNOT BE UNDONE. `archive` has an `unarchive`; this has nothing.
 * There is no unmerge route anywhere in the API, and step 1 records no
 * inverse — after the transaction there is no stored fact saying which
 * inquiries came from where. So the confirm says "cannot be undone",
 * because that is the truth rather than a scare.
 *
 * The typed confirmation is web's own pattern for its destructive
 * actions, and this borrows it: a button you can hit by accident is the
 * wrong control for a one-way door.
 */
export function MergeClientSheet({
  visible,
  survivor,
  token,
  onClose,
  onMerged,
}: {
  visible: boolean;
  survivor: ClientDetail;
  token: string | null;
  onClose: () => void;
  onMerged: (updated: ClientDetail) => void;
}) {
  const [rows, setRows] = useState<ClientListItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ClientListItem | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !token) return;
    let cancelled = false;
    fetchClients(token)
      .then((all) => {
        if (!cancelled) setRows(all.filter((c) => c.id !== survivor.id));
      })
      .catch((err) => {
        if (!cancelled) setError(screenErrorMessage(err, 'The client list did not load.'));
      });
    return () => {
      cancelled = true;
    };
  }, [visible, token, survivor.id]);

  function reset() {
    setPicked(null);
    setConfirmText('');
    setSearch('');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  const matches = rows ? filterClients(rows, search).slice(0, 20) : [];
  // Web types the record's name to confirm; the same idea, and the word
  // is short enough to type on a phone.
  const CONFIRM_WORD = 'MERGE';
  const canMerge = !!picked && confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  async function run() {
    if (!token || !picked) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await mergeClients(token, survivor.id, picked.id);
      reset();
      onMerged(updated);
    } catch (err) {
      setError(screenErrorMessage(err, 'The merge did not go through.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={close}>
          <Eyebrow style={styles.eyebrow}>Merge with another client</Eyebrow>

          {!picked ? (
            <>
              <Text style={styles.lead}>
                Pick the duplicate. Everything on it moves onto {clientName(survivor)}.
              </Text>
              <TextInput
                style={styles.input}
                value={search}
                onChangeText={setSearch}
                placeholder="Search name, email or phone"
                placeholderTextColor={colors.fgMuted}
                accessibilityLabel="Search clients to merge"
                autoCapitalize="none"
              />
              <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                {rows === null ? (
                  <ActivityIndicator style={styles.loading} color={colors.fgMuted} />
                ) : matches.length === 0 ? (
                  <Text style={styles.empty}>No other client matches that.</Text>
                ) : (
                  matches.map((row) => (
                    <Pressable
                      key={row.id}
                      onPress={() => setPicked(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Merge ${clientName(row)} into ${clientName(survivor)}`}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    >
                      <Text style={styles.rowName}>{clientName(row)}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {row.email ?? row.phone ?? 'No contact details'}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </>
          ) : (
            <>
              <Text style={styles.lead}>
                <Text style={styles.strong}>{clientName(picked)}</Text> will be merged into{' '}
                <Text style={styles.strong}>{clientName(survivor)}</Text>.
              </Text>

              <View style={styles.consequences}>
                <Text style={styles.consequence}>
                  • Their inquiries, projects, appointments and gift cards move to this client.
                </Text>
                <Text style={styles.consequence}>• Their conversations are folded into this one.</Text>
                <Text style={styles.consequence}>
                  • Their phone numbers and email addresses are kept here as aliases.
                </Text>
                <Text style={styles.consequence}>
                  • {clientName(picked)} stops appearing in your client list and can no longer be
                  edited.
                </Text>
                <Text style={styles.warning}>This cannot be undone.</Text>
              </View>

              <TextInput
                style={styles.input}
                value={confirmText}
                onChangeText={(next) => {
                  setConfirmText(next);
                  setError(null);
                }}
                placeholder={`Type ${CONFIRM_WORD} to confirm`}
                placeholderTextColor={colors.fgMuted}
                accessibilityLabel={`Type ${CONFIRM_WORD} to confirm the merge`}
                autoCapitalize="characters"
                autoCorrect={false}
              />

              {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}

              <View style={styles.buttons}>
                <Pressable
                  onPress={canMerge ? () => void run() : undefined}
                  disabled={!canMerge}
                  accessibilityRole="button"
                  accessibilityLabel="Merge these clients"
                  accessibilityState={{ disabled: !canMerge, busy }}
                  style={({ pressed }) => [
                    styles.merge,
                    !canMerge && styles.mergeOff,
                    pressed && canMerge && styles.pressed,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.accentFg} />
                  ) : (
                    <Text style={styles.mergeLabel}>MERGE</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={reset}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.back, pressed && styles.pressed]}
                >
                  <Text style={styles.backLabel}>BACK</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable onPress={close} style={styles.done}>
            <Text style={styles.doneLabel}>CANCEL</Text>
          </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginBottom: space.sm },
  lead: { ...type.small, color: colors.fgSecondary, marginBottom: space.sm },
  strong: { color: colors.fg },

  input: {
    minHeight: 44,
    marginTop: space.sm,
    backgroundColor: colors.inputBg,
    borderWidth: hairline,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    paddingHorizontal: space.md,
    color: colors.fg,
    ...type.body,
  },

  list: { marginTop: space.sm, maxHeight: 280 },
  loading: { marginTop: space.lg },
  empty: { ...type.small, color: colors.fgMuted, marginTop: space.md },
  row: {
    paddingVertical: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.borderSoft,
    gap: 2,
  },
  rowName: { ...type.body, color: colors.fg },
  rowMeta: { ...type.meta, color: colors.fgMuted },

  consequences: { gap: space.xs, marginTop: space.sm, marginBottom: space.sm },
  consequence: { ...type.small, color: colors.fgSecondary },
  warning: { ...type.small, color: tones.danger, marginTop: space.xs },
  error: { ...type.small, color: tones.danger, marginTop: space.sm },

  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  merge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerStrong,
  },
  mergeOff: { opacity: 0.4 },
  mergeLabel: { ...type.button, color: '#ffffff' },
  back: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  backLabel: { ...type.button, color: colors.fgSecondary },

  done: { marginTop: space.md, alignItems: 'center', paddingVertical: space.md },
  doneLabel: { ...type.button, color: colors.fgMuted },
  pressed: { opacity: 0.6 },
});

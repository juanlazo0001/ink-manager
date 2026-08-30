import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/form/Fields';
import { QuietButton } from '@/components/ui';
import {
  DELETE_CONFIRM_WORD,
  describeDeletion,
  type DeletePreview,
} from '@/lib/inquiryActions';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * The header's overflow (⋯) menu, and the confirmations it leads to.
 *
 * ─── ONE SHEET, CONTENTS SWAP ───────────────────────────────────────
 *
 * Not three sheets. CLAUDE.md's modal rule exists because two RN
 * `<Modal>`s alive at once is a real iOS hazard — `Sheet` keeps its modal
 * mounted ~300ms after `visible` goes false, so closing the menu and
 * opening a confirm in the same tick overlaps by construction and can
 * wedge the presentation queue. The stable pattern named there is the
 * long-press overlay's: ONE modal whose contents change. That is what
 * `mode` does here, and it is why the confirms are not their own
 * components.
 *
 * ─── WHAT IS IN THE MENU, AND WHY THIS SET ──────────────────────────
 *
 * Mirrored from web's `DropdownPortal` on the inquiry header, item for
 * item and gate for gate:
 *
 *   Auto-order sections   canEditInquiry-independent   NOT PORTED
 *   Mark as lost          canMarkLost && !isTerminal
 *   Put On Hold           canEditInquiry && isConverted
 *   Archive / Unarchive   canEditInquiry
 *   Delete Permanently    isOwner  (ROLE, not a permission)
 *
 * "Auto-order sections" resets web's draggable widget layout. Mobile has
 * no draggable layout to reset — the cards are a fixed order — so the
 * item would do nothing. Omitted deliberately rather than stubbed.
 *
 * The whole menu is hidden when none of the three gates pass, which is
 * web's own condition rather than an inference from it.
 */

export type ActionsMode = 'menu' | 'archive' | 'delete' | 'lost' | 'hold';

export function InquiryActionsSheet({
  visible,
  onClose,
  mode,
  onModeChange,
  archived,
  canMarkLost,
  canEditInquiry,
  isOwner,
  isTerminal,
  isConverted,
  busy,
  error,
  reason,
  onReasonChange,
  noteCount,
  deletePreview,
  deletePreviewLoading,
  onMarkLost,
  onHold,
  onArchiveToggle,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  mode: ActionsMode;
  onModeChange: (mode: ActionsMode) => void;
  archived: boolean;
  canMarkLost: boolean;
  canEditInquiry: boolean;
  isOwner: boolean;
  isTerminal: boolean;
  isConverted: boolean;
  busy: boolean;
  error: string | null;
  /** How many notes this inquiry has. See `blockedByNotes` below. */
  noteCount: number;
  deletePreview: DeletePreview | null;
  deletePreviewLoading: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  onMarkLost: () => void;
  onHold: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');

  /* Re-seed when the sheet reopens, so a previous attempt's typing is
     never still sitting in the box the next time. */
  const [seenMode, setSeenMode] = useState<ActionsMode>(mode);
  if (seenMode !== mode) {
    setSeenMode(mode);
    if (mode !== 'delete') setConfirmText('');
  }

  /*
   * DELETE CANNOT SUCCEED WHILE THIS INQUIRY HAS NOTES, and that is a
   * server defect rather than a rule worth enforcing prettily.
   *
   * `InquiryNote.inquiryId` is ON DELETE RESTRICT in the database, and
   * the route's transaction never removes notes -- so `tx.inquiry.delete`
   * hits the foreign key and the whole thing rolls back. Measured against
   * the live dev API this session: an inquiry with one note returns 500
   * "Internal server error", with nothing in it a person could act on.
   * Web has the same defect and shows the same 500.
   *
   * Blocking here rather than letting the request fail is the honest
   * choice: the outcome is known in advance, and "delete the notes first"
   * is a thing someone can actually do. If the API is fixed to cascade,
   * this guard stops applying on its own -- noteCount only matters
   * because the server makes it matter.
   */
  const blockedByNotes = noteCount > 0;
  const deletionArmed =
    !blockedByNotes && confirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD;

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Inquiry actions">
      <View style={styles.body}>
        {mode === 'menu' ? (
          <>
            <Text style={styles.heading}>Actions</Text>

            {canMarkLost && !isTerminal ? (
              <MenuItem
                icon="x-circle"
                label="Mark as lost"
                tone="danger"
                onPress={() => onModeChange('lost')}
              />
            ) : null}

            {canEditInquiry && isConverted ? (
              <MenuItem icon="pause-circle" label="Put on hold" onPress={() => onModeChange('hold')} />
            ) : null}

            {canEditInquiry ? (
              <MenuItem
                icon={archived ? 'corner-up-left' : 'archive'}
                label={archived ? 'Unarchive' : 'Archive'}
                onPress={() => onModeChange('archive')}
              />
            ) : null}

            {isOwner ? (
              <MenuItem
                icon="trash-2"
                label="Delete permanently"
                tone="danger"
                onPress={() => onModeChange('delete')}
              />
            ) : null}

            <QuietButton label="Cancel" onPress={onClose} style={styles.full} />
          </>
        ) : null}

        {mode === 'archive' ? (
          <>
            <Text style={styles.heading}>{archived ? 'Unarchive this inquiry?' : 'Archive this inquiry?'}</Text>
            <Text style={styles.para}>
              {archived
                ? 'It goes back to the active list. Nothing else changes.'
                : 'It leaves the active list and keeps everything — the estimate, notes, photos and history all stay. You can unarchive it at any time.'}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.row}>
              <QuietButton label="Cancel" onPress={() => onModeChange('menu')} style={styles.half} />
              <Pressable
                onPress={busy ? undefined : onArchiveToggle}
                accessibilityRole="button"
                accessibilityLabel={archived ? 'Unarchive' : 'Archive'}
                style={[styles.primary, busy && styles.disabled, styles.half]}
              >
                <Text style={styles.primaryLabel}>
                  {busy ? 'Working…' : archived ? 'Unarchive' : 'Archive'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {mode === 'lost' || mode === 'hold' ? (
          <>
            <Text style={mode === 'lost' ? styles.headingDanger : styles.heading}>
              {mode === 'lost' ? 'Mark this inquiry lost?' : 'Put this inquiry on hold?'}
            </Text>
            <Text style={styles.para}>
              {mode === 'lost'
                ? 'It moves out of the active pipeline. Everything is kept, and it can be reopened.'
                : 'It pauses here and keeps its place. The status returns to where it was when you take it off hold.'}
            </Text>
            {/* Optional on the route, so it is optional here -- an empty
                reason is omitted rather than sent as "". */}
            <TextField
              label="Reason (optional)"
              value={reason}
              onChange={onReasonChange}
              multiline
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.row}>
              <QuietButton label="Cancel" onPress={() => onModeChange('menu')} style={styles.half} />
              <Pressable
                onPress={busy ? undefined : mode === 'lost' ? onMarkLost : onHold}
                accessibilityRole="button"
                accessibilityLabel={mode === 'lost' ? 'Mark as lost' : 'Put on hold'}
                style={[mode === 'lost' ? styles.danger : styles.primary, busy && styles.disabled, styles.half]}
              >
                <Text style={mode === 'lost' ? styles.dangerLabel : styles.primaryLabel}>
                  {busy ? 'Working…' : mode === 'lost' ? 'Mark lost' : 'Put on hold'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {mode === 'delete' ? (
          <>
            <Text style={styles.headingDanger}>Delete permanently</Text>

            {/*
              What is lost, from the SERVER's own count, not a guess. The
              route exposes GET /delete-preview precisely so this can be
              specific instead of saying "and related data".
            */}
            {deletePreviewLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.para}>Checking what this would remove…</Text>
              </View>
            ) : deletePreview ? (
              <DeletionSummary preview={deletePreview} />
            ) : (
              <Text style={styles.para}>
                Couldn&apos;t check what this would remove. The delete will still be exact — the
                server recounts before it acts.
              </Text>
            )}

            <Text style={styles.para}>
              This cannot be undone. The inquiry row itself is removed, not hidden.
            </Text>

            {blockedByNotes ? (
              <Text style={styles.blocked}>
                {noteCount === 1
                  ? 'This inquiry has 1 note, and the server cannot delete an inquiry that still has notes. Delete the note first.'
                  : `This inquiry has ${noteCount} notes, and the server cannot delete an inquiry that still has notes. Delete them first.`}
              </Text>
            ) : null}

            {/*
              A typed word, because the ROUTE requires it: DELETE /:id
              rejects any body whose `confirm` is not exactly "DELETE".
              This is the server's contract surfaced, not a speed bump
              invented here.
            */}
            <TextField
              label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
              value={confirmText}
              onChange={setConfirmText}
              /* 'none', not 'characters' -- this field's own comparison
                 upper-cases before testing, so autocapitalisation would
                 only make the keyboard lie about what is required. */
              autoCapitalize="none"
              placeholder={DELETE_CONFIRM_WORD}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.row}>
              <QuietButton label="Cancel" onPress={() => onModeChange('menu')} style={styles.half} />
              <Pressable
                onPress={deletionArmed && !busy ? onDelete : undefined}
                accessibilityRole="button"
                accessibilityLabel="Delete permanently"
                accessibilityState={{ disabled: !deletionArmed || busy }}
                style={[styles.danger, (!deletionArmed || busy) && styles.disabled, styles.half]}
              >
                <Text style={styles.dangerLabel}>{busy ? 'Deleting…' : 'Delete'}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

function DeletionSummary({ preview }: { preview: DeletePreview }) {
  const { destroyed, detached } = describeDeletion(preview);
  return (
    <View style={styles.summary}>
      {destroyed.length > 0 ? (
        <>
          <Text style={styles.para}>This also destroys:</Text>
          {destroyed.map((line) => (
            <Text key={line} style={styles.bullet}>
              •  {line}
            </Text>
          ))}
        </>
      ) : (
        <Text style={styles.para}>Nothing else is attached to this inquiry.</Text>
      )}
      {detached ? <Text style={styles.keeps}>{detached}</Text> : null}
    </View>
  );
}

function MenuItem({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  tone?: 'danger';
  onPress: () => void;
}) {
  const tint = tone === 'danger' ? colors.danger : colors.fg;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <Feather name={icon} size={18} color={tint} />
      <Text style={[styles.itemLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  heading: { ...type.heading, color: colors.fg },
  headingDanger: { ...type.heading, color: colors.danger },
  para: { ...type.small, color: colors.fgMuted },
  bullet: { ...type.small, color: colors.fg, paddingLeft: space.xs },
  keeps: { ...type.small, color: colors.accent, paddingTop: space.xs },
  summary: {
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surfaceInset,
  },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.input,
  },
  itemPressed: { backgroundColor: colors.surfaceInset },
  itemLabel: { ...type.body },
  row: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  full: { width: '100%' },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surfaceInset,
  },
  primaryLabel: { ...type.label, color: colors.fg },
  /* Red as PUNCTUATION on the single most destructive control in the
     screen -- the one place CLAUDE.md's colour rule expects a fill. */
  danger: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.input,
    backgroundColor: colors.dangerStrong,
  },
  dangerLabel: { ...type.label, color: '#ffffff' },
  disabled: { opacity: 0.45 },
  blocked: { ...type.small, color: colors.danger },
  error: { ...type.small, color: colors.danger },
});

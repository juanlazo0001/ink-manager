import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { GoldGradientButton } from '@/components/GoldGradientButton';
import { Sheet } from '@/components/Sheet';
import { SwitchField, TextField } from '@/components/form/Fields';
import { QuietButton } from '@/components/ui';
import { isBlankNoteHtml } from '@/lib/inquiryNotes';
import {
  parseNoteHtml,
  serialiseNoteHtml,
  type Block,
  type BlockKind,
} from '@/lib/noteHtml';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Compose a note, in web's exact stored format.
 *
 * ─── THE DEVIATION, STATED ──────────────────────────────────────────
 *
 * Web composes notes with TipTap (ProseMirror): a true WYSIWYG surface
 * where marks apply to an arbitrary selection. This is not that, and the
 * brief sanctions the difference — "if a full rich-text editor is
 * disproportionate on mobile, implement the same formatting set with a
 * lighter native approach and state the deviation; the STORED format
 * must match web's exactly".
 *
 * What is the same: the formatting SET (bold, italic, underline, h2, h3,
 * bullet list, ordered list, link) and, exactly, the stored HTML.
 *
 * What is different: formatting is applied PER BLOCK rather than to a
 * character range. A line is a paragraph, a heading or a list item, and
 * bold/italic/underline apply to that whole line.
 *
 * ─── WHY PER BLOCK, RATHER THAN PER SELECTION ───────────────────────
 *
 * A selection-based toolbar needs the editor to own a rich document
 * model AND keep it in sync with a native `TextInput`'s own text and
 * selection state. React Native gives `selection` but no way to render
 * mixed styling inside an editable `TextInput` — styled spans are
 * display-only. So a per-selection editor on RN means reimplementing
 * text layout, caret and selection from scratch, which is exactly the
 * "disproportionate" the brief anticipated.
 *
 * Per block is honest instead of pretending: what you can express, you
 * can see, and everything it produces is inside the allowed tag set by
 * construction — because it never manipulates HTML at all. It edits
 * `Block[]` and hands them to `serialiseNoteHtml`.
 *
 * ─── WHAT THIS MEANS FOR A NOTE WEB WROTE ───────────────────────────
 *
 * Opening one for edit parses it to blocks. A block whose text carries
 * MIXED marks (bold on half a sentence) collapses to the marks of its
 * first span, because that is the most this model can hold. That is
 * lossy and it is the one place this design gives something up, so the
 * editor says so on screen when it detects it rather than quietly
 * rewriting someone's note.
 */

const BLOCK_CYCLE: { kind: BlockKind; icon: React.ComponentProps<typeof Feather>['name']; label: string }[] = [
  { kind: 'p', icon: 'align-left', label: 'Paragraph' },
  { kind: 'h2', icon: 'type', label: 'Heading' },
  { kind: 'h3', icon: 'minus', label: 'Subheading' },
  { kind: 'li-bullet', icon: 'list', label: 'Bullet list' },
  { kind: 'li-number', icon: 'hash', label: 'Numbered list' },
];

/** One editable line. */
interface Line {
  kind: BlockKind;
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  href?: string;
}

function blocksToLines(blocks: Block[]): { lines: Line[]; lostMixedMarks: boolean } {
  let lost = false;
  const lines = blocks.map((b) => {
    const first = b.spans[0] ?? { text: '' };
    // Mixed marks within one block cannot be represented; detect it so
    // the editor can say so rather than silently flattening.
    const mixed = b.spans.some(
      (s) =>
        !!s.bold !== !!first.bold ||
        !!s.italic !== !!first.italic ||
        !!s.underline !== !!first.underline ||
        s.href !== first.href,
    );
    if (mixed) lost = true;
    return {
      kind: b.kind,
      text: b.spans.map((s) => s.text).join(''),
      bold: !!first.bold,
      italic: !!first.italic,
      underline: !!first.underline,
      href: first.href,
    };
  });
  return { lines: lines.length > 0 ? lines : [blankLine()], lostMixedMarks: lost };
}

function linesToBlocks(lines: Line[]): Block[] {
  return lines
    .filter((l) => l.text.trim().length > 0)
    .map((l) => ({
      kind: l.kind,
      spans: [
        {
          text: l.text,
          ...(l.bold ? { bold: true } : {}),
          ...(l.italic ? { italic: true } : {}),
          ...(l.underline ? { underline: true } : {}),
          ...(l.href ? { href: l.href } : {}),
        },
      ],
    }));
}

export function NoteEditor({
  visible,
  onClose,
  initialHtml,
  initialVisibleToArtist,
  saving,
  error,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  /** Empty for a new note; the stored HTML when editing one. */
  initialHtml: string;
  initialVisibleToArtist: boolean;
  saving: boolean;
  /** The route's own message on failure, surfaced verbatim. */
  error: string | null;
  onSave: (bodyHtml: string, visibleToArtist: boolean) => void;
}) {
  const parsed = useMemo(() => blocksToLines(parseNoteHtml(initialHtml)), [initialHtml]);
  const [lines, setLines] = useState<Line[]>(parsed.lines);
  const [share, setShare] = useState(initialVisibleToArtist);
  const [focused, setFocused] = useState(0);
  const [linkFor, setLinkFor] = useState<number | null>(null);
  const [linkDraft, setLinkDraft] = useState('');

  // Re-seed whenever the sheet opens on a different note.
  const [seed, setSeed] = useState(initialHtml);
  if (seed !== initialHtml) {
    setSeed(initialHtml);
    setLines(parsed.lines);
    setShare(initialVisibleToArtist);
    setFocused(0);
  }

  const html = useMemo(() => serialiseNoteHtml(linesToBlocks(lines)), [lines]);
  const blank = isBlankNoteHtml(html);

  const patch = (i: number, next: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...next } : l)));

  const cycleKind = (i: number) => {
    const at = BLOCK_CYCLE.findIndex((b) => b.kind === lines[i].kind);
    patch(i, { kind: BLOCK_CYCLE[(at + 1) % BLOCK_CYCLE.length].kind });
  };

  const addLine = () => {
    setLines((ls) => [...ls, blankLine()]);
    setFocused(lines.length);
  };

  const removeLine = (i: number) =>
    setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((_, j) => j !== i)));

  const current = lines[focused] ?? lines[0];
  const kindLabel = BLOCK_CYCLE.find((b) => b.kind === current?.kind)?.label ?? 'Paragraph';

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Write a note">
      <View style={styles.body}>
        <Text style={styles.heading}>{initialHtml ? 'Edit note' : 'New note'}</Text>

        {parsed.lostMixedMarks ? (
          <Text style={styles.warn}>
            This note has formatting that varies within a line. Mobile edits a whole line at a time,
            so saving will apply each line&apos;s first style to all of it.
          </Text>
        ) : null}

        {/* The toolbar acts on the FOCUSED line — stated in the label so
            it is never ambiguous which line a tap will change. */}
        <View style={styles.toolbar}>
          <ToolButton icon="bold" on={!!current?.bold} label="Bold" onPress={() => patch(focused, { bold: !current.bold })} />
          <ToolButton icon="italic" on={!!current?.italic} label="Italic" onPress={() => patch(focused, { italic: !current.italic })} />
          <ToolButton icon="underline" on={!!current?.underline} label="Underline" onPress={() => patch(focused, { underline: !current.underline })} />
          <ToolButton
            icon="link"
            on={!!current?.href}
            label="Link"
            onPress={() => {
              setLinkDraft(current?.href ?? '');
              setLinkFor(focused);
            }}
          />
          <Pressable
            onPress={() => cycleKind(focused)}
            accessibilityRole="button"
            accessibilityLabel={`Line style: ${kindLabel}. Tap to change.`}
            style={({ pressed }) => [styles.kindButton, pressed && styles.pressed]}
          >
            <Feather
              name={BLOCK_CYCLE.find((b) => b.kind === current?.kind)?.icon ?? 'align-left'}
              size={14}
              color={colors.fg}
            />
            <Text style={styles.kindLabel}>{kindLabel}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.lines} contentContainerStyle={styles.linesContent}>
          {lines.map((line, i) => (
            <View key={i} style={[styles.line, i === focused && styles.lineFocused]}>
              <TextInput
                value={line.text}
                onChangeText={(t) => patch(i, { text: t })}
                onFocus={() => setFocused(i)}
                placeholder={i === 0 ? 'Write a note…' : ''}
                placeholderTextColor={colors.fgFaint}
                multiline
                style={[
                  styles.input,
                  line.bold && styles.bold,
                  line.italic && styles.italic,
                  line.underline && styles.underline,
                  line.kind === 'h2' && styles.h2,
                  line.kind === 'h3' && styles.h3,
                  !!line.href && styles.link,
                ]}
              />
              {(line.kind === 'li-bullet' || line.kind === 'li-number') && (
                <Text style={styles.marker}>{line.kind === 'li-bullet' ? '•' : '1.'}</Text>
              )}
              {lines.length > 1 ? (
                <Pressable
                  onPress={() => removeLine(i)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this line"
                  style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                >
                  <Feather name="x" size={13} color={colors.fgMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}

          <Pressable onPress={addLine} accessibilityRole="button" style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
            <Feather name="plus" size={14} color={colors.accent} />
            <Text style={styles.addLabel}>Add a line</Text>
          </Pressable>
        </ScrollView>

        {linkFor !== null ? (
          <View style={styles.linkRow}>
            <TextField
              label="Link address"
              value={linkDraft}
              onChange={setLinkDraft}
              placeholder="https://"
              autoCapitalize="none"
            />
            <View style={styles.linkActions}>
              <QuietButton
                label="Remove"
                onPress={() => {
                  patch(linkFor, { href: undefined });
                  setLinkFor(null);
                }}
                style={styles.action}
              />
              <QuietButton
                label="Apply"
                onPress={() => {
                  patch(linkFor, { href: linkDraft.trim() || undefined });
                  setLinkFor(null);
                }}
                style={styles.action}
              />
            </View>
          </View>
        ) : null}

        {/*
          `visibleToArtist`. Defaults FALSE, which is the column's own
          default and the original design intent recorded on the schema —
          a note is "never shown to the client or shared with an artist"
          unless someone opts in. Only notes with this true reach the
          assigned artist, through ARTIST_INQUIRY_SELECT.
        */}
        <SwitchField
          label="Share with the assigned artist"
          value={share}
          onChange={setShare}
          description="Off by default. Staff always see every note."
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <QuietButton label="Cancel" onPress={onClose} style={styles.action} />
          <GoldGradientButton
            label={saving ? 'Saving…' : 'Save note'}
            onPress={() => !blank && !saving && onSave(html, share)}
            style={[styles.action, (blank || saving) && styles.disabled]}
          />
        </View>
      </View>
    </Sheet>
  );
}

function blankLine(): Line {
  return { kind: 'p', text: '', bold: false, italic: false, underline: false };
}

function ToolButton({
  icon,
  on,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  on: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.tool, on && styles.toolOn, pressed && styles.pressed]}
    >
      <Feather name={icon} size={15} color={on ? colors.accentFg : colors.fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.md },
  heading: { ...type.sectionHeader, color: colors.fg },
  warn: { ...type.small, color: colors.accent },

  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  tool: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
  },
  toolOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
  },
  kindLabel: { ...type.small, color: colors.fg },

  lines: { maxHeight: 260 },
  linesContent: { gap: space.xs },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.input,
    borderWidth: hairline,
    borderColor: 'transparent',
    paddingHorizontal: space.sm,
  },
  lineFocused: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceInset },
  input: { ...type.small, color: colors.fg, flex: 1, paddingVertical: space.sm, minHeight: 34 },
  marker: { ...type.small, color: colors.fgMuted, paddingTop: space.sm },
  remove: { padding: space.sm },

  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  link: { color: colors.accent },
  h2: { ...type.sectionHeader, color: colors.fg },
  h3: { ...type.label, color: colors.fg },

  add: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  addLabel: { ...type.small, color: colors.accent },

  linkRow: { gap: space.sm },
  linkActions: { flexDirection: 'row', gap: space.sm },

  error: { ...type.small, color: colors.danger },
  actions: { flexDirection: 'row', gap: space.md },
  action: { flex: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
});

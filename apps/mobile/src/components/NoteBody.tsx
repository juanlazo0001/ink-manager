import { Linking, StyleSheet, Text, View } from 'react-native';

import { parseNoteHtml, type Block, type Inline } from '@/lib/noteHtml';
import { colors, space, type } from '@/theme';

/**
 * A note's stored HTML, rendered natively.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────
 *
 * Mobile had exactly one place that touched `bodyHtml`, and it did this:
 *
 *     note.bodyHtml.replace(/<[^>]*>/g, '')
 *
 * — every tag stripped, the note flattened to one run of plain text. The
 * comment there was honest about it ("the API sends HTML, and mobile has
 * no sanitiser"), and stripping was the right call while mobile could
 * only READ notes: unrenderable markup shown as markup is worse than
 * markup shown as prose.
 *
 * It stops being the right call the moment mobile can WRITE one. Someone
 * would bold a line, save it, and get flat text back — and would
 * reasonably conclude the formatting had not saved. So the renderer
 * comes before the editor.
 *
 * ─── NO SANITISER NEEDED, AND THAT IS STRUCTURAL ────────────────────
 *
 * This never interprets markup. `parseNoteHtml` reduces the string to a
 * data structure of blocks and spans, and everything below renders React
 * Native primitives from that data — there is no `dangerouslySetInnerHTML`
 * equivalent in the path and no way for a tag to become behaviour. Web
 * needs DOMPurify because it hands a string to the DOM; this does not.
 */
export function NoteBody({ html }: { html: string }) {
  const blocks = parseNoteHtml(html);
  if (blocks.length === 0) return null;

  return (
    <View style={styles.body}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} index={indexWithinList(blocks, i)} />
      ))}
    </View>
  );
}

/**
 * An ordered item's own number.
 *
 * Counted from the run of adjacent `li-number` blocks it belongs to, so a
 * second list further down the note restarts at 1 rather than continuing
 * the first one's count.
 */
function indexWithinList(blocks: Block[], i: number): number {
  if (blocks[i].kind !== 'li-number') return 0;
  let n = 1;
  for (let j = i - 1; j >= 0 && blocks[j].kind === 'li-number'; j--) n++;
  return n;
}

function BlockView({ block, index }: { block: Block; index: number }) {
  const spans = <Spans spans={block.spans} />;

  if (block.kind === 'h2') return <Text style={styles.h2}>{spans}</Text>;
  if (block.kind === 'h3') return <Text style={styles.h3}>{spans}</Text>;

  if (block.kind === 'li-bullet' || block.kind === 'li-number') {
    return (
      <View style={styles.li}>
        {/* A Text marker rather than a bullet View: it sits on the text's
            own baseline for free, where a View has to be nudged and then
            drifts the moment the type scale changes. */}
        <Text style={styles.marker}>{block.kind === 'li-bullet' ? '•' : `${index}.`}</Text>
        <Text style={styles.p}>{spans}</Text>
      </View>
    );
  }

  return <Text style={styles.p}>{spans}</Text>;
}

/**
 * Inline marks, as nested `<Text>`.
 *
 * React Native composes text styles down the tree, so bold + italic on
 * one span is simply both styles on one element — no need to reproduce
 * the tag nesting the HTML had.
 */
function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((span, i) => {
        const style = [
          span.bold && styles.bold,
          span.italic && styles.italic,
          span.underline && styles.underline,
          span.href && styles.link,
        ].filter(Boolean);

        if (span.href) {
          const href = span.href;
          return (
            <Text
              key={i}
              style={style}
              accessibilityRole="link"
              /* `openURL` rather than a router push: these are arbitrary
                 URLs a staff member typed, not app routes. */
              onPress={() => void Linking.openURL(href).catch(() => {})}
            >
              {span.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={style}>
            {span.text}
          </Text>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.sm },

  p: { ...type.small, color: colors.fgSecondary, flexShrink: 1 },
  /* Web sets these with the heading scale; mobile's `sectionHeader` is
     the card-title token, so h2 takes it and h3 steps down. Both stay
     clearly above body copy, which is all the two levels have to do. */
  h2: { ...type.sectionHeader, color: colors.fg },
  h3: { ...type.label, color: colors.fg },

  li: { flexDirection: 'row', gap: space.sm, paddingLeft: space.xs },
  marker: { ...type.small, color: colors.fgMuted, minWidth: 14 },

  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  link: { color: colors.accent, textDecorationLine: 'underline' },
});

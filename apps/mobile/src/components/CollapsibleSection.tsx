import Feather from '@expo/vector-icons/Feather';
import { GestureDetector, type ComposedGesture, type GestureType } from 'react-native-gesture-handler';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, SectionHeader } from '@/components/editorial';
import { DragHandleIcon } from '@/components/icons';
import { colors, space } from '@/theme';

/**
 * A card section that collapses, with its actions on the title row.
 *
 * THE HEADER IS ONE ROW: `[chevron] TITLE ......... [action] [action]`.
 * That is web's own `Widget` shell, read off the source rather than
 * guessed — `flex flex-wrap items-center justify-between gap-2` with the
 * chevron and title grouped left and `actions` pushed right. Mobile had
 * been stacking the actions BELOW the title, which cost a whole row of
 * dead space on every card, nine times down this screen.
 *
 * NO COUNT. Web's header renders the title and nothing else — there is no
 * count in `Widget` at all — and the owner asked for it gone. Both agree,
 * so it is gone.
 *
 * WHEN IT DOES NOT FIT, THE TITLE TRUNCATES; the actions never shrink and
 * never wrap. Web reaches the same outcome by different means: its title
 * carries `min-w-0 truncate` while every action carries `shrink-0`, so a
 * narrow header eats the title, not the buttons. (Web's row is also
 * `flex-wrap` — a fallback the owner ruled out for mobile, and one that
 * in practice never fires there, since a `min-w-0` title shrinks before
 * a flex line breaks.)
 */
export function CollapsibleSection({
  title,
  open,
  onToggle,
  headerActions,
  dragGesture,
  dragging,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /**
   * Icon-only actions for the header row. Whatever web's `Widget` gets in
   * its `actions` slot for this section — and for five of the nine
   * client-detail sections that is nothing at all.
   */
  headerActions?: ReactNode;
  /**
   * The drag handle's gesture, supplied by the list that owns the order.
   * Present means this card is draggable; absent means it is not.
   *
   * THE HANDLE IS THE ONLY DRAG SURFACE. That is what makes this
   * tractable inside a ScrollView: the pan gesture lives on a 44pt target
   * in the header, and the card body keeps ordinary scroll and tap. There
   * is no mode to enter and nothing to toggle — web shows its handle
   * permanently and so does this.
   */
  dragGesture?: ComposedGesture | GestureType;
  /** True while this card is the one being dragged. */
  dragging?: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <View style={styles.head}>
        {/* Only the chevron and title toggle. The actions sit outside this
            Pressable so tapping one cannot also collapse the card. */}
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={title}
          style={({ pressed }) => [styles.titleTap, pressed && styles.pressed]}
        >
          <Feather
            name={open ? 'chevron-down' : 'chevron-right'}
            size={15}
            color={colors.fgMuted}
          />
          <SectionHeader style={styles.title} numberOfLines={1}>
            {title}
          </SectionHeader>
        </Pressable>

        {headerActions ?? null}

        {/* Web's handle sits FIRST in its header row; on a phone the left
            edge is where the chevron and title live, so it takes the
            right end instead — still permanent, still the only grab
            point. */}
        {dragGesture ? (
          <GestureDetector gesture={dragGesture}>
            <View
              style={styles.handle}
              accessibilityRole="adjustable"
              accessibilityLabel={`Reorder ${title}`}
              accessibilityHint="Drag to move this card up or down."
            >
              <DragHandleIcon size={18} color={dragging ? colors.accent : colors.fgMuted} />
            </View>
          </GestureDetector>
        ) : null}
      </View>

      {open ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  /* A 44pt target around an 18px glyph — the grab point has to be big
     enough to find without looking. */
  handle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // `minWidth: 0` is what lets the title truncate instead of forcing the
  // row wider than the card — RN's default `minWidth: auto` would not.
  titleTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1 },

  body: { marginTop: space.md },

  pressed: { opacity: 0.6 },
});

import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, SectionHeader } from '@/components/editorial';
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
      </View>

      {open ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // `minWidth: 0` is what lets the title truncate instead of forcing the
  // row wider than the card — RN's default `minWidth: auto` would not.
  titleTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1 },

  body: { marginTop: space.md },

  pressed: { opacity: 0.6 },
});

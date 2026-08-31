import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';

import { colors, hairline, radius, space, type } from '@/theme';

/**
 * A quiet full-width note about the RECORD's state — archived, merged,
 * transferred, "you are a guest at this studio", "this lives in the
 * portal".
 *
 * ─── WHY IT IS SHARED ───────────────────────────────────────────────
 *
 * This is the client page's banner, lifted out of `client/[id].tsx`
 * rather than copied. Three screens had independently grown the same
 * thing — a hairline-bordered row with a 13pt muted glyph and a line of
 * `type.small` — and they had drifted:
 *
 *   client/[id]      borderStrong  radius.input  gap sm  centred
 *   inquiry/[id]     borderStrong  radius.card   gap sm  centred   (guest)
 *   inquiry/[id]     borderSoft    radius.card   gap sm  top       (portal)
 *
 * Three radii and two border weights for one component. They are now one
 * component, and the differences that were real — a banner whose text
 * runs to several lines wants its icon at the TOP, not floated in the
 * vertical middle — survive as a prop instead of as a fourth stylesheet.
 *
 * The border is `borderStrong` and the radius is `radius.input`, which is
 * what the client page shipped and what the owner has been looking at.
 */
export function Banner({
  icon,
  Icon,
  text,
  align = 'center',
  tone = 'muted',
}: {
  icon?: React.ComponentProps<typeof Feather>['name'];
  /**
   * A glyph from `components/icons` — the module that carries web's own
   * paths — for the concepts where web and Feather draw genuinely
   * different pictures. Takes precedence over `icon`.
   *
   * Both, rather than a migration to one: for most glyphs the two sets
   * are the same drawing (measured — check, close, plus, filter, info,
   * map-pin and the chevrons are indistinguishable at 13pt), so churning
   * every call site would be motion without a change.
   */
  Icon?: React.ComponentType<{ size?: number; color: string }>;
  text: string;
  /**
   * `top` for a banner whose text wraps. A centred icon beside three
   * lines of text sits opposite the middle of the paragraph and reads as
   * a mistake; beside one line it is correct. The call site knows which
   * it has.
   */
  align?: 'center' | 'top';
  /**
   * `accent` is for a banner that reports something about the VIEWER's
   * standing rather than the record's — being a guest at another studio,
   * which changes what the screen is allowed to show them.
   */
  tone?: 'muted' | 'accent';
}) {
  const ink = tone === 'accent' ? colors.accent : colors.fgMuted;
  return (
    <View style={[styles.banner, align === 'top' && styles.bannerTop]}>
      {Icon ? (
        <View style={align === 'top' ? styles.iconTop : undefined}>
          <Icon size={13} color={ink} />
        </View>
      ) : icon ? (
        <Feather name={icon} size={13} color={ink} style={align === 'top' ? styles.iconTop : undefined} />
      ) : null}
      <Text style={[styles.bannerText, tone === 'accent' && styles.bannerTextAccent]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    padding: space.md,
  },
  bannerTop: { alignItems: 'flex-start' },
  /* Feather's glyph box is 13pt against a 19pt line box, so a raw
     top-align leaves it sitting above the text's cap height. Two points
     down puts it on the first line rather than over it. */
  iconTop: { marginTop: 2 },
  bannerText: { ...type.small, color: colors.fgMuted, flex: 1 },
  bannerTextAccent: { color: colors.accent },
});

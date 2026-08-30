import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, hairline, space, type } from '@/theme';

export interface UnderlineTab<T extends string> {
  key: T;
  label: string;
}

/*
 * ─── MEASURED OFF THE TARGET ────────────────────────────────────────
 *
 * `design-refs/session-ar/tabs-target.png`, sampled rather than eyeballed.
 * At the crop's 1320px width read as a 393pt screen (3.36x):
 *
 *   gold bar     y 143-148, 6px   -> 1.8pt, taken to 2
 *                rgb(190,156,105) -> colors.accent (#c99a5b) within
 *                                    JPEG noise
 *   hairline     y 149-151, 3px   -> 0.9pt, the `hairline` token
 *                rgb(55,48,35)
 *   active       near-white       -> colors.fg
 *   inactive     rgb(151,145,133) -> colors.fgMuted (#9b927f) closest
 *
 * THE BAR IS THE TAB'S FULL WIDTH, NOT THE TEXT'S. Measured, the bar
 * spans x 72-325 (254px) while the label's glyphs span 123-275 (152px) —
 * so it runs under the tab's padding too, 51px (~15pt) either side of the
 * text. That is the detail that makes it read as a tab rather than an
 * underlined word.
 *
 * ONE DELIBERATE DIVERGENCE. The target's hairline starts 72px (~21pt)
 * from the crop's left edge; this uses `space.lg` (16), which is the
 * inset the list's own cards use. The crop's absolute scale is not
 * certain enough to justify a non-token 21pt, and lining the rule up
 * with the cards beneath it matters more on the real screen than
 * matching a possibly-mis-scaled reference. The RELATIONSHIP the target
 * shows — bar to text = ~15pt — is kept exactly.
 */
const BAR_HEIGHT = 2;

/**
 * The top-level view switcher: underline tabs over a full-width rule.
 *
 * Replaces the pill row for this job. Pills read as filters — something
 * you toggle on top of a list — where these read as what they are, two
 * views of the same screen.
 *
 * NO COUNTS, deliberately, and this is a real removal rather than an
 * omission. The pill version carried them; the screen's own sub-header
 * already says "24 inquiries · 18 projects" directly above, so the
 * badges were a second copy of the same two numbers 40px away. The
 * target has none either.
 *
 * SENTENCE CASE. The pill call site uppercased its labels
 * (`label.toUpperCase()`); the target does not, and neither does this.
 *
 * Renders nothing with fewer than two tabs — a permanently-selected sole
 * option is noise, and on this app that is the normal case for an artist
 * rather than an edge case (inherited from `SegmentedControl`, which had
 * learned it).
 *
 * Horizontally scrollable for the same reason the pill row was: labels
 * are role-dependent and a fixed row would clip rather than degrade on a
 * small phone.
 */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: UnderlineTab<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  if (tabs.length < 2) return null;

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        /* flexGrow 0 is load-bearing, not tidiness: a horizontal
           ScrollView in a flex column otherwise takes all the height on
           offer and stretches its children to fill it. The pill row
           learned this the hard way — see SegmentedControl's own note. */
        style={styles.strip}
        contentContainerStyle={styles.stripContent}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const active = tab.key === value;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {tab.label}
              </Text>
              {/* Absolute, so the bar cannot add height to the tab and
                  shift the labels when selection moves. */}
              {active ? <View style={styles.bar} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  /* The rule lives on the ROOT, not the scroll content, so it spans the
     full width even when the tabs are narrower than the screen — the
     target shows it running well past the last label. */
  root: {
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
    marginHorizontal: space.lg,
  },
  strip: { flexGrow: 0 },
  stripContent: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs },

  tab: {
    /*
     * 20, not space.lg (16), and the reason is a scale-independent
     * measurement rather than taste.
     *
     * The target's bar is 1.66x its active label's width; at 16 this
     * rendered 1.53x. Padding itself already matched — 16.5px here
     * against the target's ~15pt — so the difference is that this build
     * sets the label larger than the reference does (the target's tab
     * type reads ~12.5pt if its crop is a 393pt screen).
     *
     * The crop's absolute scale is NOT certain enough to move the type
     * down to 12.5pt, which would be small for a primary tab on a phone
     * and would break step with the repo's own type scale. The RATIO is
     * certain, so it is matched here instead: label 62pt + 2x20 = 102,
     * which is 1.65x. Recorded so a later session with a known-scale
     * reference can revisit the type instead.
     */
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  pressed: { opacity: 0.6 },

  label: { ...type.body, fontSize: 17, color: colors.fgMuted },
  /* The only two things that change with selection: the ink, and the
     bar's presence. No weight change — the target's active label is the
     same face, just brighter. */
  labelActive: { color: colors.fg },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: BAR_HEIGHT,
    backgroundColor: colors.accent,
  },
});

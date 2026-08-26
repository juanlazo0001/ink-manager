import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme';

/**
 * Every screen's outer frame — background and chrome from ONE place.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────
 *
 * The shared photo/wash/grain ground is rendered ONCE at the root, as a
 * sibling of the navigator (`app/_layout.tsx`). For it to show, every
 * screen above it has to be transparent — and until now every screen
 * declared that for itself, by hand:
 *
 *   home.tsx       screen: { flex: 1, backgroundColor: 'transparent' }   ✓
 *   schedule.tsx   screen: { flex: 1, backgroundColor: 'transparent' }   ✓
 *   clients.tsx    screen: { flex: 1, backgroundColor: colors.bg }       ✗
 *   team.tsx       screen: { flex: 1, backgroundColor: colors.bg }       ✗
 *   tasks.tsx      screen: { flex: 1, backgroundColor: colors.bg }       ✗
 *   scan.tsx       screen: { flex: 1, backgroundColor: colors.bg }       ✗
 *
 * That is the whole of the Clients "missing background" bug, twice over:
 * the screen was painting an opaque page ground of its own, directly on
 * top of the photo. Session X moved Clients into the tab navigator, which
 * fixed the tab bar and could not have fixed this — the navigator was
 * never the thing covering it.
 *
 * A per-screen decision that has to be right on every screen will be
 * wrong on some of them, and was. So it is not a per-screen decision any
 * more: this component owns it, and a new screen gets it by construction
 * rather than by remembering.
 *
 * ─── THE DEV ASSERTION ──────────────────────────────────────────────
 *
 * `style` still exists for layout, and someone could still pass a
 * background through it. In development that now throws loudly instead of
 * quietly hiding the photo — the failure mode this class of bug has
 * always had is that it looks *fine*, just flat.
 */
export function ScreenShell({
  children,
  /** Which edges get safe-area padding. Defaults to the top only. */
  edges = ['top'],
  style,
}: {
  children: ReactNode;
  edges?: ReadonlyArray<'top' | 'bottom' | 'left' | 'right'>;
  style?: { [key: string]: unknown };
}) {
  if (__DEV__ && style && 'backgroundColor' in style) {
    throw new Error(
      'ScreenShell: do not set backgroundColor. The shared photo ground is ' +
        'rendered once at the root and an opaque screen hides it — that is ' +
        'the exact bug this component exists to prevent.',
    );
  }

  return (
    <SafeAreaView style={[styles.shell, style as never]} edges={edges as never}>
      {children}
    </SafeAreaView>
  );
}

/**
 * The same frame for a screen that genuinely wants an opaque ground —
 * the camera scanner, where a photo behind a viewfinder is noise.
 *
 * Separate and named rather than a flag, so choosing it is a decision
 * someone made on purpose and can be found by grepping.
 */
export function OpaqueScreenShell({
  children,
  edges = ['top'],
}: {
  children: ReactNode;
  edges?: ReadonlyArray<'top' | 'bottom' | 'left' | 'right'>;
}) {
  return (
    <SafeAreaView style={styles.opaque} edges={edges as never}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /* Transparent, always. See the note above. */
  shell: { flex: 1, backgroundColor: 'transparent' },
  opaque: { flex: 1, backgroundColor: colors.bg },
});

/**
 * A screen body's standard inset — the padding a scrolling page uses
 * under the chrome. Exported so screens stop each inventing one; session
 * Y's Tasks collision was a screen that had none.
 */
export const SCREEN_CONTENT_INSET = { padding: 16, paddingBottom: 32 } as const;

/**
 * The air above a screen's first element — its eyebrow, usually.
 *
 * Home had `paddingTop: space.xl` on its own welcome block and nothing
 * else did, so Clients and Team sat their eyebrows tight under the top
 * bar while Home's breathed. One token now, stated in one place, so the
 * three cannot drift apart again.
 */
export const SCREEN_TOP_INSET = 24;

/**
 * The gap between an eyebrow and the title under it.
 *
 * OWNER-DIRECTED DIVERGENCE. Web is `mt-1` — 4px — and session Z matched
 * it exactly. The owner wants more air, so this is one step up the scale
 * rather than a number picked by eye: 8px. Recorded as a divergence from
 * web, because that is what it is.
 */
export const EYEBROW_TITLE_GAP = 8;

import type { Transition, Variants } from 'framer-motion'

// Shared Framer Motion presets -- the reusable foundation for animation
// work elsewhere in the app, not a one-off inline definition. Kept
// deliberately small: only what AuthLayout's card/heading crossfade
// actually needs right now, not a speculative library of presets for
// uses that haven't come up yet.

// Spring, not a fixed-duration easing curve -- adopted from motion.dev's
// "Clerk: Sign-in-or-up" example (the reference this technique was
// borrowed from), which drives its whole sign-in/verify transition off
// one MotionConfig-level spring rather than per-element durations. bounce
// controls how much it overshoots before settling (0.25 -- present but
// restrained, doesn't visibly oscillate); visualDuration is the
// perceived time-to-settle Framer uses to derive the underlying
// stiffness/damping.
//
// visualDuration TEMPORARILY DOUBLED (0.38 -> 0.76) for tuning purposes --
// slow enough to actually watch each phase of the motion happen rather
// than guessing from a blur. Dial back toward something snappier (0.38
// was the last real value, itself within the 0.2-0.3 bounce / 0.35-0.4s
// duration ranges spring physics research suggests for this kind of UI
// transition) once the restructured button/card feels structurally right
// at this slower speed.
export const authSpringTransition: Transition = {
  type: 'spring',
  bounce: 0.25,
  visualDuration: 0.76,
}

// Same spring feel as authSpringTransition (type/bounce identical -- one
// physics language app-wide, not a competing config) but scaled down for
// everyday UI motion: route transitions, panels, dropdowns, list items.
// authSpringTransition's own 0.76s (itself still mid-tuning toward a
// slower final 0.38s) was built for one dramatic, rarely-repeated card
// swap; app-wide chrome that fires on every click/nav needs to stay in
// the 150-300ms "polish, not spectacle" range or it starts to feel like
// it's delaying real work. 0.22s keeps the same restrained bounce
// perceptible without that cost.
export const uiSpringTransition: Transition = {
  type: 'spring',
  bounce: 0.25,
  visualDuration: 0.22,
}

// Route/page-content transition (PageFade, App.tsx + AppShellLayout). A
// plain opacity tween, not a spring -- a spring's continuous, physics-
// driven position updates read as choppy once real page content (tables,
// grids, forms) is reflowing underneath it at the same time, unlike the
// small, isolated UI elements the spring presets above are built for.
// Kept as its own constant since it's tuned specifically for "once per
// navigation," not everyday chrome.
export const pageTransition: Transition = {
  type: 'tween',
  duration: 0.15,
  ease: 'easeOut',
}

// Dropdown/menu open -- scale + fade from just above the trigger button,
// brief enough to read as instant despite being animated. One shared
// shape for every button+popover dropdown in the app (Filter/Sort in
// ConversationsPanel, DateRangePresetFilter, MultiSelectFilter,
// ArtistSelect) rather than each inventing its own variant.
export const dropdownVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: -4 },
}

// The card itself: opacity + a small vertical settle, no blur -- kept
// visually distinct from the heading's own treatment below so the
// heading swap reads as its own small "materialize" moment rather than
// just a bigger copy of the same effect.
export const crossfadeVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

// For a swapped piece of TEXT specifically (originally built for a
// heading that's since been removed -- the button label swap below is
// what carries that "this is a different action now" signal instead):
// fade + blur-in/blur-out (not just opacity), per the Clerk reference's
// own TEXT_VARIANTS. The blur is what gives a text swap its own distinct
// feel from a plain fade, like the words are resolving into focus rather
// than just appearing.
export const blurTextVariants: Variants = {
  initial: { opacity: 0, filter: 'blur(10px)', y: -10 },
  animate: { opacity: 1, filter: 'blur(0px)', y: 0 },
  exit: { opacity: 0, filter: 'blur(10px)', y: 10 },
}

// Background `.rings` decoration: a small rotate + scale nudge per auth
// mode, driven by AuthLayout's existing `mode` value (same one that keys
// the card/button transition) and animated with the same
// `authSpringTransition` spring -- deliberately small (a few degrees, a
// couple percent) so it reads as atmospheric depth behind the card, not a
// showy background effect competing with the foreground transition. Keyed
// by every AuthMode (not just sign-in/forgot-password) so Reset Password /
// Accept Invite / Confirm Email Change get their own subtle position too,
// rather than all three sharing sign-in's default.
export const ringModeTransform: Record<string, { rotate: number; scale: number }> = {
  'sign-in': { rotate: 0, scale: 1 },
  'forgot-password': { rotate: 4, scale: 1.015 },
  'reset-password': { rotate: -4, scale: 0.985 },
  'accept-invite': { rotate: 6, scale: 1.02 },
  'confirm-email-change': { rotate: -6, scale: 0.98 },
}

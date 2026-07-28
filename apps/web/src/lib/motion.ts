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
// stiffness/damping (0.38s -- both landed on by eye against the real
// transition, within the 0.2-0.3 / 0.35-0.4s ranges spring physics
// research suggests for this kind of UI transition, not picked from a
// formula).
export const authSpringTransition: Transition = {
  type: 'spring',
  bounce: 0.25,
  visualDuration: 0.38,
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

// The heading text specifically: fade + blur-in/blur-out (not just
// opacity), same asymmetric y-offset direction as the card (down on
// enter, up... mirrored the other way, per the Clerk reference's own
// TEXT_VARIANTS) -- the blur is what gives this its own distinct feel
// from the card's plain fade, like the words are resolving into focus
// rather than just appearing.
export const headingVariants: Variants = {
  initial: { opacity: 0, filter: 'blur(10px)', y: -10 },
  animate: { opacity: 1, filter: 'blur(0px)', y: 0 },
  exit: { opacity: 0, filter: 'blur(10px)', y: 10 },
}

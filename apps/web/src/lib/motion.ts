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

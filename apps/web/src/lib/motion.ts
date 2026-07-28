import type { Transition, Variants } from 'framer-motion'

// Shared Framer Motion presets -- the reusable foundation for animation
// work elsewhere in the app, not a one-off inline definition. Kept
// deliberately small: only what AuthLayout's card crossfade actually
// needs right now, not a speculative library of presets for uses that
// haven't come up yet.

// Opacity + a small upward settle on enter (mirrored on exit) -- tuned by
// eye against the real transition, not picked from a formula. 320ms reads
// as smooth without feeling sluggish; the eased curve (Framer's own
// "easeOut"-equivalent cubic) gives entering content a gentle deceleration
// rather than a linear slide.
export const crossfadeVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

export const crossfadeTransition: Transition = {
  duration: 0.32,
  ease: [0.16, 1, 0.3, 1],
}

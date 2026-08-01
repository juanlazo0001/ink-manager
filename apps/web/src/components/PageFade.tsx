import { forwardRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { pageTransition } from '../lib/motion'

// Plain opacity fade used for both the top-level (public/auth) route
// transitions in App.tsx and the authenticated app shell's own internal
// page-content transitions (AppShellLayout) -- one shared definition so
// the two never drift into two different-feeling animations. No y-
// translate: combined with a spring, that read as choppy once real page
// content (tables, grids, forms) started reflowing underneath it mid-
// animation -- a plain fade has no position to keep re-settling as the
// layout shifts. Requires a forwardRef (AnimatePresence's popLayout mode
// needs to measure/position the real DOM node while it's popped out
// during exit), same requirement as AuthLayout's own AuthCard.
const PageFade = forwardRef<HTMLDivElement, { children: ReactNode }>(function PageFade({ children }, ref) {
  return (
    <motion.div
      ref={ref}
      className="relative z-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={pageTransition}
    >
      {children}
    </motion.div>
  )
})

export default PageFade

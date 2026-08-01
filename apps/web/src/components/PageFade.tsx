import { forwardRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { pageTransition } from '../lib/motion'

// Brief fade+settle used for both the top-level (public/auth) route
// transitions in App.tsx and the authenticated app shell's own internal
// page-content transitions (AppShellLayout) -- one shared definition so
// the two never drift into two different-feeling animations. Requires a
// forwardRef (AnimatePresence's popLayout mode needs to measure/position
// the real DOM node while it's popped out during exit), same requirement
// as AuthLayout's own AuthCard.
const PageFade = forwardRef<HTMLDivElement, { children: ReactNode }>(function PageFade({ children }, ref) {
  return (
    <motion.div
      ref={ref}
      className="relative z-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={pageTransition}
    >
      {children}
    </motion.div>
  )
})

export default PageFade

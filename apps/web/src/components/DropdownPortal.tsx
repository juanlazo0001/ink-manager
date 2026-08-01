import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { dropdownVariants, uiSpringTransition } from '../lib/motion'

interface DropdownPortalProps {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  // 'start' aligns the panel's left edge to the anchor's left edge
  // (ArtistSelect, which also matches the anchor's width); 'end' aligns
  // the panel's right edge to the anchor's right edge (the "More
  // actions" kebab menus, which open toward the left instead).
  align?: 'start' | 'end'
  matchWidth?: boolean
  // Upper bound on the panel's height when there's ample room -- the
  // panel still shrinks (and its own content scrolls, via the base
  // overflow-y-auto below) whenever the viewport genuinely has less
  // space than this, whichever side it ends up opening toward.
  maxHeightCap?: number
  className?: string
  children: ReactNode
}

const VIEWPORT_MARGIN = 8

// Every one of this app's `.card-surface` widget cards (Widget.tsx) has
// `backdrop-filter: blur(...)` for the Editorial Gold frosted-glass look
// -- and backdrop-filter, like transform or opacity<1, creates its own
// CSS stacking context. A dropdown panel positioned `absolute` inside one
// widget can visually overflow past that widget's own box (position:
// absolute isn't clipped by a non-overflow-hidden ancestor), but it can
// never paint ABOVE a later sibling widget once it crosses into that
// sibling's space -- the sibling's own stacking context (also from its
// own backdrop-filter) always wins there, regardless of the dropdown's
// z-index, since z-index only ever resolves within a shared stacking
// context. On mobile, where widgets stack in one column with little
// room below a trigger, this reliably ate the bottom of the "Assign
// Artist" list and the per-widget "More actions" menus.
//
// Rendering the panel through a portal straight to <body> sidesteps the
// stacking-context problem entirely -- it's no longer a descendant of
// any widget's stacking context, so it always paints above everything.
// That alone wasn't the full story on a short mobile viewport, though:
// a trigger sitting near the bottom of the screen still has nowhere to
// open a panel downward into. So this also does simple collision
// detection -- if there isn't enough room below the trigger but there
// IS more room above it, the panel opens upward instead, and either way
// its own max-height is clamped to whatever space is actually
// available (with its own internal scroll) rather than running off the
// edge of the viewport.
export default function DropdownPortal({
  open,
  onClose,
  anchorRef,
  align = 'start',
  matchWidth = false,
  maxHeightCap = 320,
  className = '',
  children,
}: DropdownPortalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    if (!anchor) return

    function place() {
      const rect = anchor!.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN
      const spaceAbove = rect.top - VIEWPORT_MARGIN
      // Only flip to opening upward if there's genuinely more room that
      // way -- a trigger with little room on EITHER side (a short
      // viewport, not just a low-on-the-page trigger) should still just
      // open downward and rely on the max-height clamp below, matching
      // where a user's thumb/eye already is.
      const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow

      setStyle({
        position: 'fixed',
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        ...(align === 'start' ? { left: rect.left } : { right: window.innerWidth - rect.right }),
        ...(matchWidth ? { width: rect.width } : {}),
        maxHeight: Math.max(0, Math.min(maxHeightCap, openUpward ? spaceAbove : spaceBelow)),
      })
    }

    place()
    // capture: true so this also fires for scrolling inside a nested
    // scroll container (e.g. AppShellLayout's own overflow-y-auto page
    // area), not just the window -- otherwise the panel would drift out
    // of place under its trigger as soon as any ancestor scrolled.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, align, matchWidth, maxHeightCap])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onClose, anchorRef])

  return createPortal(
    <AnimatePresence>
      {open && style && (
        <motion.div
          ref={panelRef}
          className={`z-50 overflow-y-auto ${className}`}
          style={style}
          variants={dropdownVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={uiSpringTransition}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

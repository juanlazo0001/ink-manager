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

// Validation pass finding: the Send-channel picker's own menu shipped
// completely invisible the first time -- floating unstyled text
// overlapping whatever was underneath it -- because this component
// supplied zero default panel chrome and that call site forgot to pass
// its own. Every other existing call site already passed matching
// classes by convention, which is exactly the kind of thing that's
// easy to forget once and ship broken. A real default (still
// override-able/extendable via the className prop below, which is
// appended after this) means a caller that forgets can no longer ship
// an invisible menu -- worst case it looks generic, never blank.
const DEFAULT_PANEL_CLASSES = 'rounded-xl border border-border bg-surface-raised p-1 shadow-xl'

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

  // The vertical flip above only works because rect.top/rect.bottom are
  // known before the panel ever renders. Horizontal overflow can't be
  // solved the same way -- the panel's own width depends on its content
  // (or a fixed className like SendChannelButton's `w-40`), which isn't
  // known until AFTER it's actually in the DOM. Validation-pass finding,
  // live-reproduced: a `align="end"` panel anchored to a narrow trigger
  // sitting near the LEFT edge of the screen (e.g. a widget header whose
  // title wrapped, pushing its icon-only mobile actions row flush left)
  // computed a negative `left`, rendering the menu half off-screen.
  // This second pass measures the real, already-rendered panel and
  // nudges it back on-screen -- guarded to only fire once the overflow
  // actually happens, so it's a no-op (no extra render) for every panel
  // that already fit.
  // CRASHED PRODUCTION (React #185, "Maximum update depth exceeded"), iOS
  // Safari only, reported from a real iPhone via the ErrorBoundary's new
  // crash reporting. The version below used to write a NEW style object
  // unconditionally while depending on `style`, so for a panel that CANNOT
  // fit the viewport it ping-ponged forever: nudging it right made the left
  // edge overflow, nudging it left made the right edge overflow, and each
  // pass re-ran this effect.
  //
  // Why only iOS: the specialties input is 14px, under Safari's 16px
  // threshold, so focusing it AUTO-ZOOMS the page. That shrinks
  // window.innerWidth while the matchWidth panel keeps the anchor's layout
  // width -- and a panel wider than the viewport is exactly the unfittable
  // case. No desktop engine does that zoom, which is why Chromium and even
  // Playwright's WebKit never reproduced it.
  //
  // Two changes make it converge: clamp the WIDTH (a panel constrained to
  // the available space can satisfy both edges at once, so there is nothing
  // to oscillate between), and only write when a value actually CHANGES.
  useLayoutEffect(() => {
    if (!open || !style) return
    const panel = panelRef.current
    if (!panel) return

    const available = window.innerWidth - VIEWPORT_MARGIN * 2
    const rect = panel.getBoundingClientRect()

    let nextLeft = style.left
    let nextRight = style.right
    let nextMaxWidth = style.maxWidth

    if (rect.width > available) nextMaxWidth = available

    if (rect.left < VIEWPORT_MARGIN) {
      nextLeft = VIEWPORT_MARGIN
      nextRight = undefined
    } else if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      nextRight = VIEWPORT_MARGIN
      nextLeft = undefined
    }

    // The guard that makes this terminate. setStyle always produces a new
    // object and this effect depends on `style`, so an unconditional write
    // is an infinite render loop by construction -- no matter how correct
    // the geometry above is.
    if (nextLeft === style.left && nextRight === style.right && nextMaxWidth === style.maxWidth) {
      return
    }

    setStyle((prev) =>
      prev ? { ...prev, left: nextLeft, right: nextRight, maxWidth: nextMaxWidth } : prev,
    )
  }, [open, style])

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
          className={`z-50 overflow-y-auto ${DEFAULT_PANEL_CLASSES} ${className}`}
          style={style}
          // Mobile hardening: the ~220ms exit fade (dropdownVariants,
          // shared with every other dropdown in the app) otherwise leaves
          // this panel fully interactive while it's visually shrinking
          // away -- a stray second contact point landing on it during
          // that window (a real touchscreen quirk, not just a mouse
          // concern) could re-fire an option's onClick, or land just
          // outside the now-smaller/offset bounds and hit whatever's
          // behind it instead (e.g. a hosting Modal's scrim). Only the
          // exit variant is overridden here -- lib/motion.ts's own
          // dropdownVariants stays untouched for every other consumer
          // (ArtistSelect, ConversationsPanel's filter/sort, etc.), none
          // of which sit inside a dismiss-on-outside-click Modal the way
          // this component's callers sometimes do.
          variants={{ ...dropdownVariants, exit: { ...dropdownVariants.exit, pointerEvents: 'none' } }}
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

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { CloseIcon, DragHandleIcon } from './icons'
import { useThemePreset } from '../lib/useThemePreset'
import { uiSpringTransition } from '../lib/motion'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  // 'large' is for content that wants real room to work in (WYSIWYG
  // editors) -- 80% viewport height, 60% width, with the body area
  // flexed so a `fill`-mode child (e.g. RichTextEditor) can grow into
  // the space instead of the dialog just growing with its content.
  size?: 'default' | 'large'
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Ref-counted so nested/stacked modals don't fight over restoring the
// body's previous overflow value -- only the outermost lock/unlock pair
// actually touches the style.
let scrollLockCount = 0
let previousBodyOverflow = ''

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function unlockBodyScroll() {
  scrollLockCount -= 1
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow
  }
}

// Instant, no-transition override for x/y specifically while dragging --
// Motion's own spring would otherwise chase the pointer's fast-moving
// target every frame instead of tracking it 1:1, i.e. visible lag.
const NO_TRANSITION = { duration: 0 }

export default function Modal({ title, onClose, children, size = 'default' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  // Closing intercepts the real onClose: it plays the exit animation
  // first, then calls onClose from the dialog's own onAnimationComplete
  // once that animation actually finishes -- no hardcoded duration to
  // keep in sync with the animation itself.
  const [closing, setClosing] = useState(false)

  // Drag-to-move: an offset from the dialog's normal centered position,
  // dragged from the header. Resets to (0, 0) for free on every open since
  // each Modal call site mounts a fresh instance -- no explicit reset needed.
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    lockBodyScroll()
    return unlockBodyScroll
  }, [])

  useEffect(() => {
    if (!dragging) return

    function handlePointerMove(event: PointerEvent) {
      setPosition({ x: event.clientX - dragStartRef.current.x, y: event.clientY - dragStartRef.current.y })
    }
    function handlePointerUp() {
      setDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragging])

  // Only the header itself starts a drag -- not the close button (or
  // anything else a caller might one day add up there).
  function handleHeaderPointerDown(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest('button')) return
    dragStartRef.current = { x: event.clientX - position.x, y: event.clientY - position.y }
    setDragging(true)
  }

  function requestClose() {
    setClosing(true)
  }

  // Accessibility floor: Esc closes, focus starts inside and stays trapped
  // while the modal is open (Tab/Shift+Tab wrap within it instead of
  // escaping to the page behind the scrim).
  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    firstFocusable?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: closing ? 0 : 1 }}
      transition={uiSpringTransition}
      onClick={requestClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          size === 'large'
            ? 'flex w-[92vw] max-w-[92vw] flex-col md:w-[60vw] md:max-w-[60vw] h-[80vh] max-h-[80vh]'
            : 'flex w-full max-w-md max-h-[85vh] flex-col',
          isEditorial
            ? 'rounded-card border border-border bg-surface-raised p-6 shadow-2xl'
            : 'rounded-2xl border border-border bg-surface p-6',
        ].join(' ')}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: closing ? 0 : 1, scale: closing ? 0.95 : 1, x: position.x, y: position.y }}
        transition={dragging ? { default: uiSpringTransition, x: NO_TRANSITION, y: NO_TRANSITION } : uiSpringTransition}
        onAnimationComplete={() => {
          if (closing) onClose()
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          onPointerDown={handleHeaderPointerDown}
          className={['flex shrink-0 items-center gap-1.5 justify-between', dragging ? 'cursor-grabbing select-none' : 'cursor-grab'].join(' ')}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <DragHandleIcon className="h-4 w-4 shrink-0 text-fg-muted" />
            <h2 className={isEditorial ? 'sc truncate text-[19px]' : 'truncate text-lg font-semibold text-fg'}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div
          className={
            size === 'large' ? 'mt-4 flex min-h-0 flex-1 flex-col' : 'mt-4 min-h-0 flex-1 overflow-y-auto'
          }
        >
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}

import { useEffect, useRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { uiSpringTransition } from '../../lib/motion'
import { CloseIcon } from '../icons'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Session checkout's client-facing payment moment, staged full-screen in
// Editorial Gold (login-shell) rather than the studio's own theme -- same
// "this moment is the platform's own brand, not the studio's" reasoning
// deposit/flash pages already use. Fixed inset-0 + focus trap, same
// pattern as components/Modal.tsx, but no scrim-click-to-close (this is a
// payment flow, not a dismissible dialog -- closing is an explicit
// "step away" action, not an accidental click).
export default function PaymentTakeoverOverlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const firstFocusable = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    firstFocusable?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !container) return
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
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
  }, [])

  return (
    <motion.div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      className="login-shell fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-bg px-4 py-10 text-fg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={uiSpringTransition}
    >
      <div className="login-panel-surface relative w-full max-w-lg p-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Step away from payment"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
        {children}
      </div>
    </motion.div>
  )
}

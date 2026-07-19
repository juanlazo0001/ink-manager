import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloseIcon } from './icons'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Every modal in the app (new client, draft inquiry, etc.) goes through
// this one component, so its open/close motion is the single place that
// needs to carry it -- no per-call-site animation work anywhere else.
const CLOSE_ANIMATION_MS = 200

export default function Modal({ title, onClose, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  // Mounts in its "before" state (invisible/scaled down) on the very first
  // render, then flips to "entered" a tick later so the transition to that
  // state is what actually animates -- mounting already-visible would skip
  // the transition entirely (no state change to observe).
  const [entered, setEntered] = useState(false)
  // Closing intercepts the real onClose: it plays the exit transition first,
  // then calls onClose after CLOSE_ANIMATION_MS so the parent doesn't unmount
  // this component out from under its own animation.
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function requestClose() {
    setClosing(true)
    setTimeout(onClose, CLOSE_ANIMATION_MS)
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

  const shown = entered && !closing

  return (
    <div
      className={[
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 transition-opacity duration-base',
        shown ? 'opacity-100 ease-out' : 'opacity-0 ease-in',
      ].join(' ')}
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          'w-full max-w-md rounded-2xl border border-border bg-surface p-6 transition-[opacity,transform] duration-base',
          shown ? 'scale-100 opacity-100 ease-out' : 'scale-95 opacity-0 ease-in',
        ].join(' ')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

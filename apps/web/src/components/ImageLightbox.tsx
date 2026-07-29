import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { uiSpringTransition } from '../lib/motion'
import { ChevronDownIcon, CloseIcon } from './icons'

interface ImageLightboxProps {
  images: string[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

// Full-screen click-to-enlarge viewer for message attachments -- Escape
// and clicking the scrim both close it, arrow keys step through every
// image in the SAME message (not the whole conversation) when there's
// more than one. No portal, no drag-to-move -- unlike Modal.tsx this
// isn't a form/workspace someone repositions, just a viewer.
export default function ImageLightbox({ images, index, onIndexChange, onClose }: ImageLightboxProps) {
  const hasMultiple = images.length > 1
  const canPrev = index > 0
  const canNext = index < images.length - 1

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Capture phase + stopPropagation, not just a bubble-phase listener
      // -- the Conversations panel itself has its own window-level Escape
      // handler (closes the whole slide-over), registered when the panel
      // mounts, long before this lightbox ever does. Bubble-phase
      // listeners on the same target (window) fire in registration order,
      // so the panel's own handler would always run first and slide the
      // entire panel away -- image and all -- instead of just dismissing
      // the viewer. Capture-phase runs before any bubble-phase listener
      // regardless of registration order, so intercepting and stopping it
      // here reliably takes priority.
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      } else if (event.key === 'ArrowLeft' && canPrev) {
        event.stopPropagation()
        onIndexChange(index - 1)
      } else if (event.key === 'ArrowRight' && canNext) {
        event.stopPropagation()
        onIndexChange(index + 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [index, canPrev, canNext, onIndexChange, onClose])

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 sm:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={uiSpringTransition}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
      >
        <CloseIcon className="h-5 w-5" />
      </button>

      {hasMultiple && canPrev && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onIndexChange(index - 1)
          }}
          aria-label="Previous image"
          className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70 sm:left-4"
        >
          <ChevronDownIcon className="h-5 w-5 rotate-90" />
        </button>
      )}
      {hasMultiple && canNext && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onIndexChange(index + 1)
          }}
          aria-label="Next image"
          className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70 sm:right-4"
        >
          <ChevronDownIcon className="h-5 w-5 -rotate-90" />
        </button>
      )}

      <motion.img
        key={images[index]}
        src={images[index]}
        alt="Attachment"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={uiSpringTransition}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />

      {hasMultiple && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
          {index + 1} / {images.length}
        </div>
      )}
    </motion.div>
  )
}

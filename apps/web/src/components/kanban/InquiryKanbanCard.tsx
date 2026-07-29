import { forwardRef } from 'react'
import { useDraggable } from '@dnd-kit/react'
import { motion } from 'framer-motion'
import { ArtistAvatar, artistLabel } from '../ArtistAvatar'
import { getStatusTone } from '../StatusPill'
import { formatRelativeTime, formatPriceEstimate } from '../../lib/format'
import { uiSpringTransition } from '../../lib/motion'
import type { KanbanInquiry } from '../../lib/kanban'

const TONE_BORDER_CLASSES: Record<string, string> = {
  success: 'border-l-success',
  info: 'border-l-info',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
  neutral: 'border-l-neutral',
  progress: 'border-l-progress',
  highlight: 'border-l-highlight',
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

interface InquiryKanbanCardProps {
  inquiry: KanbanInquiry
  columnKey: string
  draggable: boolean
  onOpen?: (id: string) => void
  // True for the one card mid-transition (an async status change in
  // flight) -- was previously a separate opacity-toggling wrapper <div>
  // one level up in InquiryKanbanBoard.tsx; folded in here so this
  // component's own outer motion.div (not a wrapper div around it) is
  // the thing AnimatePresence tracks by key when a card leaves one
  // column's list and enters another's.
  pending?: boolean
}

// forwardRef -- this is a direct AnimatePresence child (InquiryKanbanBoard.tsx's
// Column) whenever a card moves between columns, same requirement as
// AuthLayout's AuthCard: Motion needs a real DOM ref to animate the exit.
const InquiryKanbanCard = forwardRef<HTMLDivElement, InquiryKanbanCardProps>(function InquiryKanbanCard(
  { inquiry, columnKey, draggable, onOpen, pending = false },
  forwardedRef,
) {
  const { ref: dragRef, isDragging } = useDraggable({
    id: inquiry.id,
    data: { columnKey, inquiry },
    disabled: !draggable,
  })

  const estimateRange = formatPriceEstimate(inquiry.priceEstimateLow, inquiry.priceEstimateHigh)
  const tone = getStatusTone(inquiry.status)

  return (
    // Outer motion.div owns layout (settle animation when this card's
    // position changes -- a drop landing, a column reflowing around it)
    // plus enter/exit (a card leaving one column's list and appearing in
    // another's). The inner div keeps dnd-kit's own ref/live-drag
    // transform fully isolated on a separate element, so Motion's
    // layout-driven transform and dnd-kit's real-time drag transform
    // never fight over the same node's style.transform.
    <motion.div
      ref={forwardedRef}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={uiSpringTransition}
    >
      <div
        ref={dragRef}
        onClick={() => onOpen?.(inquiry.id)}
        className={[
          'rounded-xl border border-l-4 border-border bg-surface p-3 text-left shadow-sm transition',
          TONE_BORDER_CLASSES[tone] ?? 'border-l-neutral',
          onOpen ? 'cursor-pointer hover:border-border-strong' : '',
          draggable ? 'cursor-grab active:cursor-grabbing' : '',
          isDragging || pending ? 'opacity-50' : 'opacity-100',
        ].join(' ')}
      >
        <p className="truncate text-sm font-semibold text-fg">
          {inquiry.client.firstName} {inquiry.client.lastName}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">{truncate(inquiry.description, 90)}</p>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          {inquiry.assignedArtist ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <ArtistAvatar artist={inquiry.assignedArtist} className="h-5 w-5" />
              <span className="truncate text-xs text-fg-secondary">{artistLabel(inquiry.assignedArtist)}</span>
            </span>
          ) : (
            <span className="text-xs text-fg-muted">Unassigned</span>
          )}
          <span className="shrink-0 text-[11px] text-fg-muted">{formatRelativeTime(inquiry.updatedAt)}</span>
        </div>

        {estimateRange && <p className="mt-2 text-xs font-medium text-fg">{estimateRange}</p>}
      </div>
    </motion.div>
  )
})

export default InquiryKanbanCard

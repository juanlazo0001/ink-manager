import { useDraggable } from '@dnd-kit/react'
import { ArtistAvatar, artistLabel } from '../ArtistAvatar'
import { getStatusTone } from '../StatusPill'
import { formatRelativeTime } from '../../lib/format'
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

function formatEstimateRange(low: number | null, high: number | null): string | null {
  if (low == null && high == null) return null
  if (low != null && high != null) return `$${low.toLocaleString()}–$${high.toLocaleString()}`
  return `$${(low ?? high)!.toLocaleString()}`
}

interface InquiryKanbanCardProps {
  inquiry: KanbanInquiry
  columnKey: string
  draggable: boolean
  onOpen?: (id: string) => void
}

export default function InquiryKanbanCard({ inquiry, columnKey, draggable, onOpen }: InquiryKanbanCardProps) {
  const { ref, isDragging } = useDraggable({
    id: inquiry.id,
    data: { columnKey, inquiry },
    disabled: !draggable,
  })

  const estimateRange = formatEstimateRange(inquiry.priceEstimateLow, inquiry.priceEstimateHigh)
  const tone = getStatusTone(inquiry.status)

  return (
    <div
      ref={ref}
      onClick={() => onOpen?.(inquiry.id)}
      className={[
        'rounded-xl border border-l-4 border-border bg-surface p-3 text-left shadow-sm transition',
        TONE_BORDER_CLASSES[tone] ?? 'border-l-neutral',
        onOpen ? 'cursor-pointer hover:border-border-strong' : '',
        draggable ? 'cursor-grab active:cursor-grabbing' : '',
        isDragging ? 'opacity-50' : 'opacity-100',
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
  )
}

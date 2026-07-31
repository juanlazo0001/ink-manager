import { useMemo, useState, type WheelEvent } from 'react'
import { DragDropProvider, useDroppable, type DragEndEvent } from '@dnd-kit/react'
import { AnimatePresence } from 'framer-motion'
import InquiryKanbanCard from './InquiryKanbanCard'
import type { KanbanColumn, KanbanInquiry, KanbanTransition } from '../../lib/kanban'

interface ResolveTransitionParams {
  inquiry: KanbanInquiry
  fromColumnKey: string
  toColumnKey: string
}

interface InquiryKanbanBoardProps {
  inquiries: KanbanInquiry[]
  columns: KanbanColumn[]
  // Only these columns can be dragged FROM or dropped INTO -- e.g. an
  // ARTIST's board renders every column their assigned inquiries touch
  // (so the pipeline is visible end to end) but the drag interaction they
  // actually have permission to invoke only ever covers ARTIST_ASSIGNED.
  interactiveColumnKeys: readonly string[]
  resolveTransition: (params: ResolveTransitionParams) => KanbanTransition | undefined
  onOpenCard?: (id: string) => void
  emptyMessage?: string
}

interface ColumnDefWithCards extends KanbanColumn {
  cards: KanbanInquiry[]
  collapsedByDefault: boolean
}

function Column({
  column,
  interactive,
  onOpenCard,
  pendingCardId,
  expanded,
  onToggleExpanded,
}: {
  column: ColumnDefWithCards
  interactive: boolean
  onOpenCard?: (id: string) => void
  pendingCardId: string | null
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const { ref, isDropTarget } = useDroppable({
    id: column.key,
    data: { columnKey: column.key },
  })

  const showCards = !column.collapsedByDefault || expanded

  return (
    <div
      ref={ref}
      className={[
        'flex w-72 shrink-0 flex-col rounded-2xl border bg-surface-inset/40 p-3 transition',
        isDropTarget ? 'border-accent bg-accent/5' : 'border-border',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={column.collapsedByDefault ? onToggleExpanded : undefined}
        className={[
          'mb-2 flex items-center justify-between gap-2 px-1 text-left',
          column.collapsedByDefault ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{column.label}</span>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-fg-secondary">
          {column.cards.length}
        </span>
      </button>

      {showCards && (
        <div className="flex flex-col gap-2">
          {column.cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-fg-muted">No cards</p>}
          <AnimatePresence initial={false}>
            {column.cards.map((inquiry) => (
              <InquiryKanbanCard
                key={inquiry.id}
                inquiry={inquiry}
                columnKey={column.key}
                draggable={interactive && pendingCardId === null}
                onOpen={onOpenCard}
                pending={pendingCardId === inquiry.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

export default function InquiryKanbanBoard({
  inquiries,
  columns,
  interactiveColumnKeys,
  resolveTransition,
  onOpenCard,
  emptyMessage = 'Nothing here yet.',
}: InquiryKanbanBoardProps) {
  const [dragError, setDragError] = useState<string | null>(null)
  const [pendingCardId, setPendingCardId] = useState<string | null>(null)
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set())
  const [mobileColumnKey, setMobileColumnKey] = useState<string | null>(null)

  const columnsWithCards = useMemo<ColumnDefWithCards[]>(
    () =>
      columns.map((column) => ({
        ...column,
        collapsedByDefault: column.key === 'INACTIVE',
        cards: inquiries.filter((inquiry) => (column.statuses as readonly string[]).includes(inquiry.status)),
      })),
    [columns, inquiries],
  )

  const effectiveMobileColumnKey = mobileColumnKey ?? columnsWithCards[0]?.key ?? null
  const mobileColumn = columnsWithCards.find((column) => column.key === effectiveMobileColumnKey)

  // Board's own overflow-x-auto already scrolls fine via a trackpad swipe,
  // shift+wheel, or dragging a visible scrollbar -- but a plain mouse
  // wheel (the common case; most mice have no horizontal scroll capability
  // at all) sends a pure vertical delta, which this element has no
  // vertical overflow of its own to capture, so it just bubbles up and
  // scrolls the whole PAGE instead of panning the board. Redirecting a
  // vertical-dominant wheel delta into horizontal scroll here is the same
  // convention most kanban/carousel UIs use, and is what actually fixes
  // "I can't scroll the board left and right" for anyone without a
  // trackpad. A genuine horizontal gesture (trackpad swipe, shift+wheel)
  // already carries a meaningful deltaX and is left completely alone.
  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const el = event.currentTarget
    if (el.scrollWidth <= el.clientWidth) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    el.scrollLeft += event.deltaY
  }

  function toggleExpanded(key: string) {
    setExpandedColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { operation, canceled } = event
    if (canceled) return

    const { source, target } = operation
    if (!source || !target) return

    const fromColumnKey = source.data?.columnKey as string | undefined
    const toColumnKey = target.id as string
    const inquiry = source.data?.inquiry as KanbanInquiry | undefined
    if (!fromColumnKey || !inquiry || fromColumnKey === toColumnKey) return

    const transition = resolveTransition({ inquiry, fromColumnKey, toColumnKey })
    if (!transition) return

    if (transition.kind === 'reject') {
      setDragError(transition.message)
      return
    }

    setDragError(null)

    if (transition.kind === 'open-flow') {
      transition.run()
      return
    }

    setPendingCardId(inquiry.id)
    transition
      .run()
      .catch((err) => setDragError(err instanceof Error ? err.message : 'Failed to move card'))
      .finally(() => setPendingCardId(null))
  }

  if (inquiries.length === 0) {
    return <p className="py-10 text-center text-sm text-fg-secondary">{emptyMessage}</p>
  }

  return (
    <div>
      {dragError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{dragError}</span>
          <button type="button" onClick={() => setDragError(null)} className="text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Desktop/tablet: full multi-column board with drag-and-drop. Below
          md, narrow columns with a horizontal-scroll-and-drag combo is a
          bad mobile interaction, so it's replaced entirely by the
          one-column-at-a-time picker below rather than just shrinking. */}
      <div className="hidden md:block">
        <DragDropProvider onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-2" onWheel={handleWheel}>
            {columnsWithCards.map((column) => (
              <Column
                key={column.key}
                column={column}
                interactive={interactiveColumnKeys.includes(column.key)}
                onOpenCard={onOpenCard}
                pendingCardId={pendingCardId}
                expanded={expandedColumns.has(column.key)}
                onToggleExpanded={() => toggleExpanded(column.key)}
              />
            ))}
          </div>
        </DragDropProvider>
      </div>

      {/* Mobile: no drag surface at all -- a column picker plus that
          column's cards as a plain stacked list. Moving a card between
          statuses on mobile still works, just through the card's own
          detail page rather than a drag gesture. */}
      <div className="md:hidden">
        <select
          value={effectiveMobileColumnKey ?? ''}
          onChange={(event) => setMobileColumnKey(event.target.value)}
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {columnsWithCards.map((column) => (
            <option key={column.key} value={column.key}>
              {column.label} ({column.cards.length})
            </option>
          ))}
        </select>

        <div className="mt-3 flex flex-col gap-2">
          {mobileColumn && mobileColumn.cards.length === 0 && (
            <p className="py-8 text-center text-xs text-fg-muted">No cards</p>
          )}
          <AnimatePresence initial={false}>
            {mobileColumn?.cards.map((inquiry) => (
              <InquiryKanbanCard key={inquiry.id} inquiry={inquiry} columnKey={mobileColumn.key} draggable={false} onOpen={onOpenCard} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

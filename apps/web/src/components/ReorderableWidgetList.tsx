import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { useWidgetLayout } from '../lib/useWidgetLayout'
import type Widget from './Widget'

interface ReorderableWidgetListProps {
  // "inquiry-detail" / "appointment-detail" -- passed straight through to
  // useWidgetLayout; a plain string so a future third page needs no schema
  // change, just a new key.
  pageKey: string
  // Every widget id this page can ever show, in its built-in fallback
  // order -- used only to place a widget the user has never touched (or
  // one shipped after their last save) in a sensible position, never to
  // restrict which widgets can appear.
  defaultOrder: string[]
  // Direct <Widget key="..."> children ONLY -- conditionally-omitted
  // widgets should just evaluate to false/null/undefined here (the normal
  // `condition && <Widget .../>` pattern), same as any other React list.
  // Each child's `key` IS its widget id (also passed as Widget's own `id`
  // prop, which must match) -- this is how order/collapsed state gets
  // matched back to the right widget regardless of how many widgets are
  // actually present at a given moment.
  children: ReactNode
}

// Generic reorder/collapse shell shared by the Inquiry and Project detail
// pages: takes each page's existing widget cards completely unchanged
// (still authored inline, in whatever source order is convenient) and
// physically reorders/hides/shows them based on the user's saved
// UserWidgetLayout (see useWidgetLayout), without either page needing to
// pre-compute widget order itself. Keeping each <Widget> physically in its
// original JSX position (rather than extracting every widget's content
// into an array literal up front) is deliberate -- it means adding this
// feature never required moving a single line of any widget's actual
// content, only swapping its outer wrapper tag.
export default function ReorderableWidgetList({ pageKey, defaultOrder, children }: ReorderableWidgetListProps) {
  const layout = useWidgetLayout(pageKey, defaultOrder)

  // Children.toArray already drops false/null/undefined -- a
  // conditionally-hidden widget (e.g. Estimate only shown for certain
  // inquiry statuses) simply isn't in this list at all, not "present but
  // collapsed." Deliberately reads each child's `id` PROP, not its React
  // `key` -- Children.toArray rewrites/prefixes keys internally (e.g.
  // ".$project-details") to keep them globally unique, so a raw string
  // comparison against `key` silently never matches anything.
  const items = Children.toArray(children).filter(
    (child): child is ReactElement<React.ComponentProps<typeof Widget>> =>
      isValidElement(child) && typeof (child.props as { id?: unknown }).id === 'string',
  )
  const presentIds = items.map((item) => item.props.id)
  const order = layout.getOrder(presentIds)
  const itemsById = new Map(items.map((item) => [item.props.id, item]))

  // Matches IntakeFormFieldsEditor.tsx's own handleDragEnd exactly:
  // initialIndex (captured at drag start) vs. the live index (already
  // reflecting dnd-kit's own optimistic in-drag reordering) is the correct
  // pair to splice with -- matching by id here would frequently see the two
  // already equal by drop time.
  function handleDragEnd(event: DragEndEvent) {
    const { source } = event.operation
    if (!source || !isSortable(source)) return
    const fromIndex = source.initialIndex
    const toIndex = source.index
    if (fromIndex === toIndex) return
    layout.reorder(presentIds, fromIndex, toIndex)
  }

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      {/* mt-6 matches the gap-6 used between widgets below -- this list
          used to be preceded by each widget's own standalone `mt-6
          rounded-2xl ...` wrapper div, which carried the gap against
          whatever came before it (the page header card). Once widgets
          became children of this shared list instead, nothing above
          replaced that margin, so the header sat flush against the list
          with zero gap -- lives here, once, rather than on every
          call site's header. */}
      <div className="mt-6 flex flex-col gap-6">
        {order.map((id, index) => {
          const item = itemsById.get(id)
          if (!item) return null
          return cloneElement(item, {
            index,
            group: pageKey,
            collapsed: layout.isCollapsed(id),
            onToggleCollapsed: () => layout.toggleCollapsed(id, presentIds),
          })
        })}
      </div>
    </DragDropProvider>
  )
}

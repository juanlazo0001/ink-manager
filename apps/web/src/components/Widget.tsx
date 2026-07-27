import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { ChevronDownIcon, DragHandleIcon } from './icons'
import { useThemePreset } from '../lib/useThemePreset'

interface WidgetProps {
  // Always set explicitly by the page -- a stable key identifying this
  // section regardless of its current position (e.g. "estimate",
  // "liability-waiver"). Must match the `key` prop on the same element,
  // since ReorderableWidgetList reads sibling order from React keys.
  id: string
  title: string
  // The existing per-widget header buttons (Edit, Send X, New X, etc.) --
  // rendered to the right of the title, same position they occupied
  // before this wrapper existed.
  actions?: ReactNode
  children: ReactNode
  className?: string
  // Everything below is injected by the parent ReorderableWidgetList via
  // cloneElement -- never set directly at the call site. Optional/defaulted
  // here only so a Widget still type-checks and renders sanely if it's ever
  // used standalone outside that wrapper.
  index?: number
  group?: string
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

// Shared collapsible/draggable card shell for every reorderable section on
// the Inquiry and Project (Appointment) detail pages -- same
// `rounded-2xl border border-border bg-surface p-5` look every one of
// those sections already used, now with a drag handle and collapse
// toggle in front of the title. Always used as a direct child of
// ReorderableWidgetList, which supplies index/group/collapsed/
// onToggleCollapsed -- see that component for the actual order/collapsed
// persistence (useWidgetLayout).
export default function Widget({
  id,
  title,
  actions,
  children,
  className,
  index = 0,
  group = 'widgets',
  collapsed = false,
  onToggleCollapsed,
}: WidgetProps) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, group })
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'

  return (
    <div
      // Also the plain HTML id, not just dnd-kit's sortable identity --
      // InquiryDetail.tsx's ?openFlow= deep links scroll to these sections
      // by getElementById, same ids ("assignment-section" etc.) they used
      // before this component existed.
      id={id}
      ref={ref}
      className={[
        isEditorial
          ? 'rounded-card border border-border bg-gradient-to-b from-white/[0.012] to-transparent bg-surface p-6'
          : 'rounded-2xl border border-border bg-surface p-5',
        className ?? '',
      ].join(' ')}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            ref={handleRef}
            aria-label="Drag to reorder"
            title="Drag to reorder"
            className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg active:cursor-grabbing"
          >
            <DragHandleIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
          >
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
          <h2 className={isEditorial ? 'sc truncate text-[19px]' : 'truncate text-base font-semibold text-fg'}>
            {title}
          </h2>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {!collapsed && <div className={isEditorial ? 'mt-5' : 'mt-4'}>{children}</div>}
    </div>
  )
}

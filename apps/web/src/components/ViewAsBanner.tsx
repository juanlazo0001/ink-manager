import { useViewAs } from '../context/useViewAs'
import { formatStatus } from '../lib/format'
import { CloseIcon, ViewIcon } from './icons'

// Persistent and unmissable by design -- full width, above everything
// content-wise (the sidebar's own z-50 still paints over its own column,
// which is the correct layered look: the banner reads as spanning "the
// rest of the app" next to a sidebar that's always on top of it). Mounted
// once at the app root (see App.tsx) so it survives every route change
// for as long as target is set.
export default function ViewAsBanner() {
  const { target, exitViewAs } = useViewAs()

  if (!target) return null

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-3 bg-warning px-4 py-2 text-sm font-medium text-bg shadow-lg">
      <ViewIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">
        Viewing as {target.name ?? target.email} — {formatStatus(target.role)} · Read-only
      </span>
      <button
        type="button"
        onClick={exitViewAs}
        className="flex shrink-0 items-center gap-1 rounded-full border border-bg/20 bg-bg/10 px-3 py-1 text-xs font-semibold transition hover:bg-bg/20"
      >
        <CloseIcon className="h-3 w-3" />
        Exit
      </button>
    </div>
  )
}

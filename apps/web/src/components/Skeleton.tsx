export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface ${className}`} />
}

export function SkeletonTableRows({
  rows = 6,
  columns = 5,
  columnClassNames,
}: {
  rows?: number
  columns?: number
  /** Per-column extra classes (e.g. `hidden md:table-cell`) to mirror the real
   *  header's responsive hiding, so loading rows don't show columns the
   *  loaded rows will immediately hide once data arrives. */
  columnClassNames?: string[]
}) {
  return (
    <tbody className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} className={['py-3', columnClassNames?.[colIndex] ?? ''].join(' ')}>
              <Skeleton className="h-4 w-full max-w-40" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  )
}

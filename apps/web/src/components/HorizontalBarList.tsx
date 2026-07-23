export interface HorizontalBarDatum {
  key: string
  label: string
  value: number
  valueLabel: string
}

interface HorizontalBarListProps {
  data: HorizontalBarDatum[]
  emptyMessage?: string
}

// Single-series magnitude comparison (funnel stages, artist utilization) --
// one hue throughout, no legend needed (dataviz skill: "a single series
// needs no legend box"). Bars are capped at 20px thick with a 4px rounded
// data-end/square baseline, and every value is a direct label at the tip
// (never hidden behind hover) -- hover/focus only adds a brightness lift so
// the mark visibly responds, per the skill's interaction guidance, without
// needing a floating tooltip for a value that's already printed on the bar.
export default function HorizontalBarList({ data, emptyMessage = 'No data for this range.' }: HorizontalBarListProps) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-muted">{emptyMessage}</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="flex flex-col gap-3">
      {data.map((d) => {
        const widthPct = Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0)
        return (
          <div key={d.key} className="group">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-fg-secondary">{d.label}</span>
              <span className="shrink-0 font-medium text-fg">{d.valueLabel}</span>
            </div>
            <div className="h-3 w-full bg-surface-inset">
              <div
                tabIndex={0}
                className="h-full rounded-r bg-accent transition-[width,filter] duration-base group-hover:brightness-110 focus-visible:brightness-110 focus-visible:outline-none"
                style={{ width: `${widthPct}%` }}
                role="img"
                aria-label={`${d.label}: ${d.valueLabel}`}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

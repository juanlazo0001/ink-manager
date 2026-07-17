const WORKLOAD = [
  { name: 'Jordan Vega', percent: 100, note: 'Fully booked', barClassName: 'bg-success' },
  { name: 'Sam Kestrel', percent: 60, note: '5 appts booked', barClassName: 'bg-fg-secondary' },
  { name: 'Dana Cho', percent: 45, note: '3 appts booked', barClassName: 'bg-fg-secondary' },
]

export default function ArtistWorkloadCard() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">Artist Workload</h2>
        <span className="text-xs font-medium text-fg-muted">This week</span>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {WORKLOAD.map((artist) => (
          <div key={artist.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-fg">{artist.name}</span>
              <span className="text-fg-secondary">{artist.percent}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
              <div className={`h-full rounded-full ${artist.barClassName}`} style={{ width: `${artist.percent}%` }} />
            </div>
            <p className="mt-1 text-xs text-fg-muted">{artist.note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

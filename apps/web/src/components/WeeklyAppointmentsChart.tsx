const WEEK_DATA = [
  { day: 'Mon', count: 4 },
  { day: 'Tue', count: 6 },
  { day: 'Wed', count: 9 },
  { day: 'Thu', count: 5 },
  { day: 'Fri', count: 7 },
]

const MAX_BAR_HEIGHT = 120

export default function WeeklyAppointmentsChart() {
  const total = WEEK_DATA.reduce((sum, d) => sum + d.count, 0)
  const max = Math.max(...WEEK_DATA.map((d) => d.count))

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-base font-semibold text-white">Appointments This Week</h2>

      <p className="mt-4 text-3xl font-bold text-white">
        {total}
        <span className="ml-2 text-xs font-medium text-neutral-400">+15% vs last week</span>
      </p>

      <div className="mt-6 flex items-end justify-between gap-3" style={{ height: MAX_BAR_HEIGHT }}>
        {WEEK_DATA.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-[11px] text-neutral-500">{d.count}</span>
            <div
              className="w-full rounded-md bg-neutral-300"
              style={{ height: `${(d.count / max) * MAX_BAR_HEIGHT}px` }}
            />
            <span className="text-xs text-neutral-500">{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

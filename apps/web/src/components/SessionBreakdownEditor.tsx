// Shared by the original "Generate & Send Estimate" flow (InquiryDetail.tsx,
// pre-conversion) and the "Revise Estimate" flow (same file, post-conversion)
// -- one input for declaring/editing a multi-session plan's per-session hour
// ranges, so the two flows can never drift out of sync with each other.
//
// Split into two pieces (not one component) because the two flows embed the
// "Number of sessions" select inside a price/time grid, then render the
// per-session hour rows as a separate full-width block below that grid --
// splitting lets each flow keep that exact layout.
export const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1)
export const SESSION_COUNT_OPTIONS = Array.from({ length: 6 }, (_, i) => i + 1)

export interface SessionHoursRow {
  min: string
  max: string
}

export interface LockedSession {
  sessionNumber: number
  estimatedHoursMin: number
  estimatedHoursMax: number
  // Shown alongside the row so staff understands why it can't be edited --
  // "deposit paid" or "appointment booked" (a session can have either or
  // both; this is whichever applies).
  reason: string
}

interface SessionCountFieldProps {
  sessionCount: number
  onSessionCountChange: (count: number) => void
  // Only passed by the Revise Estimate flow -- the original pre-conversion
  // flow never has a paid deposit or booked appointment yet, so it's always
  // empty there. Staff can't drop the count below whatever's already locked
  // in: shrinking the array can't silently orphan a paid deposit or booked
  // appointment's own row.
  lockedSessions?: LockedSession[]
}

export function SessionCountField({ sessionCount, onSessionCountChange, lockedSessions = [] }: SessionCountFieldProps) {
  const highestLockedSessionNumber = lockedSessions.reduce((max, s) => Math.max(max, s.sessionNumber), 0)
  const countOptions = SESSION_COUNT_OPTIONS.filter((count) => count >= Math.max(1, highestLockedSessionNumber))

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-fg-secondary">Number of sessions</label>
      <select
        value={sessionCount}
        onChange={(e) => onSessionCountChange(Number(e.target.value))}
        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {countOptions.map((count) => (
          <option key={count} value={count}>
            {count}
          </option>
        ))}
      </select>
    </div>
  )
}

interface SessionHoursRowsProps {
  sessionCount: number
  sessionHours: SessionHoursRow[]
  onSessionHoursChange: (rows: SessionHoursRow[]) => void
  lockedSessions?: LockedSession[]
}

export default function SessionHoursRows({
  sessionCount,
  sessionHours,
  onSessionHoursChange,
  lockedSessions = [],
}: SessionHoursRowsProps) {
  if (sessionCount <= 1) return null

  const lockedBySessionNumber = new Map(lockedSessions.map((s) => [s.sessionNumber, s]))

  return (
    <div className="mt-3 space-y-2">
      {sessionHours.slice(0, sessionCount).map((row, index) => {
        const sessionNumber = index + 1
        const locked = lockedBySessionNumber.get(sessionNumber)

        if (locked) {
          return (
            <div
              key={index}
              className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-inset p-2 sm:grid-cols-3"
            >
              <p className="col-span-2 self-center text-xs font-medium text-fg-secondary sm:col-span-1">
                Session {sessionNumber}
              </p>
              <p className="col-span-2 self-center text-xs text-fg-muted sm:col-span-2">
                {locked.estimatedHoursMin}-{locked.estimatedHoursMax} hrs — locked ({locked.reason})
              </p>
            </div>
          )
        }

        return (
          <div key={index} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <p className="col-span-2 self-center text-xs font-medium text-fg-secondary sm:col-span-1">
              Session {sessionNumber}
            </p>
            <select
              value={row.min}
              onChange={(e) => {
                const next = [...sessionHours]
                next[index] = { ...next[index], min: e.target.value }
                onSessionHoursChange(next)
              }}
              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Min hours…</option>
              {HOUR_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} {hours === 1 ? 'hour' : 'hours'}
                </option>
              ))}
            </select>
            <select
              value={row.max}
              onChange={(e) => {
                const next = [...sessionHours]
                next[index] = { ...next[index], max: e.target.value }
                onSessionHoursChange(next)
              }}
              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Max hours…</option>
              {HOUR_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} {hours === 1 ? 'hour' : 'hours'}
                </option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}

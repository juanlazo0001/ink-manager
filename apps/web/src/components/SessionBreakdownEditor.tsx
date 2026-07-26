// Shared by the original "Generate & Send Estimate" flow (InquiryDetail.tsx,
// pre-conversion) and the "Revise Estimate" flow (same file, post-conversion)
// -- one input for declaring/editing a multi-session plan's per-session hour
// and price ranges, so the two flows can never drift out of sync with each
// other.
//
// Split into two pieces (not one component) because the two flows embed the
// "Number of sessions" select inside a price/time grid, then render the
// per-session hour/price rows as a separate full-width block below that grid
// -- splitting lets each flow keep that exact layout.
export const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1)
export const SESSION_COUNT_OPTIONS = Array.from({ length: 6 }, (_, i) => i + 1)

export interface SessionHoursRow {
  min: string
  max: string
  priceLow: string
  priceHigh: string
}

export interface LockedSession {
  sessionNumber: number
  estimatedHoursMin: number
  estimatedHoursMax: number
  estimatedPriceLow: number | null
  estimatedPriceHigh: number | null
  // Shown alongside the row so staff understands why it can't be edited --
  // "deposit paid" or "appointment booked" (a session can have either or
  // both; this is whichever applies).
  reason: string
}

export interface ArtistRate {
  hourlyRateCents: number | null
  flatRateCents: number | null
}

// Pre-fills a starting number staff can freely override -- never forced or
// validated against. Hourly rate takes priority (it scales with the
// session's own hour estimate); flat rate is used verbatim only when no
// hourly rate is set.
export function suggestSessionPrice(
  artist: ArtistRate | null | undefined,
  hoursMin: number,
  hoursMax: number,
): { low: string; high: string } | null {
  if (!artist) return null
  if (artist.hourlyRateCents != null) {
    const rate = artist.hourlyRateCents / 100
    return { low: (rate * hoursMin).toFixed(2), high: (rate * hoursMax).toFixed(2) }
  }
  if (artist.flatRateCents != null) {
    const flat = (artist.flatRateCents / 100).toFixed(2)
    return { low: flat, high: flat }
  }
  return null
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
  // The estimate's assigned artist, if any -- used only to suggest a
  // starting per-session price when hours are entered and no price has
  // been typed yet.
  assignedArtist?: ArtistRate | null
  // Same per-estimate flat/range choice as the top-level price field --
  // flat collapses each session's price to one input (which sets both
  // priceLow and priceHigh to that same value), same relationship the
  // top-level flat toggle already has with priceEstimateLow/High.
  isFlat?: boolean
}

export default function SessionHoursRows({
  sessionCount,
  sessionHours,
  onSessionHoursChange,
  lockedSessions = [],
  assignedArtist = null,
  isFlat = false,
}: SessionHoursRowsProps) {
  if (sessionCount <= 1) return null

  const lockedBySessionNumber = new Map(lockedSessions.map((s) => [s.sessionNumber, s]))

  function updateRow(index: number, patch: Partial<SessionHoursRow>) {
    const next = [...sessionHours]
    const row = { ...next[index], ...patch }

    // Only auto-suggest into fields the user hasn't touched yet -- a
    // pre-fill, never an override of something staff already typed.
    if (assignedArtist && !row.priceLow && !row.priceHigh && row.min && row.max) {
      const suggestion = suggestSessionPrice(assignedArtist, Number(row.min), Number(row.max))
      if (suggestion) {
        row.priceLow = suggestion.low
        row.priceHigh = suggestion.high
      }
    }

    next[index] = row
    onSessionHoursChange(next)
  }

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
                {locked.estimatedHoursMin}-{locked.estimatedHoursMax} hrs
                {locked.estimatedPriceLow != null && locked.estimatedPriceHigh != null && (
                  <>
                    {' '}
                    ·{' '}
                    {locked.estimatedPriceLow === locked.estimatedPriceHigh
                      ? `$${locked.estimatedPriceLow}`
                      : `$${locked.estimatedPriceLow}-$${locked.estimatedPriceHigh}`}
                  </>
                )}
                {' '}— locked ({locked.reason})
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
              onChange={(e) => updateRow(index, { min: e.target.value })}
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
              onChange={(e) => updateRow(index, { max: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Max hours…</option>
              {HOUR_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} {hours === 1 ? 'hour' : 'hours'}
                </option>
              ))}
            </select>
            {isFlat ? (
              <div className="col-span-2 sm:col-span-1 sm:col-start-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.priceLow}
                    onChange={(e) => updateRow(index, { priceLow: e.target.value, priceHigh: e.target.value })}
                    placeholder="Price"
                    className="w-full rounded-lg border border-border bg-surface-inset py-2 pl-7 pr-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="col-span-2 sm:col-span-1 sm:col-start-2">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.priceLow}
                      onChange={(e) => updateRow(index, { priceLow: e.target.value })}
                      placeholder="Price low"
                      className="w-full rounded-lg border border-border bg-surface-inset py-2 pl-7 pr-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.priceHigh}
                      onChange={(e) => updateRow(index, { priceHigh: e.target.value })}
                      placeholder="Price high"
                      className="w-full rounded-lg border border-border bg-surface-inset py-2 pl-7 pr-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

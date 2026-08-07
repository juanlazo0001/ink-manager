import CurrencyInput from './CurrencyInput'
import { formatPriceEstimate } from '../lib/format'
import SessionHoursRows, {
  SessionCountField,
  HOUR_OPTIONS,
  suggestSessionPrice,
  type ArtistRate,
  type LockedSession,
  type SessionHoursRow,
} from './SessionBreakdownEditor'

// Estimate parity: the ONE place a price/time estimate's fields are
// declared, shared by every context that enters one -- staff's own
// Generate & Send Estimate (InquiryDetail.tsx, pre-conversion), staff's
// own Revise Estimate (same file, post-conversion, passes lockedSessions),
// and an artist's own Approve flow (MyInquiries.tsx). Previously the
// artist form was a separate, hand-rolled 4-field copy that had drifted
// from staff's real builder (no flat-rate/hide-duration toggle, no
// session count, no multi-session planning, no rate auto-suggestion) --
// extracted here so all three render the exact same component and can
// never drift apart again. Staff's two contexts already shared
// SessionBreakdownEditor.tsx's per-session pieces; this wraps that
// together with the single-session top-level fields those two contexts
// used to each duplicate by hand.

export interface EstimateDraft {
  isFlat: boolean
  showDurationToClient: boolean
  sessionCount: number
  hoursMin: string
  hoursMax: string
  priceLow: string
  priceHigh: string
  sessionRows: SessionHoursRow[]
}

const EMPTY_SESSION_ROW: SessionHoursRow = {
  min: '',
  max: '',
  priceLow: '',
  priceHigh: '',
  isFlat: false,
  showDurationToClient: true,
}

// A brand-new, never-yet-entered estimate -- defaultFlat mirrors the
// Service's own pricingModel (a starting point staff/artist can freely
// override), same convention the old per-context seed effects used.
export function emptyEstimateDraft(defaultFlat: boolean): EstimateDraft {
  return {
    isFlat: defaultFlat,
    showDurationToClient: true,
    sessionCount: 1,
    hoursMin: '',
    hoursMax: '',
    priceLow: '',
    priceHigh: '',
    sessionRows: [{ ...EMPTY_SESSION_ROW }],
  }
}

export interface EstimateDraftSourceInquiry {
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
  estimateSentAt?: string | null
  service: { pricingModel: 'RANGE' | 'FLAT' }
  plannedSessions: {
    sessionNumber: number
    estimatedHoursMin: number
    estimatedHoursMax: number
    estimatedPriceLow: number | null
    estimatedPriceHigh: number | null
    showDurationToClient: boolean
  }[]
}

// Seeds a draft from an inquiry's current data -- either a never-sent
// estimate's raw top-level fields, or (for staff re-opening Edit, or the
// Revise Estimate modal) the project's existing session plan when one
// exists. Same inference every prior seed used: a flat price/session is
// one whose stored low === high, since neither is a separately persisted
// column.
export function estimateDraftFromInquiry(inquiry: EstimateDraftSourceInquiry): EstimateDraft {
  const isFlat = inquiry.estimateSentAt
    ? inquiry.priceEstimateLow != null && inquiry.priceEstimateLow === inquiry.priceEstimateHigh
    : inquiry.service.pricingModel === 'FLAT'
  const showDurationToClient =
    inquiry.plannedSessions.length === 1 ? inquiry.plannedSessions[0].showDurationToClient : true

  if (inquiry.plannedSessions.length > 0) {
    return {
      isFlat,
      showDurationToClient,
      sessionCount: inquiry.plannedSessions.length,
      hoursMin: '',
      hoursMax: '',
      priceLow: '',
      priceHigh: '',
      sessionRows: inquiry.plannedSessions.map((ps) => ({
        min: ps.estimatedHoursMin.toString(),
        max: ps.estimatedHoursMax.toString(),
        priceLow: ps.estimatedPriceLow != null ? ps.estimatedPriceLow.toString() : '',
        priceHigh: ps.estimatedPriceHigh != null ? ps.estimatedPriceHigh.toString() : '',
        isFlat: ps.estimatedPriceLow != null && ps.estimatedPriceLow === ps.estimatedPriceHigh,
        showDurationToClient: ps.showDurationToClient,
      })),
    }
  }

  return {
    isFlat,
    showDurationToClient,
    sessionCount: 1,
    hoursMin: inquiry.timeEstimateHoursMin?.toString() ?? '',
    hoursMax: inquiry.timeEstimateHoursMax?.toString() ?? '',
    priceLow: inquiry.priceEstimateLow?.toString() ?? '',
    priceHigh: inquiry.priceEstimateHigh?.toString() ?? '',
    sessionRows: [{ ...EMPTY_SESSION_ROW }],
  }
}

// The whole-project price/time, mirroring the backend's own identical
// branch in POST /:id/send-estimate: sessionCount 1 (no plan) uses the
// single top-level fields (falling back to whatever's already saved, e.g.
// while only touching one field of an already-sent estimate); above 1,
// price is the sum of every session's own price and there's no single
// top-level time range at all.
export function computeEffectiveEstimate(
  draft: EstimateDraft,
  fallback: { priceEstimateLow: number | null; priceEstimateHigh: number | null; timeEstimateHoursMin: number | null; timeEstimateHoursMax: number | null },
): { priceEstimateLow: number | null | undefined; priceEstimateHigh: number | null | undefined; timeEstimateHoursMin?: number | null; timeEstimateHoursMax?: number | null } {
  const isMultiSession = draft.sessionCount > 1
  if (isMultiSession) {
    const sum = draft.sessionRows.slice(0, draft.sessionCount).reduce(
      (acc, row) => ({
        low: acc.low + (row?.priceLow ? Number(row.priceLow) : 0),
        high: acc.high + (row?.priceHigh ? Number(row.priceHigh) : 0),
      }),
      { low: 0, high: 0 },
    )
    return { priceEstimateLow: sum.low, priceEstimateHigh: sum.high }
  }
  return {
    priceEstimateLow: draft.priceLow ? Number(draft.priceLow) : fallback.priceEstimateLow,
    priceEstimateHigh: draft.priceHigh ? Number(draft.priceHigh) : fallback.priceEstimateHigh,
    timeEstimateHoursMin: draft.hoursMin ? Number(draft.hoursMin) : fallback.timeEstimateHoursMin,
    timeEstimateHoursMax: draft.hoursMax ? Number(draft.hoursMax) : fallback.timeEstimateHoursMax,
  }
}

// The top-level priceEstimate*/timeEstimate* fields as the API request
// body itself expects them: undefined (not a fallback value) whenever the
// field is blank or a session plan makes it inapplicable -- POST
// /:id/send-estimate and /:id/respond both already leave an omitted field
// untouched server-side, only ever overwriting one the caller actually sent.
export function estimateDraftToRequestFields(draft: EstimateDraft): {
  priceEstimateLow: number | undefined
  priceEstimateHigh: number | undefined
  timeEstimateHoursMin: number | undefined
  timeEstimateHoursMax: number | undefined
} {
  const isMultiSession = draft.sessionCount > 1
  return {
    priceEstimateLow: isMultiSession ? undefined : draft.priceLow ? Number(draft.priceLow) : undefined,
    priceEstimateHigh: isMultiSession ? undefined : draft.priceHigh ? Number(draft.priceHigh) : undefined,
    timeEstimateHoursMin: isMultiSession ? undefined : draft.hoursMin ? Number(draft.hoursMin) : undefined,
    timeEstimateHoursMax: isMultiSession ? undefined : draft.hoursMax ? Number(draft.hoursMax) : undefined,
  }
}

// Same validation the backend itself re-checks -- instant client-side
// feedback instead of a round trip for something obviously incomplete.
// lockedSessions are skipped (staff/artist can't edit them, so they can't
// be blamed for being incomplete).
export function validateEstimateDraft(
  draft: EstimateDraft,
  fallback: { priceEstimateLow: number | null; priceEstimateHigh: number | null; timeEstimateHoursMin: number | null; timeEstimateHoursMax: number | null },
  lockedSessions: LockedSession[] = [],
): string | null {
  const isMultiSession = draft.sessionCount > 1
  if (isMultiSession) {
    const lockedNumbers = new Set(lockedSessions.map((s) => s.sessionNumber))
    for (let i = 0; i < draft.sessionCount; i++) {
      const sessionNumber = i + 1
      if (lockedNumbers.has(sessionNumber)) continue
      const row = draft.sessionRows[i]
      if (!row || !row.min || !row.max) return `Session ${sessionNumber} needs an hour range.`
      if (Number(row.min) <= 0 || Number(row.max) <= 0) return 'All session hour ranges must be positive.'
      if (Number(row.min) > Number(row.max)) {
        return `Session ${sessionNumber}'s minimum hours must be less than or equal to its maximum.`
      }
      if (!row.priceLow || !row.priceHigh) return `Session ${sessionNumber} needs a price range.`
      if (Number(row.priceLow) <= 0 || Number(row.priceHigh) <= 0) return 'All session price ranges must be positive.'
      if (Number(row.priceLow) > Number(row.priceHigh)) {
        return `Session ${sessionNumber}'s minimum price must be less than or equal to its maximum.`
      }
    }
    return null
  }
  const effective = computeEffectiveEstimate(draft, fallback)
  const values = Object.values(effective)
  if (values.some((v) => v == null)) return 'Price and time ranges are required before sending an estimate.'
  if (values.some((v) => v! <= 0)) return 'All range values must be positive.'
  if (effective.priceEstimateLow! > effective.priceEstimateHigh!) {
    return 'Price low must be less than or equal to price high.'
  }
  if (effective.timeEstimateHoursMin! > effective.timeEstimateHoursMax!) {
    return 'Minimum hours must be less than or equal to maximum hours.'
  }
  return null
}

export interface SessionPayloadRow {
  estimatedHoursMin: number
  estimatedHoursMax: number
  estimatedPriceLow: number
  estimatedPriceHigh: number
  showDurationToClient?: boolean
}

// The `sessions` array shape POST /:id/send-estimate (and /:id/respond,
// once it accepts the same shape) reconciles onto PlannedSession rows.
// hadExistingPlan: whether this inquiry already had a session plan before
// this submission -- collapsing sessionCount back to 1 needs to actually
// say so (`[]`) rather than omitting `sessions` entirely, which would
// leave an already-declared plan's rows untouched in the database; an
// ordinary single-session draft that never had one shouldn't send an
// empty array for no reason. lockedSessions (Revise Estimate only): a
// locked session number's own already-stored values are submitted
// verbatim regardless of what's in that row's (non-editable, display-only)
// draft fields -- the backend reconciliation ignores whatever's submitted
// for a locked number anyway, but this keeps the request honest.
export function estimateDraftToSessionsPayload(
  draft: EstimateDraft,
  hadExistingPlan: boolean,
  lockedSessions: LockedSession[] = [],
): SessionPayloadRow[] | undefined {
  const isMultiSession = draft.sessionCount > 1
  if (isMultiSession) {
    return draft.sessionRows.slice(0, draft.sessionCount).map((row, index) => {
      const sessionNumber = index + 1
      const locked = lockedSessions.find((s) => s.sessionNumber === sessionNumber)
      if (locked) {
        return {
          estimatedHoursMin: locked.estimatedHoursMin,
          estimatedHoursMax: locked.estimatedHoursMax,
          estimatedPriceLow: locked.estimatedPriceLow ?? 0,
          estimatedPriceHigh: locked.estimatedPriceHigh ?? 0,
        }
      }
      return {
        estimatedHoursMin: Number(row.min),
        estimatedHoursMax: Number(row.max),
        estimatedPriceLow: Number(row.priceLow),
        estimatedPriceHigh: Number(row.priceHigh),
        showDurationToClient: row.showDurationToClient,
      }
    })
  }
  if (draft.isFlat) {
    // A flat-rate single-session estimate still needs a real (1-row)
    // session so showDurationToClient has somewhere to persist -- the API
    // reconciles any array length, including 1, onto a matching
    // PlannedSession row without touching the top-level price/hours
    // fields sent alongside it.
    return [
      {
        estimatedHoursMin: Number(draft.hoursMin),
        estimatedHoursMax: Number(draft.hoursMax),
        estimatedPriceLow: Number(draft.priceLow),
        estimatedPriceHigh: Number(draft.priceHigh),
        showDurationToClient: draft.showDurationToClient,
      },
    ]
  }
  return hadExistingPlan ? [] : undefined
}

interface EstimateFieldsEditorProps {
  value: EstimateDraft
  onChange: (value: EstimateDraft) => void
  assignedArtist: ArtistRate | null
  lockedSessions?: LockedSession[]
  disabled?: boolean
}

export default function EstimateFieldsEditor({
  value,
  onChange,
  assignedArtist,
  lockedSessions = [],
  disabled = false,
}: EstimateFieldsEditorProps) {
  const isMultiSession = value.sessionCount > 1

  const sessionPriceSum = value.sessionRows.slice(0, value.sessionCount).reduce(
    (sum, row) => ({
      low: sum.low + (row?.priceLow ? Number(row.priceLow) : 0),
      high: sum.high + (row?.priceHigh ? Number(row.priceHigh) : 0),
    }),
    { low: 0, high: 0 },
  )

  // Same "only pre-fill, never override" rate-auto-suggestion every
  // per-session row already gets via SessionHoursRows' own updateRow --
  // this is that same suggestion for the single-session (no plan) fields,
  // which SessionHoursRows itself is a no-op for (sessionCount <= 1).
  function updateTimeField(field: 'hoursMin' | 'hoursMax', fieldValue: string) {
    const next = { ...value, [field]: fieldValue }
    if (assignedArtist && !next.priceLow && !next.priceHigh && next.hoursMin && next.hoursMax) {
      const suggestion = suggestSessionPrice(assignedArtist, Number(next.hoursMin), Number(next.hoursMax), next.isFlat)
      if (suggestion) {
        next.priceLow = suggestion.low
        next.priceHigh = suggestion.high
      }
    }
    onChange(next)
  }

  // Resizes sessionRows to match, preserving already-entered rows --
  // dropping the count back down never loses data for the rows still in
  // range, just hides the ones beyond it.
  function handleSessionCountChange(count: number) {
    const nextRows = [...value.sessionRows]
    while (nextRows.length < count) nextRows.push({ ...EMPTY_SESSION_ROW })
    nextRows.length = count
    onChange({ ...value, sessionCount: count, sessionRows: nextRows })
  }

  return (
    <>
      {/* Once a session plan exists, flat/range is a per-session choice
          (see SessionHoursRows below) rather than one global toggle --
          this checkbox only still applies to the single top-level price
          field used when there's no plan. */}
      {!isMultiSession && (
        <>
          <label className="mt-4 flex items-center gap-2 text-xs font-medium text-fg-secondary">
            <input
              type="checkbox"
              checked={value.isFlat}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, isFlat: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
            />
            Flat rate (single price instead of a range)
          </label>
          {value.isFlat && (
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={value.showDurationToClient}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, showDurationToClient: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
              />
              Show this session's hour range to the client (staff always sees it either way)
            </label>
          )}
        </>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Sessions, then Time, then Price -- Price comes last for a
            single-session estimate since entering Time is what suggests
            it; the multi-session sum stays at the top regardless -- it's
            a read-only rollup of the per-session rows below. */}
        {isMultiSession && (
          <div className="sm:col-span-2">
            <p className="mb-1 block text-xs font-medium text-fg-secondary">Price estimate (sum of every session below)</p>
            <p className="text-sm text-fg">{formatPriceEstimate(sessionPriceSum.low, sessionPriceSum.high) ?? 'Not provided'}</p>
          </div>
        )}
        <SessionCountField sessionCount={value.sessionCount} onSessionCountChange={handleSessionCountChange} lockedSessions={lockedSessions} />
        {!isMultiSession && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">Time min (hours)</label>
              <select
                value={value.hoursMin}
                disabled={disabled}
                onChange={(e) => updateTimeField('hoursMin', e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Select…</option>
                {HOUR_OPTIONS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} {hours === 1 ? 'hour' : 'hours'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">Time max (hours)</label>
              <select
                value={value.hoursMax}
                disabled={disabled}
                onChange={(e) => updateTimeField('hoursMax', e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Select…</option>
                {HOUR_OPTIONS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} {hours === 1 ? 'hour' : 'hours'}
                  </option>
                ))}
              </select>
            </div>
            {value.isFlat ? (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-fg-secondary">Price</label>
                <CurrencyInput
                  value={value.priceLow}
                  disabled={disabled}
                  onChange={(digits) => onChange({ ...value, priceLow: digits, priceHigh: digits })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-secondary">Price low</label>
                  <CurrencyInput
                    value={value.priceLow}
                    disabled={disabled}
                    onChange={(digits) => onChange({ ...value, priceLow: digits })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-secondary">Price high</label>
                  <CurrencyInput
                    value={value.priceHigh}
                    disabled={disabled}
                    onChange={(digits) => onChange({ ...value, priceHigh: digits })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>

      <SessionHoursRows
        sessionCount={value.sessionCount}
        sessionHours={value.sessionRows}
        onSessionHoursChange={(rows) => onChange({ ...value, sessionRows: rows })}
        lockedSessions={lockedSessions}
        assignedArtist={assignedArtist}
      />
    </>
  )
}

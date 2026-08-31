import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'
import { formatStatus } from '../lib/format'
import { PERMISSION_GROUPS, DISPLAYED_ROLES } from '../lib/permissions'
import { ChevronDownIcon } from './icons'
import { useThemePreset } from '../lib/useThemePreset'

type PermissionMatrix = Record<string, Record<string, boolean>>
interface PermissionsResponse {
  matrix: PermissionMatrix
}

/**
 * The role permission matrix, moved out of the Team page's third tab and
 * into Settings at the owner's direction.
 *
 * `lib/permissions.ts`'s own header already described these groups as what
 * "the Settings -> Permissions tab now renders" — it had been wrong about
 * the location since the groups were introduced. It is right now.
 *
 * Extracted as a component rather than pasted, because the block carried
 * four pieces of state, a load effect and two handlers, and Settings.tsx
 * is already 4000+ lines. Self-contained: it owns its own fetch and save,
 * so neither page has to hold permission state it doesn't render.
 *
 * OWNER-only, and that is not decoration — `GET`/`PATCH`
 * `/studios/:id/permissions` are both `requireRole(Role.OWNER)`, so for
 * any other role this can only render an error. The caller does the
 * gating.
 */
export default function PermissionsSection({ studioId }: { studioId: string }) {
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'

  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Collapsed by default -- 11 groups covering ~49 keys is a lot to show
  // expanded all at once (Section 3's own "grouped, not a flat wall" goal).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let ignore = false
    setError(null)

    apiFetch<PermissionsResponse>(`/studios/${studioId}/permissions`)
      .then((data) => {
        if (!ignore) setMatrix(data.matrix)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load permissions')
      })

    return () => {
      ignore = true
    }
  }, [studioId])

  function togglePermission(role: string, key: string) {
    setSuccess(false)
    setMatrix((current) => {
      if (!current) return current
      return { ...current, [role]: { ...current[role], [key]: !current[role][key] } }
    })
  }

  async function handleSave() {
    if (!matrix) return

    setError(null)
    setSubmitting(true)

    // Only the two roles this UI actually shows/edits -- CUSTOMER stays
    // untouched by this save (still configurable via the API directly if
    // ever needed, just not through this grouped UI).
    const updates = DISPLAYED_ROLES.flatMap((role) =>
      PERMISSION_GROUPS.flatMap((group) =>
        group.keys.map(({ key }) => ({ role, permissionKey: key, allowed: matrix[role]?.[key] ?? false })),
      ),
    )

    try {
      const data = await apiFetch<PermissionsResponse>(`/studios/${studioId}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ updates }),
      })
      setMatrix(data.matrix)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // No .card-surface here, deliberately -- the permissions matrix is
    // dense, information-critical content (a checkbox grid), not a
    // glass-treatment candidate.
    <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Permissions</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Choose what each role can do in your studio&apos;s portal.
          </p>
        </div>

        {matrix && (
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            className={
              isEditorial
                ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
            }
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>

      {/* OWNER is never a toggleable column -- it short-circuits every
          permission check regardless of matrix state, so showing it as
          an editable checkbox would be misleading. */}
      <p className="mt-3 rounded-lg bg-surface-inset px-3 py-2 text-xs text-fg-secondary">
        Owner always has full access, in every category below.
      </p>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {success && <p className="mt-4 text-sm text-success">Permissions updated.</p>}

      {!error && !matrix && <p className="mt-4 text-sm text-fg-secondary">Loading permissions…</p>}

      {matrix && (
        <div className="mt-4 space-y-2">
          {PERMISSION_GROUPS.map((group) => {
            const isExpanded = expanded.has(group.label)
            const enabledCount = group.keys.filter((k) =>
              DISPLAYED_ROLES.some((role) => matrix[role]?.[k.key]),
            ).length

            return (
              <div key={group.label} className="rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(group.label)) next.delete(group.label)
                      else next.add(group.label)
                      return next
                    })
                  }
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-2">
                    <ChevronDownIcon className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    <span className="text-sm font-semibold text-fg">{group.label}</span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {enabledCount}/{group.keys.length} enabled
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-border">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 px-4 pb-2 pt-3 text-xs font-medium text-fg-muted">
                      <span />
                      {DISPLAYED_ROLES.map((role) => (
                        <span key={role} className="text-center">
                          {formatStatus(role)}
                        </span>
                      ))}
                    </div>
                    <div className="divide-y divide-border">
                      {group.keys.map(({ key, label, description }) => (
                        <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-fg">{label}</p>
                            <p className="mt-0.5 text-xs text-fg-secondary">{description}</p>
                          </div>
                          {DISPLAYED_ROLES.map((role) => (
                            <div key={role} className="flex justify-center">
                              <input
                                type="checkbox"
                                aria-label={`${label} — ${formatStatus(role)}`}
                                checked={matrix[role]?.[key] ?? false}
                                onChange={() => togglePermission(role, key)}
                                className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                              />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

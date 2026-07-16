import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatDateTime } from '../lib/format'

interface AuditLogEntry {
  id: string
  action: string
  changes: Record<string, { from: unknown; to: unknown }> | Record<string, unknown> | null
  createdAt: string
  actorUser: { id: string; name: string | null; email: string } | null
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isFromToShape(value: unknown): value is { from: unknown; to: unknown } {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value
}

export default function AuditTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    apiFetch<AuditLogEntry[]>(`/audit?entityType=${entityType}&entityId=${entityId}`)
      .then((data) => {
        if (!ignore) setLogs(data)
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load activity history')
      })

    return () => {
      ignore = true
    }
  }, [entityType, entityId])

  return (
    <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-base font-semibold text-white">Activity History</h2>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {!error && logs === null && <p className="mt-4 text-sm text-neutral-400">Loading…</p>}

      {!error && logs !== null && logs.length === 0 && (
        <p className="mt-4 text-sm text-neutral-400">No activity recorded yet.</p>
      )}

      {!error && logs !== null && logs.length > 0 && (
        <ul className="mt-4 space-y-3">
          {logs.map((log) => (
            <li key={log.id} className="rounded-lg border border-neutral-800 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-white">
                  <span className="font-medium">{log.actorUser?.name || log.actorUser?.email || 'System'}</span>{' '}
                  <span className="text-neutral-400">{log.action}</span>
                </span>
                <span className="text-xs text-neutral-500">{formatDateTime(log.createdAt)}</span>
              </div>

              {log.changes && Object.keys(log.changes).length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-neutral-400">
                  {Object.entries(log.changes).map(([field, value]) => (
                    <li key={field}>
                      <span className="font-medium text-neutral-300">{field}:</span>{' '}
                      {isFromToShape(value) ? (
                        <>
                          {formatValue(value.from)} <span className="text-neutral-600">→</span> {formatValue(value.to)}
                        </>
                      ) : (
                        formatValue(value)
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

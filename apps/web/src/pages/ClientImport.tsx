import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { apiFetch, ApiError } from '../lib/api'
import { useEffectiveUser } from '../context/useEffectiveUser'

interface MatchedClient {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

interface ImportRow {
  id: string
  rawData: Record<string, string>
  matchedClientId: string | null
  matchedClient: MatchedClient | null
  decision: 'ADD' | 'MERGE' | 'SKIP' | null
  processedAt: string | null
  isMalformed: boolean
}

interface ImportBatch {
  id: string
  status: 'PENDING_REVIEW' | 'COMPLETED' | 'CANCELLED'
  createdAt: string
  rows: ImportRow[]
}

interface ExecuteResult {
  status: string
  results: { rowId: string; decision: string; success: boolean; error?: string; clientId?: string }[]
}

// The recognized columns, in a stable display order -- rawData may
// contain other columns too (preserved, shown in an "Other data" column)
// but these are the ones the review table gives their own headers.
const KNOWN_COLUMNS: { key: string; label: string }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
]

export default function ClientImport() {
  const user = useEffectiveUser()
  const isOwner = user?.role === 'OWNER'

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [batch, setBatch] = useState<ImportBatch | null>(null)

  const [savingRowId, setSavingRowId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const [cancelling, setCancelling] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [executeError, setExecuteError] = useState<string | null>(null)
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null)

  async function handleFileSelected(file: File) {
    setUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const created = await apiFetch<ImportBatch>('/clients/import', { method: 'POST', body: formData })
      setBatch(created)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDecisionChange(rowId: string, decision: 'ADD' | 'MERGE' | 'SKIP') {
    if (!batch) return
    setSavingRowId(rowId)
    setRowError(null)

    try {
      const updated = await apiFetch<ImportRow>(`/clients/import/${batch.id}/rows/${rowId}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      })
      setBatch({ ...batch, rows: batch.rows.map((r) => (r.id === rowId ? { ...r, ...updated } : r)) })
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to set decision')
    } finally {
      setSavingRowId(null)
    }
  }

  async function handleCancel() {
    if (!batch) return
    setCancelling(true)
    try {
      const updated = await apiFetch<ImportBatch>(`/clients/import/${batch.id}/cancel`, { method: 'POST' })
      setBatch({ ...batch, status: updated.status })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to cancel')
    } finally {
      setCancelling(false)
    }
  }

  async function handleExecute() {
    if (!batch) return
    setExecuting(true)
    setExecuteError(null)

    try {
      const result = await apiFetch<ExecuteResult>(`/clients/import/${batch.id}/execute`, { method: 'POST' })
      setExecuteResult(result)
      setBatch({ ...batch, status: 'COMPLETED' as const })
    } catch (err) {
      setExecuteError(err instanceof ApiError ? err.message : 'Failed to execute import')
    } finally {
      setExecuting(false)
    }
  }

  const allDecided = batch ? batch.rows.every((r) => r.decision !== null) : false
  const reviewable = batch && batch.status === 'PENDING_REVIEW'

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <Link to="/clients" className="text-sm text-fg-secondary hover:text-fg">
            ← Back to Clients
          </Link>

          <h1 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">Import Clients</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Upload a CSV, review every row's detected match, decide what happens to each one, then confirm.
          </p>

          {!batch && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
              <label className="block text-sm font-medium text-fg-secondary">CSV file</label>
              <p className="mt-1 text-xs text-fg-muted">
                Recognized columns: First name, Last name, Email, Phone, Instagram, Facebook, Other contact. Any
                other columns are kept but not used.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelected(file)
                }}
                disabled={uploading}
                className="mt-3 block w-full text-sm text-fg-secondary file:mr-3 file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-raised disabled:opacity-60"
              />
              {uploading && <p className="mt-3 text-sm text-fg-secondary">Uploading and checking for matches…</p>}
              {uploadError && (
                <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {uploadError}
                </div>
              )}
            </div>
          )}

          {batch && (
            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
                <div>
                  <p className="text-sm font-semibold text-fg">
                    {batch.rows.length} row{batch.rows.length === 1 ? '' : 's'} · status: {batch.status}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    {batch.rows.filter((r) => r.matchedClientId).length} possible match
                    {batch.rows.filter((r) => r.matchedClientId).length === 1 ? '' : 'es'} ·{' '}
                    {batch.rows.filter((r) => r.isMalformed).length} flagged row
                    {batch.rows.filter((r) => r.isMalformed).length === 1 ? '' : 's'}
                  </p>
                </div>

                {reviewable && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={cancelling}
                      className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
                    >
                      {cancelling ? 'Cancelling…' : 'Cancel Import'}
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={handleExecute}
                        disabled={!allDecided || executing}
                        title={!allDecided ? 'Every row needs a decision first' : undefined}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {executing ? 'Importing…' : 'Confirm Import'}
                      </button>
                    )}
                    {!isOwner && (
                      <span className="text-xs text-fg-muted">Only an OWNER can confirm this import.</span>
                    )}
                  </div>
                )}
              </div>

              {rowError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {rowError}
                </div>
              )}
              {executeError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {executeError}
                </div>
              )}

              {executeResult && (
                <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                  Import complete: {executeResult.results.filter((r) => r.decision === 'ADD' && r.success).length}{' '}
                  added, {executeResult.results.filter((r) => r.decision === 'MERGE' && r.success).length} merged,{' '}
                  {executeResult.results.filter((r) => r.decision === 'SKIP' && r.success).length} skipped
                  {executeResult.results.some((r) => !r.success) && (
                    <>, {executeResult.results.filter((r) => !r.success).length} failed</>
                  )}
                  .
                </div>
              )}

              <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-muted">
                      {KNOWN_COLUMNS.map((col) => (
                        <th key={col.key} className="px-4 py-3 font-medium">
                          {col.label}
                        </th>
                      ))}
                      <th className="px-4 py-3 font-medium">Match</th>
                      <th className="px-4 py-3 font-medium">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {batch.rows.map((row) => (
                      <tr key={row.id} className={row.isMalformed ? 'bg-danger/5' : undefined}>
                        {KNOWN_COLUMNS.map((col) => (
                          <td key={col.key} className="px-4 py-3 text-fg-secondary">
                            {row.rawData[col.key] || <span className="text-fg-muted">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          {row.isMalformed && (
                            <p className="text-xs font-medium text-danger">Missing first/last name</p>
                          )}
                          {row.matchedClient ? (
                            <Link
                              to={`/clients/${row.matchedClient.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              {row.matchedClient.firstName} {row.matchedClient.lastName}
                            </Link>
                          ) : (
                            !row.isMalformed && <span className="text-xs text-fg-muted">No match</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {reviewable ? (
                            <select
                              value={row.decision ?? ''}
                              onChange={(e) => handleDecisionChange(row.id, e.target.value as 'ADD' | 'MERGE' | 'SKIP')}
                              disabled={savingRowId === row.id}
                              className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                            >
                              <option value="" disabled>
                                Select…
                              </option>
                              <option value="ADD" disabled={row.isMalformed}>
                                Add as new client
                              </option>
                              <option value="MERGE" disabled={!row.matchedClientId}>
                                Merge into match
                              </option>
                              <option value="SKIP">Skip</option>
                            </select>
                          ) : (
                            <span className="text-xs text-fg-secondary">{row.decision ?? '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

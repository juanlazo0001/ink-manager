import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { apiFetch, ApiError } from '../lib/api'
import { formatCents } from '../lib/money'
import { useEffectiveUser } from '../context/useEffectiveUser'

interface MatchedClient {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

type ImportRowDecision = 'ADD' | 'MERGE' | 'SKIP'
type ImportRowDepositDecision = 'IMPORT' | 'SKIP' | 'EDIT'

interface ImportRow {
  id: string
  rawData: Record<string, string>
  matchedClientId: string | null
  matchedClient: MatchedClient | null
  parsedDepositCents: number | null
  depositFlaggedAsOutlier: boolean
  depositDecision: ImportRowDepositDecision | null
  decision: ImportRowDecision | null
  processedAt: string | null
  isMalformed: boolean
}

interface ImportBatch {
  id: string
  status: 'MAPPING' | 'PENDING_REVIEW' | 'COMPLETED' | 'CANCELLED'
  createdAt: string
  columnMapping: Record<string, string> | null
  rows: ImportRow[]
}

interface UploadResponse {
  id: string
  status: 'MAPPING'
  createdAt: string
  rowCount: number
}

interface ColumnsResponse {
  headers: string[]
  sample: Record<string, string>
  suggestedMapping: Record<string, string | null>
  savedMapping: Record<string, string> | null
  targetFields: { key: string; label: string }[]
}

interface BatchSummary {
  addCount: number
  mergeCount: number
  skipCount: number
  undecidedCount: number
  outlierUnresolvedCount: number
  giftCards: { count: number; totalCents: number }
  readyToExecute: boolean
}

interface ExecuteResult {
  status: string
  results: { rowId: string; decision: string; success: boolean; error?: string; clientId?: string; giftCardId?: string }[]
}

// The identity/tattoo-detail columns the review table gives their own
// header, in display order -- resolved per row from the batch's confirmed
// columnMapping, not a fixed rawData key (unlike the old fixed-schema
// design, a column's real key is whatever the CSV's own header text was).
const REVIEW_COLUMNS: { target: string; label: string }[] = [
  { target: 'firstName', label: 'First name' },
  { target: 'lastName', label: 'Last name' },
  { target: 'email', label: 'Email' },
  { target: 'phone', label: 'Phone' },
]

function getMappedDisplayValue(row: ImportRow, mapping: Record<string, string>, target: string): string {
  const header = Object.keys(mapping).find((h) => mapping[h] === target)
  if (!header) return ''
  return row.rawData[header] ?? ''
}

export default function ClientImport() {
  const user = useEffectiveUser()
  const isOwner = user?.role === 'OWNER'

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [batchId, setBatchId] = useState<string | null>(null)

  const [columnsData, setColumnsData] = useState<ColumnsResponse | null>(null)
  const [columnsError, setColumnsError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mappingSubmitting, setMappingSubmitting] = useState(false)
  const [mappingError, setMappingError] = useState<string | null>(null)

  const [reviewBatch, setReviewBatch] = useState<ImportBatch | null>(null)

  const [savingRowId, setSavingRowId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [editingDepositRowId, setEditingDepositRowId] = useState<string | null>(null)
  const [editingDepositValue, setEditingDepositValue] = useState('')

  const [cancelling, setCancelling] = useState(false)

  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [executeError, setExecuteError] = useState<string | null>(null)
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null)

  const stage: 'upload' | 'mapping' | 'review' = reviewBatch ? 'review' : batchId ? 'mapping' : 'upload'

  function fieldLabel(target: string): string {
    return columnsData?.targetFields.find((f) => f.key === target)?.label ?? target
  }

  async function loadColumns(id: string) {
    setColumnsError(null)
    try {
      const data = await apiFetch<ColumnsResponse>(`/clients/import/${id}/columns`)
      setColumnsData(data)
      const initialMapping: Record<string, string> = {}
      for (const header of data.headers) {
        const saved = data.savedMapping?.[header]
        const suggested = data.suggestedMapping[header]
        if (saved) initialMapping[header] = saved
        else if (suggested) initialMapping[header] = suggested
      }
      setMapping(initialMapping)
    } catch (err) {
      setColumnsError(err instanceof Error ? err.message : 'Failed to load columns')
    }
  }

  async function handleFileSelected(file: File) {
    setUploading(true)
    setUploadError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const created = await apiFetch<UploadResponse>('/clients/import', { method: 'POST', body: formData })
      setBatchId(created.id)
      await loadColumns(created.id)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleConfirmMapping() {
    if (!batchId) return

    const filtered: Record<string, string> = {}
    for (const [header, target] of Object.entries(mapping)) {
      if (target) filtered[header] = target
    }

    const claimed = new Map<string, string>()
    for (const [header, target] of Object.entries(filtered)) {
      if (target === 'note') continue
      if (claimed.has(target)) {
        setMappingError(`Only one column can be mapped to ${fieldLabel(target)}.`)
        return
      }
      claimed.set(target, header)
    }

    setMappingSubmitting(true)
    setMappingError(null)

    try {
      const batch = await apiFetch<ImportBatch>(`/clients/import/${batchId}/mapping`, {
        method: 'PATCH',
        body: JSON.stringify({ mapping: filtered }),
      })
      setReviewBatch(batch)
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : 'Failed to confirm mapping')
    } finally {
      setMappingSubmitting(false)
    }
  }

  async function patchRow(rowId: string, body: Record<string, unknown>) {
    if (!reviewBatch) return
    setSavingRowId(rowId)
    setRowError(null)

    try {
      const updated = await apiFetch<ImportRow>(`/clients/import/${reviewBatch.id}/rows/${rowId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setReviewBatch({ ...reviewBatch, rows: reviewBatch.rows.map((r) => (r.id === rowId ? { ...r, ...updated } : r)) })
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to update row')
    } finally {
      setSavingRowId(null)
    }
  }

  function handleDecisionChange(rowId: string, decision: ImportRowDecision) {
    patchRow(rowId, { decision })
  }

  function handleDepositDecisionChange(rowId: string, depositDecision: ImportRowDepositDecision) {
    if (depositDecision === 'EDIT') {
      const row = reviewBatch?.rows.find((r) => r.id === rowId)
      setEditingDepositRowId(rowId)
      setEditingDepositValue(row?.parsedDepositCents != null ? (row.parsedDepositCents / 100).toFixed(2) : '')
      return
    }
    setEditingDepositRowId(null)
    patchRow(rowId, { depositDecision })
  }

  async function handleSaveEditedDeposit(rowId: string) {
    const dollars = Number(editingDepositValue)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setRowError('Enter a valid positive dollar amount.')
      return
    }
    await patchRow(rowId, { depositDecision: 'EDIT', correctedDepositCents: Math.round(dollars * 100) })
    setEditingDepositRowId(null)
  }

  async function handleCancel() {
    if (!batchId) return
    setCancelling(true)
    try {
      await apiFetch(`/clients/import/${batchId}/cancel`, { method: 'POST' })
      const full = await apiFetch<ImportBatch>(`/clients/import/${batchId}`)
      setReviewBatch(full)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to cancel')
    } finally {
      setCancelling(false)
    }
  }

  async function openConfirmModal() {
    if (!reviewBatch) return
    setShowConfirmModal(true)
    setSummary(null)
    setSummaryError(null)
    setSummaryLoading(true)
    try {
      const data = await apiFetch<BatchSummary>(`/clients/import/${reviewBatch.id}/summary`)
      setSummary(data)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to load summary')
    } finally {
      setSummaryLoading(false)
    }
  }

  async function handleExecute() {
    if (!reviewBatch) return
    setExecuting(true)
    setExecuteError(null)

    try {
      const result = await apiFetch<ExecuteResult>(`/clients/import/${reviewBatch.id}/execute`, { method: 'POST' })
      setExecuteResult(result)
      setReviewBatch({ ...reviewBatch, status: 'COMPLETED' })
      setShowConfirmModal(false)
    } catch (err) {
      setExecuteError(err instanceof ApiError ? err.message : 'Failed to execute import')
    } finally {
      setExecuting(false)
    }
  }

  const reviewable = reviewBatch?.status === 'PENDING_REVIEW'
  const reviewMapping = reviewBatch?.columnMapping ?? {}
  const readyLocally =
    reviewBatch != null &&
    reviewBatch.rows.every((r) => r.decision !== null) &&
    reviewBatch.rows.every((r) => !r.depositFlaggedAsOutlier || r.depositDecision !== null)

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
            Upload a CSV, map its columns to Ink Manager fields, review every row, then confirm.
          </p>

          {stage === 'upload' && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
              <label className="block text-sm font-medium text-fg-secondary">CSV file</label>
              <p className="mt-1 text-xs text-fg-muted">
                Any CSV works -- you'll map its columns to Ink Manager fields on the next screen. Nothing is created
                until you review every row and confirm.
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
              {uploading && <p className="mt-3 text-sm text-fg-secondary">Uploading…</p>}
              {uploadError && (
                <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {uploadError}
                </div>
              )}
            </div>
          )}

          {stage === 'mapping' && (
            <div className="mt-6 space-y-4">
              {columnsError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {columnsError}
                </div>
              )}

              {columnsData && (
                <>
                  <div className="rounded-2xl border border-border bg-surface p-4">
                    <p className="text-sm text-fg-secondary">
                      Best-guess mapping shown below -- correct or confirm each one. Columns left "Not imported" are
                      kept in the original file but never read by Ink Manager. Map any column of leftover context
                      (last visit date, artist, etc.) to <strong>Historical Note</strong> to preserve it on the
                      resulting inquiry instead of dropping it.
                    </p>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-muted">
                          <th className="px-4 py-3 font-medium">CSV column</th>
                          <th className="px-4 py-3 font-medium">Sample value</th>
                          <th className="px-4 py-3 font-medium">Maps to</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {columnsData.headers.map((header) => (
                          <tr key={header}>
                            <td className="px-4 py-3 font-medium text-fg">{header}</td>
                            <td className="max-w-xs truncate px-4 py-3 text-fg-secondary">
                              {columnsData.sample[header] || <span className="text-fg-muted">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={mapping[header] ?? ''}
                                onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                                className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                              >
                                <option value="">Not imported</option>
                                {columnsData.targetFields.map((field) => (
                                  <option key={field.key} value={field.key}>
                                    {field.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {mappingError && (
                    <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                      {mappingError}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmMapping}
                      disabled={mappingSubmitting}
                      className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {mappingSubmitting ? 'Confirming…' : 'Confirm Mapping'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={cancelling}
                      className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
                    >
                      {cancelling ? 'Cancelling…' : 'Cancel Import'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {stage === 'review' && reviewBatch && (
            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
                <div>
                  <p className="text-sm font-semibold text-fg">
                    {reviewBatch.rows.length} row{reviewBatch.rows.length === 1 ? '' : 's'} · status: {reviewBatch.status}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    {reviewBatch.rows.filter((r) => r.matchedClientId).length} possible match
                    {reviewBatch.rows.filter((r) => r.matchedClientId).length === 1 ? '' : 'es'} ·{' '}
                    {reviewBatch.rows.filter((r) => r.isMalformed).length} flagged row
                    {reviewBatch.rows.filter((r) => r.isMalformed).length === 1 ? '' : 's'} ·{' '}
                    {reviewBatch.rows.filter((r) => r.depositFlaggedAsOutlier).length} unusual deposit
                    {reviewBatch.rows.filter((r) => r.depositFlaggedAsOutlier).length === 1 ? '' : 's'}
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
                        onClick={openConfirmModal}
                        disabled={!readyLocally}
                        title={!readyLocally ? 'Every row needs a decision (and every unusual deposit needs a resolution) first' : undefined}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        Review &amp; Confirm Import
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
                  {executeResult.results.filter((r) => r.decision === 'SKIP' && r.success).length} skipped,{' '}
                  {executeResult.results.filter((r) => r.giftCardId).length} gift card
                  {executeResult.results.filter((r) => r.giftCardId).length === 1 ? '' : 's'} issued
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
                      {REVIEW_COLUMNS.map((col) => (
                        <th key={col.target} className="px-4 py-3 font-medium">
                          {col.label}
                        </th>
                      ))}
                      <th className="px-4 py-3 font-medium">Deposit</th>
                      <th className="px-4 py-3 font-medium">Match</th>
                      <th className="px-4 py-3 font-medium">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reviewBatch.rows.map((row) => (
                      <tr key={row.id} className={row.isMalformed ? 'bg-danger/5' : undefined}>
                        {REVIEW_COLUMNS.map((col) => (
                          <td key={col.target} className="px-4 py-3 text-fg-secondary">
                            {getMappedDisplayValue(row, reviewMapping, col.target) || <span className="text-fg-muted">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          {row.parsedDepositCents != null ? (
                            <span className="text-fg-secondary">{formatCents(row.parsedDepositCents)}</span>
                          ) : (
                            <span className="text-xs text-fg-muted">—</span>
                          )}
                          {row.depositFlaggedAsOutlier && (
                            <div className="mt-1">
                              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                                Unusual amount
                              </span>
                              {reviewable && (
                                <div className="mt-1 flex items-center gap-1">
                                  <select
                                    value={row.depositDecision ?? ''}
                                    onChange={(e) =>
                                      handleDepositDecisionChange(row.id, e.target.value as ImportRowDepositDecision)
                                    }
                                    disabled={savingRowId === row.id}
                                    className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                                  >
                                    <option value="" disabled>
                                      Resolve…
                                    </option>
                                    <option value="IMPORT">Import as-is</option>
                                    <option value="EDIT">Edit amount</option>
                                    <option value="SKIP">Skip gift card</option>
                                  </select>
                                  {editingDepositRowId === row.id && (
                                    <>
                                      <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        value={editingDepositValue}
                                        onChange={(e) => setEditingDepositValue(e.target.value)}
                                        className="w-20 rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleSaveEditedDeposit(row.id)}
                                        disabled={savingRowId === row.id}
                                        className="rounded-full border border-border px-2 py-1 text-xs font-medium text-fg transition hover:bg-surface-raised disabled:opacity-60"
                                      >
                                        Save
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                              {!reviewable && row.depositDecision && (
                                <p className="mt-0.5 text-xs text-fg-muted">Resolved: {row.depositDecision}</p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.isMalformed && (
                            <p className="text-xs font-medium text-danger">Missing mapped first/last name</p>
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
                              onChange={(e) => handleDecisionChange(row.id, e.target.value as ImportRowDecision)}
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

      {showConfirmModal && (
        <Modal title="Confirm Import" onClose={() => setShowConfirmModal(false)}>
          {summaryLoading && <p className="text-sm text-fg-secondary">Loading summary…</p>}
          {summaryError && <p className="text-sm text-danger">{summaryError}</p>}
          {summary && (
            <div className="space-y-3 text-sm text-fg">
              <p>
                This will add <strong>{summary.addCount}</strong> new client{summary.addCount === 1 ? '' : 's'}, merge{' '}
                <strong>{summary.mergeCount}</strong> into existing client{summary.mergeCount === 1 ? '' : 's'}, and skip{' '}
                <strong>{summary.skipCount}</strong> row{summary.skipCount === 1 ? '' : 's'}.
              </p>
              <p>
                It will also issue <strong>{summary.giftCards.count}</strong> gift card
                {summary.giftCards.count === 1 ? '' : 's'} totaling{' '}
                <strong>{formatCents(summary.giftCards.totalCents)}</strong>.
              </p>
              <p className="text-fg-secondary">This cannot be undone.</p>
              {!summary.readyToExecute && (
                <p className="text-danger">
                  This batch is no longer ready to execute -- close this and re-check the review table.
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleExecute}
                  disabled={executing || !summary.readyToExecute}
                  className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                >
                  {executing ? 'Importing…' : 'Execute Import'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

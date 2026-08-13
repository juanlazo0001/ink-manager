import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '../components/Modal'
import PhoneInput from '../components/PhoneInput'
import MultiSelectFilter from '../components/MultiSelectFilter'
import { SkeletonTableRows } from '../components/Skeleton'
import { apiFetch, ApiError, downloadFile } from '../lib/api'
import { formatPhoneInput, formatDateTime, isValidPhoneDigits } from '../lib/format'
import { PlusIcon, SearchIcon } from '../components/icons'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'
import { clientsQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
import { useThemePreset } from '../lib/useThemePreset'
import Eyebrow from '../components/Eyebrow'

interface Client {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  updatedAt: string
  archivedAt: string | null
}

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '' }

const ACTIVITY_FILTER_OPTIONS = [
  { value: 'upcoming_appointment', label: 'Has upcoming appointment' },
  { value: 'active_project', label: 'Has active project' },
  { value: 'no_activity', label: 'No upcoming appointment or active project' },
]

// Same plain-localStorage, one-JSON-blob persistence convention
// Inquiries.tsx already established for its own filter/sort selections.
interface ClientFilterState {
  activityFilter: string[]
  showArchived: boolean
}
const DEFAULT_CLIENT_FILTER_STATE: ClientFilterState = { activityFilter: [], showArchived: false }
const CLIENT_FILTER_STORAGE_KEY = 'ink-manager:clients-filters'

function loadClientFilterState(): ClientFilterState {
  try {
    const raw = localStorage.getItem(CLIENT_FILTER_STORAGE_KEY)
    if (!raw) return DEFAULT_CLIENT_FILTER_STATE
    return { ...DEFAULT_CLIENT_FILTER_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CLIENT_FILTER_STATE
  }
}

// Export column picker: mirrors apps/api/src/routes/clients.ts's own
// EXPORT_FIELD_DEFS exactly (key + label) -- same duplicated-but-must-
// stay-in-sync pattern themePresets.ts already uses between web and api.
// Grouping is presentation-only, for the picker's own layout; the CSV's
// column order always follows this flat list's order (filtered down to
// whatever's checked), which is also the picker's own display order, so
// "column order matches the picker" falls out for free without needing
// a separate drag-to-reorder feature. Health/waiver fields are never
// listed here at all -- not even as a disabled option -- since the
// backend's own field allowlist has no such keys to begin with.
const EXPORT_FIELD_GROUPS: { group: string; fields: { key: string; label: string }[] }[] = [
  {
    group: 'Contact Info',
    fields: [
      { key: 'firstName', label: 'First Name' },
      { key: 'lastName', label: 'Last Name' },
      { key: 'primaryPhone', label: 'Primary Phone' },
      { key: 'otherPhones', label: 'Other Phones' },
      { key: 'primaryEmail', label: 'Primary Email' },
      { key: 'otherEmails', label: 'Other Emails' },
      { key: 'instagram', label: 'Instagram' },
      { key: 'facebook', label: 'Facebook' },
      { key: 'otherContact', label: 'Other Contact' },
      { key: 'address', label: 'Address' },
    ],
  },
  {
    group: 'Referral',
    fields: [{ key: 'referralCode', label: 'Referral Code' }],
  },
  {
    group: 'Dates',
    fields: [{ key: 'createdDate', label: 'Created Date' }],
  },
]
const ALL_EXPORT_FIELD_KEYS = EXPORT_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key))

// Full-record categories, beyond contact fields -- mirrors the backend's
// own SECTION_KEYS (apps/api/src/lib/clientFullExport.ts) exactly, same
// duplicated-but-must-stay-in-sync convention as EXPORT_FIELD_GROUPS
// above. Only shown to callers with waivers.viewStatus (canExportFullData
// below); picking any of these switches the download from a plain CSV to
// a ZIP (POST /clients/export-full instead of /export).
const FULL_RECORD_SECTIONS: { key: string; label: string }[] = [
  { key: 'inquiries', label: 'Inquiries' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'giftCards', label: 'Gift Cards' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'waivers', label: 'Waivers' },
]
const ALL_SECTION_KEYS = FULL_RECORD_SECTIONS.map((s) => s.key)

const EXPORT_SECTIONS_STORAGE_KEY = 'ink-manager:clients-export-sections'

function loadExportSections(): string[] {
  try {
    const raw = localStorage.getItem(EXPORT_SECTIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k) => ALL_SECTION_KEYS.includes(k))
  } catch {
    return []
  }
}

// Browser-local, not account-wide -- same convention as CLIENT_FILTER_STORAGE_KEY
// just above (Inquiries.tsx's own column-visibility memory uses the
// identical pattern). No dedicated per-user preference infrastructure
// exists in this app for a feature this small to justify building one;
// this is the deliberate "lightweight mechanism already exists" answer.
const EXPORT_FIELDS_STORAGE_KEY = 'ink-manager:clients-export-fields'

function loadExportFields(): string[] {
  try {
    const raw = localStorage.getItem(EXPORT_FIELDS_STORAGE_KEY)
    if (!raw) return ALL_EXPORT_FIELD_KEYS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return ALL_EXPORT_FIELD_KEYS
    const valid = parsed.filter((k) => ALL_EXPORT_FIELD_KEYS.includes(k))
    return valid.length > 0 ? valid : ALL_EXPORT_FIELD_KEYS
  } catch {
    return ALL_EXPORT_FIELD_KEYS
  }
}

export default function Clients() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  const { profile } = useUserProfile()
  // clients.manage was retired (split into clients.view/edit/merge/archive/
  // import) -- Add Client hits POST /clients (gated clients.edit on the
  // backend), Import Clients is its own dedicated clients.import permission.
  const canAddClient = profile?.permissions.includes('clients.edit') ?? false
  const canImportClients = profile?.permissions.includes('clients.import') ?? false
  const canExportClients = profile?.permissions.includes('bulkActions.use') ?? false
  // Gates the full-record section/PDF checkboxes inside the export modal
  // (Inquiries/Sessions/Gift Cards/Deposits/Waivers) -- mirrors the
  // backend's dual gate on POST /export-full (bulkActions.use AND
  // waivers.viewStatus) so those checkboxes are simply absent for anyone
  // who couldn't use them anyway, same as the button used to be absent.
  const canExportFullData = canExportClients && (profile?.permissions.includes('waivers.viewStatus') ?? false)
  const [search, setSearch] = useState('')
  const [activityFilter, setActivityFilter] = useState<string[]>(() => loadClientFilterState().activityFilter)
  const [showArchived, setShowArchived] = useState(() => loadClientFilterState().showArchived)
  useMarkSectionSeen('clients')

  useEffect(() => {
    const state: ClientFilterState = { activityFilter, showArchived }
    localStorage.setItem(CLIENT_FILTER_STORAGE_KEY, JSON.stringify(state))
  }, [activityFilter, showArchived])

  // Set by ClientDetail's permanent-delete flow on redirect -- read once,
  // then cleared from history so a refresh (or back navigation) doesn't
  // keep showing it.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    const state = location.state as { flash?: string } | null
    if (state?.flash) {
      setFlash(state.flash)
      window.history.replaceState({}, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showExportFieldPicker, setShowExportFieldPicker] = useState(false)
  const [exportFields, setExportFields] = useState<Set<string>>(() => new Set(loadExportFields()))
  const [exportSections, setExportSections] = useState<Set<string>>(() => new Set(loadExportSections()))
  const [includePdfs, setIncludePdfs] = useState(false)

  useEffect(() => {
    localStorage.setItem(EXPORT_FIELDS_STORAGE_KEY, JSON.stringify([...exportFields]))
  }, [exportFields])

  useEffect(() => {
    localStorage.setItem(EXPORT_SECTIONS_STORAGE_KEY, JSON.stringify([...exportSections]))
  }, [exportSections])

  function toggleExportField(key: string) {
    setExportFields((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleExportSection(key: string) {
    setExportSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // Deposits/Waivers PDFs only ever make sense alongside their own
      // section -- unchecking the last of those two turns includePdfs
      // back off, rather than leaving a silently-ignored true behind.
      if (!next.has('deposits') && !next.has('waivers')) setIncludePdfs(false)
      return next
    })
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setExportError(null)
  }

  const queryClient = useQueryClient()
  const baseQueryKey = clientsQueryKey(user!.studioId)
  const queryKey = [...baseQueryKey, [...activityFilter].sort(), showArchived]

  const {
    data: clients,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams()
      activityFilter.forEach((value) => params.append('activity', value))
      if (showArchived) params.set('includeArchived', 'true')
      const qs = params.toString()
      return apiFetch<Client[]>(`/clients${qs ? `?${qs}` : ''}`)
    },
  })

  const errorMessage = error
    ? error instanceof ApiError && error.status === 403
      ? "You don't have permission to view clients."
      : error.message
    : null

  const addClient = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      apiFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email || undefined,
          phone: payload.phone || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: baseQueryKey })
      setShowAddModal(false)
      setForm(EMPTY_FORM)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to create client')
    },
  })

  function handleAddClient(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!isValidPhoneDigits(form.phone)) {
      setFormError('Enter a complete 10-digit phone number.')
      return
    }
    addClient.mutate(form)
  }

  const filteredClients = clients?.filter((client) =>
    `${client.firstName} ${client.lastName}`.toLowerCase().includes(search.toLowerCase()),
  )

  const allVisibleSelected = !!filteredClients && filteredClients.length > 0 && filteredClients.every((c) => selectedIds.has(c.id))

  function toggleSelectAllVisible() {
    if (!filteredClients) return
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const c of filteredClients) next.delete(c.id)
        return next
      }
      const next = new Set(prev)
      for (const c of filteredClients) next.add(c.id)
      return next
    })
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // No selection = export everything matching the current filters (not
  // just what's loaded/visible -- the backend re-derives the filter with
  // no cap, see clients.ts's own POST /export). A non-empty selection
  // exports exactly those rows instead, whichever way staff picked them.
  //
  // Same button/modal drives both outputs: picking only contact fields
  // hits POST /export and downloads a plain CSV, unchanged from before
  // full-record sections existed. Checking any of Inquiries/Sessions/
  // Gift Cards/Deposits/Waivers switches to POST /export-full and
  // downloads a ZIP instead -- exportSections.size is the only thing
  // that decides which.
  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const fields = ALL_EXPORT_FIELD_KEYS.filter((k) => exportFields.has(k))
      const filterBody =
        selectedIds.size > 0
          ? { clientIds: [...selectedIds] }
          : { filter: { q: search.trim() || undefined, includeArchived: showArchived, activity: activityFilter } }

      if (exportSections.size > 0) {
        await downloadFile(`/clients/export-full`, `clients-full-export-${new Date().toISOString().slice(0, 10)}.zip`, {
          method: 'POST',
          body: JSON.stringify({ ...filterBody, fields, sections: [...exportSections], includePdfs }),
        })
      } else {
        await downloadFile(`/clients/export`, `clients-export-${new Date().toISOString().slice(0, 10)}.csv`, {
          method: 'POST',
          body: JSON.stringify({ ...filterBody, fields }),
        })
      }
      setSelectionMode(false)
      setSelectedIds(new Set())
      setShowExportFieldPicker(false)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export clients')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          {flash && (
            <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
              <span>{flash}</span>
              <button type="button" onClick={() => setFlash(null)} className="text-xs font-medium underline">
                Dismiss
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              {isEditorial && <Eyebrow>Everyone who's booked with your studio.</Eyebrow>}
              <h1
                className={
                  isEditorial
                    ? 'mt-1 font-display text-[clamp(28px,3.4vw,38px)] font-normal tracking-[-0.015em] text-fg'
                    : 'text-2xl font-bold text-fg sm:text-3xl'
                }
              >
                Clients
              </h1>
              {!isEditorial && <p className="mt-1 text-sm text-fg-secondary">Everyone who's booked with your studio.</p>}
            </div>

            {(canImportClients || canAddClient) && (
              <div className="flex flex-wrap items-center gap-2">
                {canImportClients && (
                  <Link
                    to="/clients/import"
                    className={
                      isEditorial
                        ? 'editorial-btn-secondary flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 transition'
                        : 'flex shrink-0 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface'
                    }
                  >
                    <span className="whitespace-nowrap">Import Clients</span>
                  </Link>
                )}
                {canExportClients && !selectionMode && (
                  <button
                    type="button"
                    onClick={() => setSelectionMode(true)}
                    className={
                      isEditorial
                        ? 'editorial-btn-secondary flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 transition'
                        : 'flex shrink-0 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface'
                    }
                  >
                    <span className="whitespace-nowrap">Export</span>
                  </button>
                )}
                {canExportClients && selectionMode && (
                  <>
                    <button
                      type="button"
                      onClick={exitSelectionMode}
                      disabled={exporting}
                      className={
                        isEditorial
                          ? 'editorial-btn-secondary flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 transition disabled:opacity-60'
                          : 'flex shrink-0 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                      }
                    >
                      <span className="whitespace-nowrap">Cancel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowExportFieldPicker(true)}
                      disabled={exporting}
                      className={
                        isEditorial
                          ? 'editorial-btn-primary flex shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'flex shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                    >
                      <span className="whitespace-nowrap">
                        {exporting
                          ? 'Exporting…'
                          : selectedIds.size > 0
                            ? `Export ${selectedIds.size} Selected`
                            : 'Export All'}
                      </span>
                    </button>
                  </>
                )}
                {canAddClient && (
                  <button
                    type="button"
                    onClick={() => setShowAddModal(true)}
                    className={
                      isEditorial
                        ? 'editorial-btn-primary flex shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover'
                        : 'flex shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover'
                    }
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span className="whitespace-nowrap">Add Client</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg sm:w-64">
              <SearchIcon className="h-4 w-4 shrink-0 text-fg-muted" />
              <input
                type="text"
                placeholder="Search by name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full min-w-0 bg-transparent placeholder:text-fg-muted focus:outline-none"
              />
            </div>

            <MultiSelectFilter
              placeholder="All activity"
              options={ACTIVITY_FILTER_OPTIONS}
              selected={activityFilter}
              onChange={setActivityFilter}
              className="w-full sm:w-56"
            />

            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
              className={[
                'shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition',
                showArchived
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border text-fg-secondary hover:bg-surface hover:text-fg',
              ].join(' ')}
            >
              Show archived
            </button>
          </div>

          {/* .card-surface (glass treatment under Editorial Gold) restored
              here by explicit request, to match the Inquiries & Projects
              table's own background -- overrides the earlier "dense-data
              table, no glass" reasoning that had removed it (see git
              history/REPORT.md for that prior pass' rationale, still true
              for Conversations' thread list / Calendar's grid, just not
              applied here anymore). */}
          <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-5">
            {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredClients?.length === 0 && (
              <p className="text-sm text-fg-secondary">
                {search || activityFilter.length > 0
                  ? 'No clients match these filters.'
                  : 'No clients yet. Add your first one to get started.'}
              </p>
            )}

            {!errorMessage && (isLoading || (filteredClients && filteredClients.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      {canExportClients && selectionMode && (
                        <th className="w-8 py-2 font-medium">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Select all visible clients"
                            className="accent-accent"
                          />
                        </th>
                      )}
                      <th className="py-2 font-medium">Name</th>
                      <th className="hidden py-2 font-medium md:table-cell">Email</th>
                      <th className="hidden py-2 font-medium sm:table-cell">Phone</th>
                      <th className="hidden py-2 font-medium lg:table-cell">Last Modified</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows
                      rows={6}
                      columns={4}
                      columnClassNames={['', 'hidden md:table-cell', 'hidden sm:table-cell', 'hidden lg:table-cell']}
                    />
                  ) : (
                    <tbody className="divide-y divide-border">
                      {filteredClients!.map((client) => (
                        <tr
                          key={client.id}
                          onClick={() => navigate(`/clients/${client.id}`)}
                          className="cursor-pointer hover:bg-surface/40"
                        >
                          {canExportClients && selectionMode && (
                            <td className="py-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(client.id)}
                                onChange={() => toggleSelectOne(client.id)}
                                aria-label={`Select ${client.firstName} ${client.lastName}`}
                                className="accent-accent"
                              />
                            </td>
                          )}
                          <td className="py-3 text-fg">
                            {client.firstName} {client.lastName}
                            {client.archivedAt && (
                              <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
                                Archived
                              </span>
                            )}
                          </td>
                          <td className="hidden py-3 text-fg-secondary md:table-cell">{client.email ?? '—'}</td>
                          <td className="hidden py-3 text-fg-secondary sm:table-cell">
                            {client.phone ? formatPhoneInput(client.phone) : '—'}
                          </td>
                          <td className="hidden py-3 text-fg-secondary lg:table-cell">{formatDateTime(client.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>

      {showExportFieldPicker && (
        <Modal title="Choose What to Export" onClose={() => setShowExportFieldPicker(false)}>
          <div className="space-y-5">
            {EXPORT_FIELD_GROUPS.map((group) => {
              const groupKeys = group.fields.map((f) => f.key)
              const allChecked = groupKeys.every((k) => exportFields.has(k))
              const noneChecked = groupKeys.every((k) => !exportFields.has(k))
              return (
                <div key={group.group}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{group.group}</h3>
                    <div className="flex gap-3 text-xs font-medium text-accent">
                      <button
                        type="button"
                        disabled={allChecked}
                        onClick={() => setExportFields((prev) => new Set([...prev, ...groupKeys]))}
                        className="hover:underline disabled:opacity-40 disabled:no-underline"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        disabled={noneChecked}
                        onClick={() =>
                          setExportFields((prev) => {
                            const next = new Set(prev)
                            groupKeys.forEach((k) => next.delete(k))
                            return next
                          })
                        }
                        className="hover:underline disabled:opacity-40 disabled:no-underline"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {group.fields.map((field) => (
                      <label key={field.key} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          checked={exportFields.has(field.key)}
                          onChange={() => toggleExportField(field.key)}
                          className="h-4 w-4 shrink-0 rounded border-border accent-accent"
                        />
                        <span>{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}

            {canExportFullData && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Full Record Data (OWNER)
                  </h3>
                  <div className="flex gap-3 text-xs font-medium text-accent">
                    <button
                      type="button"
                      disabled={ALL_SECTION_KEYS.every((k) => exportSections.has(k))}
                      onClick={() => setExportSections(new Set(ALL_SECTION_KEYS))}
                      className="hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      disabled={exportSections.size === 0}
                      onClick={() => {
                        setExportSections(new Set())
                        setIncludePdfs(false)
                      }}
                      className="hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {FULL_RECORD_SECTIONS.map((section) => (
                    <label key={section.key} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={exportSections.has(section.key)}
                        onChange={() => toggleExportSection(section.key)}
                        className="h-4 w-4 shrink-0 rounded border-border accent-accent"
                      />
                      <span>{section.label}</span>
                    </label>
                  ))}
                </div>
                {(exportSections.has('deposits') || exportSections.has('waivers')) && (
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={includePdfs}
                      onChange={() => setIncludePdfs((v) => !v)}
                      className="h-4 w-4 shrink-0 rounded border-border accent-accent"
                    />
                    <span>Include signed PDFs (deposit forms &amp; waivers)</span>
                  </label>
                )}
                {exportSections.size > 0 && (
                  <p className="mt-3 text-sm text-fg-secondary">
                    Waivers include{' '}
                    <strong className="font-semibold text-fg">
                      health screening answers, signatures, and whether an ID is on file
                    </strong>
                    . This switches the download to a ZIP and can take a while to generate for a large export.
                  </p>
                )}
              </div>
            )}
          </div>

          {exportFields.size === 0 && (
            <p className="mt-4 text-sm text-danger">Select at least one contact column to export.</p>
          )}
          {exportError && <p className="mt-4 text-sm text-danger">{exportError}</p>}

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || exportFields.size === 0}
            className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
          >
            {exporting ? 'Exporting…' : selectedIds.size > 0 ? `Export ${selectedIds.size} Selected` : 'Export All'}
          </button>
        </Modal>
      )}

      {showAddModal && (
        <Modal title="Add Client" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddClient}>
            {formError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="mb-1 block text-sm font-medium text-fg-secondary">
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label htmlFor="lastName" className="mb-1 block text-sm font-medium text-fg-secondary">
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={form.lastName}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-fg-secondary">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mt-3">
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-fg-secondary">
                Phone
              </label>
              <PhoneInput
                id="phone"
                value={form.phone}
                onChange={(digits) => setForm({ ...form, phone: digits })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <button
              type="submit"
              disabled={addClient.isPending}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {addClient.isPending ? 'Adding…' : 'Add Client'}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}

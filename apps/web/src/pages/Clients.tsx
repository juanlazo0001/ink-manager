import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import PhoneInput from '../components/PhoneInput'
import { SkeletonTableRows } from '../components/Skeleton'
import { apiFetch, ApiError } from '../lib/api'
import { formatPhoneInput, isValidPhoneDigits } from '../lib/format'
import { PlusIcon, SearchIcon } from '../components/icons'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'
import { clientsQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'

interface Client {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '' }

export default function Clients() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canManage = profile?.permissions.includes('clients.manage') ?? false
  const [search, setSearch] = useState('')
  useMarkSectionSeen('clients')

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

  const queryClient = useQueryClient()
  const queryKey = clientsQueryKey(user!.studioId)

  const {
    data: clients,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => apiFetch<Client[]>('/clients'),
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
      queryClient.invalidateQueries({ queryKey })
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

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
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
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">Clients</h1>
              <p className="mt-1 text-sm text-fg-secondary">Everyone who's booked with your studio.</p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                <PlusIcon className="h-4 w-4" />
                Add Client
              </button>
            )}
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg sm:max-w-xs">
            <SearchIcon className="h-4 w-4 text-fg-muted" />
            <input
              type="text"
              placeholder="Search by name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent placeholder:text-fg-muted focus:outline-none"
            />
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
            {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredClients?.length === 0 && (
              <p className="text-sm text-fg-secondary">
                {search ? 'No clients match your search.' : 'No clients yet. Add your first one to get started.'}
              </p>
            )}

            {!errorMessage && (isLoading || (filteredClients && filteredClients.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className="pb-3 font-medium">Name</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Email</th>
                      <th className="hidden pb-3 font-medium sm:table-cell">Phone</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows
                      rows={6}
                      columns={3}
                      columnClassNames={['', 'hidden md:table-cell', 'hidden sm:table-cell']}
                    />
                  ) : (
                    <tbody className="divide-y divide-border">
                      {filteredClients!.map((client) => (
                        <tr
                          key={client.id}
                          onClick={() => navigate(`/clients/${client.id}`)}
                          className="cursor-pointer hover:bg-surface/40"
                        >
                          <td className="py-3 text-fg">
                            {client.firstName} {client.lastName}
                          </td>
                          <td className="hidden py-3 text-fg-secondary md:table-cell">{client.email ?? '—'}</td>
                          <td className="hidden py-3 text-fg-secondary sm:table-cell">
                            {client.phone ? formatPhoneInput(client.phone) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

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
    </div>
  )
}

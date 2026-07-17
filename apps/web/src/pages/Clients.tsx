import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { SkeletonTableRows } from '../components/Skeleton'
import { apiFetch, ApiError } from '../lib/api'
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
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canManage = profile?.permissions.includes('clients.manage') ?? false
  const [search, setSearch] = useState('')
  useMarkSectionSeen('clients')

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
    addClient.mutate(form)
  }

  const filteredClients = clients?.filter((client) =>
    `${client.firstName} ${client.lastName}`.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Clients</h1>
              <p className="mt-1 text-sm text-neutral-400">Everyone who's booked with your studio.</p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
              >
                <PlusIcon className="h-4 w-4" />
                Add Client
              </button>
            )}
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white sm:max-w-xs">
            <SearchIcon className="h-4 w-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search by name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent placeholder:text-neutral-500 focus:outline-none"
            />
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredClients?.length === 0 && (
              <p className="text-sm text-neutral-400">
                {search ? 'No clients match your search.' : 'No clients yet. Add your first one to get started.'}
              </p>
            )}

            {!errorMessage && (isLoading || (filteredClients && filteredClients.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500">
                      <th className="pb-3 font-medium">Name</th>
                      <th className="pb-3 font-medium">Email</th>
                      <th className="pb-3 font-medium">Phone</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows rows={6} columns={3} />
                  ) : (
                    <tbody className="divide-y divide-neutral-800">
                      {filteredClients!.map((client) => (
                        <tr
                          key={client.id}
                          onClick={() => navigate(`/clients/${client.id}`)}
                          className="cursor-pointer hover:bg-neutral-800/40"
                        >
                          <td className="py-3 text-white">
                            {client.firstName} {client.lastName}
                          </td>
                          <td className="py-3 text-neutral-400">{client.email ?? '—'}</td>
                          <td className="py-3 text-neutral-400">{client.phone ?? '—'}</td>
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
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="mb-1 block text-sm font-medium text-neutral-300">
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>

              <div>
                <label htmlFor="lastName" className="mb-1 block text-sm font-medium text-neutral-300">
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={form.lastName}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div className="mt-3">
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-neutral-300">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <button
              type="submit"
              disabled={addClient.isPending}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {addClient.isPending ? 'Adding…' : 'Add Client'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}

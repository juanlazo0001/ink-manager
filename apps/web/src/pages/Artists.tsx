import { useEffect, useState, type FormEvent } from 'react'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { useUserProfile } from '../context/useUserProfile'
import { PlusIcon } from '../components/icons'

interface Artist {
  id: string
  bio: string | null
  specialties: string[]
  user: { id: string; email: string }
}

const EMPTY_FORM = { email: '', password: '', bio: '', specialties: '' }

export default function Artists() {
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canManage = profile?.permissions.includes('artists.manage') ?? false

  const [artists, setArtists] = useState<Artist[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let ignore = false

    async function load() {
      setError(null)

      try {
        const data = await apiFetch<Artist[]>('/artists')
        if (!ignore) setArtists(data)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view artists.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load artists')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [refreshIndex])

  async function handleAddArtist(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)

    const studioId = user?.studioId

    if (!studioId) {
      setFormError('Missing studio context — try logging in again.')
      setSubmitting(false)
      return
    }

    let newUserId: string

    try {
      const newUser = await apiFetch<{ id: string }>(`/studios/${studioId}/users`, {
        method: 'POST',
        body: JSON.stringify({ email: form.email, password: form.password, role: 'ARTIST' }),
      })
      newUserId = newUser.id
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user account')
      setSubmitting(false)
      return
    }

    try {
      const specialties = form.specialties
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      await apiFetch('/artists', {
        method: 'POST',
        body: JSON.stringify({ userId: newUserId, bio: form.bio || undefined, specialties }),
      })

      setShowAddModal(false)
      setForm(EMPTY_FORM)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create artist profile'
      setFormError(
        `A user account was created for ${form.email}, but the artist profile could not be set up: ${message}. ` +
          "You'll need to try again or handle this manually — the account already exists.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Artists</h1>
              <p className="mt-1 text-sm text-neutral-400">Everyone tattooing at your studio.</p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
              >
                <PlusIcon className="h-4 w-4" />
                Add Artist
              </button>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {error && <p className="text-sm text-red-400">{error}</p>}

            {!error && artists === null && <p className="text-sm text-neutral-400">Loading artists…</p>}

            {!error && artists !== null && artists.length === 0 && (
              <p className="text-sm text-neutral-400">
                {canManage ? 'No artists yet. Add your first one to get started.' : 'No artists yet.'}
              </p>
            )}

            {!error && artists && artists.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500">
                      <th className="pb-3 font-medium">Email</th>
                      <th className="pb-3 font-medium">Bio</th>
                      <th className="pb-3 font-medium">Specialties</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {artists.map((artist) => (
                      <tr key={artist.id}>
                        <td className="py-3 text-white">{artist.user.email}</td>
                        <td className="max-w-xs py-3 text-neutral-400">
                          <span className="line-clamp-2">{artist.bio ?? '—'}</span>
                        </td>
                        <td className="py-3">
                          {artist.specialties.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {artist.specialties.map((specialty) => (
                                <span
                                  key={specialty}
                                  className="inline-flex items-center rounded-full border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300"
                                >
                                  {specialty}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-neutral-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddModal && (
        <Modal title="Add Artist" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddArtist}>
            {formError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {formError}
              </div>
            )}

            <div className="mb-3">
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-300">
                Temporary Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="bio" className="mb-1 block text-sm font-medium text-neutral-300">
                Bio
              </label>
              <textarea
                id="bio"
                rows={3}
                value={form.bio}
                onChange={(event) => setForm({ ...form, bio: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div>
              <label htmlFor="specialties" className="mb-1 block text-sm font-medium text-neutral-300">
                Specialties
              </label>
              <input
                id="specialties"
                type="text"
                placeholder="e.g. Blackwork, Fine line, Realism"
                value={form.specialties}
                onChange={(event) => setForm({ ...form, specialties: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
              <p className="mt-1 text-xs text-neutral-500">Comma-separated.</p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {submitting ? 'Adding…' : 'Add Artist'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}

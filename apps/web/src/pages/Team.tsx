import { Fragment, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { SkeletonCards } from '../components/Skeleton'
import StatusPill from '../components/StatusPill'
import { apiFetch, ApiError } from '../lib/api'
import { formatStatus, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { PERMISSION_GROUPS, CONFIGURABLE_ROLES } from '../lib/permissions'
import { artistsQueryKey } from '../lib/queryKeys'
import { useAuth } from '../context/useAuth'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { PlusIcon, ViewIcon } from '../components/icons'

type PermissionMatrix = Record<string, Record<string, boolean>>
type TeamTab = 'staff' | 'artists' | 'permissions'

interface ArtistCard {
  id: string
  bio: string | null
  specialties: string[]
  portfolioImages: string[]
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
}

interface PermissionsResponse {
  permissionKeys: string[]
  matrix: PermissionMatrix
}

interface TeamUser {
  id: string
  email: string
  name: string | null
  phone: string | null
  avatarUrl: string | null
  role: string
  isActive: boolean
  createdAt: string
  locationId: string | null
  artist?: { bio: string | null; specialties: string[] }
}

interface LocationOption {
  id: string
  name: string
}

const ROLE_OPTIONS = ['OWNER', 'FRONT_DESK', 'ARTIST', 'CUSTOMER']

const EMPTY_ADD_FORM = { name: '', phone: '', email: '', password: '', role: 'FRONT_DESK' }

const EMPTY_EDIT_FORM = {
  name: '',
  phone: '',
  email: '',
  role: 'FRONT_DESK',
  isActive: true,
  newPassword: '',
  locationId: '',
}

function emptyEditForm(teamUser: TeamUser) {
  return {
    name: teamUser.name ?? '',
    phone: teamUser.phone ?? '',
    email: teamUser.email,
    role: teamUser.role,
    isActive: teamUser.isActive,
    newPassword: '',
    locationId: teamUser.locationId ?? '',
  }
}

export default function Team() {
  const { user: realUser } = useAuth()
  const user = useEffectiveUser()
  const isOwner = user?.role === 'OWNER'
  const { target: viewAsTarget, startViewAs } = useViewAs()
  // The View As entry point reflects who's REALLY logged in, not the
  // impersonated target -- and is hidden entirely while already viewing as
  // someone (switch by exiting first).
  const canUseViewAs = realUser?.role === 'OWNER' && !viewAsTarget
  const [viewAsError, setViewAsError] = useState<string | null>(null)
  const navigate = useNavigate()

  // Staff/Permissions are OWNER-only (unchanged); Artists is open to
  // whoever has the 'artists.view' permission (a configurable per-role
  // permission, same as the old standalone Artists page -- so a
  // non-owner landing here via /team?tab=artists still gets in, they just
  // won't see the Staff/Permissions tabs).
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') as TeamTab | null
  const activeTab: TeamTab = requestedTab && (isOwner || requestedTab === 'artists') ? requestedTab : isOwner ? 'staff' : 'artists'

  function setTab(tab: TeamTab) {
    setSearchParams(tab === 'staff' ? {} : { tab })
  }

  const {
    data: artists,
    isLoading: artistsLoading,
    error: artistsError,
  } = useQuery({
    queryKey: artistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistCard[]>('/artists'),
  })

  const artistsErrorMessage = artistsError
    ? artistsError instanceof ApiError && artistsError.status === 403
      ? "You don't have permission to view artists."
      : artistsError.message
    : null

  const [users, setUsers] = useState<TeamUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM)
  const [addAvatarUrl, setAddAvatarUrl] = useState<string | null>(null)
  const [addFormError, setAddFormError] = useState<string | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)

  const [editingUser, setEditingUser] = useState<TeamUser | null>(null)
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM)
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null)
  const [editFormError, setEditFormError] = useState<string | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [permissionsMatrix, setPermissionsMatrix] = useState<PermissionMatrix | null>(null)
  const [permissionsError, setPermissionsError] = useState<string | null>(null)
  const [permissionsSuccess, setPermissionsSuccess] = useState(false)
  const [permissionsSubmitting, setPermissionsSubmitting] = useState(false)

  const [locations, setLocations] = useState<LocationOption[] | null>(null)

  useEffect(() => {
    if (!isOwner || !user?.studioId) return
    let ignore = false

    async function load() {
      setError(null)

      try {
        const data = await apiFetch<TeamUser[]>(`/studios/${user!.studioId}/users`)
        if (!ignore) setUsers(data)
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load team')
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [isOwner, user?.studioId, refreshIndex])

  useEffect(() => {
    if (!isOwner || !user?.studioId) return
    let ignore = false

    async function loadPermissions() {
      setPermissionsError(null)

      try {
        const data = await apiFetch<PermissionsResponse>(`/studios/${user!.studioId}/permissions`)
        if (!ignore) setPermissionsMatrix(data.matrix)
      } catch (err) {
        if (!ignore) setPermissionsError(err instanceof Error ? err.message : 'Failed to load permissions')
      }
    }

    loadPermissions()

    return () => {
      ignore = true
    }
  }, [isOwner, user?.studioId])

  useEffect(() => {
    if (!isOwner || !user?.studioId) return
    let ignore = false

    apiFetch<LocationOption[]>(`/studios/${user.studioId}/locations`)
      .then((data) => {
        if (!ignore) setLocations(data)
      })
      .catch(() => {
        // The location dropdown just stays empty if this fails.
      })

    return () => {
      ignore = true
    }
  }, [isOwner, user?.studioId])

  function togglePermission(role: string, key: string) {
    setPermissionsSuccess(false)
    setPermissionsMatrix((current) => {
      if (!current) return current
      return { ...current, [role]: { ...current[role], [key]: !current[role][key] } }
    })
  }

  async function handleSavePermissions() {
    if (!user?.studioId || !permissionsMatrix) return

    setPermissionsError(null)
    setPermissionsSubmitting(true)

    const updates = CONFIGURABLE_ROLES.flatMap((role) =>
      PERMISSION_GROUPS.flatMap((group) =>
        group.keys.map(({ key }) => ({ role, permissionKey: key, allowed: permissionsMatrix[role][key] })),
      ),
    )

    try {
      const data = await apiFetch<PermissionsResponse>(`/studios/${user.studioId}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ updates }),
      })
      setPermissionsMatrix(data.matrix)
      setPermissionsSuccess(true)
    } catch (err) {
      setPermissionsError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setPermissionsSubmitting(false)
    }
  }

  async function handleAvatarFileChange(
    event: ChangeEvent<HTMLInputElement>,
    setAvatarUrl: (value: string | null) => void,
    setFormError: (value: string | null) => void,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setFormError(null)

    if (!file.type.startsWith('image/')) {
      setFormError('Please choose an image file.')
      return
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setFormError('Profile picture must be under 5MB.')
      return
    }

    try {
      setAvatarUrl(await readFileAsDataUrl(file))
    } catch {
      setFormError('Could not read that image. Please try a different file.')
    }
  }

  async function handleAddSubmit(event: FormEvent) {
    event.preventDefault()
    if (!user?.studioId) return

    setAddFormError(null)
    setAddSubmitting(true)

    try {
      await apiFetch(`/studios/${user.studioId}/users`, {
        method: 'POST',
        body: JSON.stringify({ ...addForm, avatarUrl: addAvatarUrl }),
      })
      setShowAddModal(false)
      setAddForm(EMPTY_ADD_FORM)
      setAddAvatarUrl(null)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setAddFormError(err instanceof Error ? err.message : 'Failed to add team member')
    } finally {
      setAddSubmitting(false)
    }
  }

  function openEdit(teamUser: TeamUser) {
    setEditingUser(teamUser)
    setEditForm(emptyEditForm(teamUser))
    setEditAvatarUrl(teamUser.avatarUrl)
    setEditFormError(null)
  }

  async function handleViewAs(targetUserId: string) {
    setViewAsError(null)
    try {
      await startViewAs(targetUserId)
      navigate('/dashboard')
    } catch (err) {
      setViewAsError(err instanceof Error ? err.message : 'Failed to start View As')
    }
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault()
    if (!user?.studioId || !editingUser) return

    setEditFormError(null)
    setEditSubmitting(true)

    const payload: Record<string, unknown> = {
      name: editForm.name,
      phone: editForm.phone,
      email: editForm.email,
      role: editForm.role,
      isActive: editForm.isActive,
      avatarUrl: editAvatarUrl,
      locationId: editForm.locationId || null,
    }
    if (editForm.newPassword.trim().length > 0) {
      payload.newPassword = editForm.newPassword
    }

    try {
      await apiFetch(`/studios/${user.studioId}/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setEditingUser(null)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setEditFormError(err instanceof Error ? err.message : 'Failed to update team member')
    } finally {
      setEditSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">Team</h1>
              <p className="mt-1 text-sm text-fg-secondary">Everyone with access to your studio's portal.</p>
            </div>

            {isOwner && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                <PlusIcon className="h-4 w-4" />
                Add team member
              </button>
            )}
          </div>

          <div className="mt-6 flex gap-1 border-b border-border">
            {(
              [
                ['staff', 'Staff'],
                ['artists', 'Artists'],
                ['permissions', 'Permissions'],
              ] as const
            )
              .filter(([tab]) => tab === 'artists' || isOwner)
              .map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setTab(tab)}
                  className={[
                    'rounded-t-lg px-4 py-2 text-sm font-medium transition',
                    activeTab === tab
                      ? 'border-b-2 border-accent text-fg'
                      : 'text-fg-muted hover:text-fg',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
          </div>

          {activeTab === 'staff' && isOwner && (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
            {viewAsError && <p className="mb-3 text-sm text-danger">{viewAsError}</p>}
            {error && <p className="text-sm text-danger">{error}</p>}

            {!error && users === null && <p className="text-sm text-fg-secondary">Loading team…</p>}

            {!error && users !== null && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className="pb-3 font-medium">Name</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Email</th>
                      <th className="hidden pb-3 font-medium sm:table-cell">Role</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((teamUser) => {
                      const isSelf = teamUser.id === user?.userId
                      return (
                        <tr key={teamUser.id}>
                          <td className="py-3 text-fg">
                            <div className="flex items-center gap-2.5">
                              {teamUser.avatarUrl ? (
                                <img
                                  src={teamUser.avatarUrl}
                                  alt={teamUser.name ?? teamUser.email}
                                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                                />
                              ) : (
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-fg">
                                  {(teamUser.name ?? teamUser.email).slice(0, 1).toUpperCase()}
                                </span>
                              )}
                              {teamUser.name || '—'}
                            </div>
                          </td>
                          <td className="hidden py-3 text-fg-secondary md:table-cell">{teamUser.email}</td>
                          <td className="hidden py-3 text-fg-secondary sm:table-cell">{formatStatus(teamUser.role)}</td>
                          <td className="py-3">
                            <StatusPill
                              status={teamUser.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                              label={teamUser.isActive ? 'Active' : 'Deactivated'}
                            />
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-2">
                              {canUseViewAs && teamUser.id !== realUser?.userId && teamUser.role !== 'CUSTOMER' && (
                                <button
                                  type="button"
                                  onClick={() => handleViewAs(teamUser.id)}
                                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                                >
                                  <ViewIcon className="h-3.5 w-3.5" />
                                  View as
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEdit(teamUser)}
                                disabled={isSelf}
                                title={isSelf ? 'Edit your own account from your profile' : undefined}
                                className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {activeTab === 'artists' && (
            <div className="mt-6">
              {artistsErrorMessage && (
                <div className="rounded-2xl border border-border bg-surface p-5">
                  <p className="text-sm text-danger">{artistsErrorMessage}</p>
                </div>
              )}

              {!artistsErrorMessage && artistsLoading && <SkeletonCards count={6} />}

              {!artistsErrorMessage && !artistsLoading && artists?.length === 0 && (
                <div className="rounded-2xl border border-border bg-surface p-5">
                  <p className="text-sm text-fg-secondary">
                    No artists yet.{' '}
                    {isOwner
                      ? "Add one from the Staff tab (role: Artist) — their profile here is created automatically."
                      : 'Ask a studio owner to add one from the Staff tab.'}
                  </p>
                </div>
              )}

              {!artistsErrorMessage && artists && artists.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {artists.map((artist) => (
                    <div
                      key={artist.id}
                      onClick={() => navigate(`/artists/${artist.id}`)}
                      className="cursor-pointer rounded-2xl border border-border bg-surface p-5 transition hover:border-border-strong"
                    >
                      <div className="flex items-center gap-3">
                        {artist.user.avatarUrl ? (
                          <img
                            src={artist.user.avatarUrl}
                            alt={artist.user.name ?? artist.user.email}
                            className="h-12 w-12 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-lg font-semibold text-fg">
                            {(artist.user.name ?? artist.user.email).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-fg">
                            {artist.user.name || artist.user.email}
                          </p>
                          <p className="truncate text-xs text-fg-muted">{artist.user.email}</p>
                        </div>
                      </div>

                      {artist.bio && <p className="mt-3 line-clamp-2 text-sm text-fg-secondary">{artist.bio}</p>}

                      {artist.specialties.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {artist.specialties.slice(0, 4).map((specialty) => (
                            <span
                              key={specialty}
                              className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg-secondary"
                            >
                              {specialty}
                            </span>
                          ))}
                          {artist.specialties.length > 4 && (
                            <span className="inline-flex items-center px-1 text-xs text-fg-muted">
                              +{artist.specialties.length - 4} more
                            </span>
                          )}
                        </div>
                      )}

                      {artist.portfolioImages.length > 0 && (
                        <div className="mt-3 grid grid-cols-4 gap-1.5">
                          {artist.portfolioImages.slice(0, 4).map((url) => (
                            <div key={url} className="aspect-square overflow-hidden rounded-lg border border-border">
                              <img src={url} alt="" className="h-full w-full object-cover" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'permissions' && isOwner && (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-fg">Permissions</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  Choose what each role can do in your studio's portal. Owner always has full access.
                </p>
              </div>

              {permissionsMatrix && (
                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={permissionsSubmitting}
                  className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                >
                  {permissionsSubmitting ? 'Saving…' : 'Save changes'}
                </button>
              )}
            </div>

            {permissionsError && <p className="mt-4 text-sm text-danger">{permissionsError}</p>}

            {permissionsSuccess && <p className="mt-4 text-sm text-success">Permissions updated.</p>}

            {!permissionsError && !permissionsMatrix && (
              <p className="mt-4 text-sm text-fg-secondary">Loading permissions…</p>
            )}

            {permissionsMatrix && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className="pb-3 font-medium">Permission</th>
                      <th className="pb-3 text-center font-medium">Owner</th>
                      {CONFIGURABLE_ROLES.map((role) => (
                        <th key={role} className="pb-3 text-center font-medium">
                          {formatStatus(role)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {PERMISSION_GROUPS.map((group) => (
                      <Fragment key={group.label}>
                        <tr>
                          <td colSpan={5} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                            {group.label}
                          </td>
                        </tr>
                        {group.keys.map(({ key, label }) => (
                          <tr key={key}>
                            <td className="py-2 text-fg-secondary">{label}</td>
                            <td className="py-2 text-center">
                              <input type="checkbox" checked disabled className="h-4 w-4 rounded border-border accent-accent" />
                            </td>
                            {CONFIGURABLE_ROLES.map((role) => (
                              <td key={role} className="py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={permissionsMatrix[role]?.[key] ?? false}
                                  onChange={() => togglePermission(role, key)}
                                  className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <Modal title="Add team member" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddSubmit}>
            {addFormError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {addFormError}
              </div>
            )}

            <div className="mb-3 flex items-center gap-3">
              {addAvatarUrl ? (
                <img src={addAvatarUrl} alt="Profile picture preview" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border text-xs text-fg-muted">
                  No photo
                </div>
              )}
              <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface">
                {addAvatarUrl ? 'Change photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleAvatarFileChange(event, setAddAvatarUrl, setAddFormError)}
                  className="hidden"
                />
              </label>
              {addAvatarUrl && (
                <button
                  type="button"
                  onClick={() => setAddAvatarUrl(null)}
                  className="text-xs font-medium text-fg-secondary transition hover:text-fg"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mb-3">
              <label htmlFor="addName" className="mb-1 block text-sm font-medium text-fg-secondary">
                Name
              </label>
              <input
                id="addName"
                type="text"
                value={addForm.name}
                onChange={(event) => setAddForm({ ...addForm, name: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="addPhone" className="mb-1 block text-sm font-medium text-fg-secondary">
                Phone
              </label>
              <input
                id="addPhone"
                type="text"
                value={addForm.phone}
                onChange={(event) => setAddForm({ ...addForm, phone: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="addEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
                Email
              </label>
              <input
                id="addEmail"
                type="email"
                required
                value={addForm.email}
                onChange={(event) => setAddForm({ ...addForm, email: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="addPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                Temporary Password
              </label>
              <input
                id="addPassword"
                type="password"
                required
                value={addForm.password}
                onChange={(event) => setAddForm({ ...addForm, password: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="addRole" className="mb-1 block text-sm font-medium text-fg-secondary">
                Role
              </label>
              <select
                id="addRole"
                value={addForm.role}
                onChange={(event) => setAddForm({ ...addForm, role: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {formatStatus(role)}
                  </option>
                ))}
              </select>
              {addForm.role === 'ARTIST' && (
                <p className="mt-1 text-xs text-fg-muted">
                  This also creates their profile on the Artists tab — specialties and portfolio can be added there.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={addSubmitting}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {addSubmitting ? 'Adding…' : 'Add team member'}
            </button>
          </form>
        </Modal>
      )}

      {editingUser && (
        <Modal title={`Edit ${editingUser.name || editingUser.email}`} onClose={() => setEditingUser(null)}>
          <form onSubmit={handleEditSubmit}>
            {editFormError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {editFormError}
              </div>
            )}

            <div className="mb-3 flex items-center gap-3">
              {editAvatarUrl ? (
                <img src={editAvatarUrl} alt="Profile picture preview" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border text-xs text-fg-muted">
                  No photo
                </div>
              )}
              <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface">
                {editAvatarUrl ? 'Change photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleAvatarFileChange(event, setEditAvatarUrl, setEditFormError)}
                  className="hidden"
                />
              </label>
              {editAvatarUrl && (
                <button
                  type="button"
                  onClick={() => setEditAvatarUrl(null)}
                  className="text-xs font-medium text-fg-secondary transition hover:text-fg"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mb-3">
              <label htmlFor="editName" className="mb-1 block text-sm font-medium text-fg-secondary">
                Name
              </label>
              <input
                id="editName"
                type="text"
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="editPhone" className="mb-1 block text-sm font-medium text-fg-secondary">
                Phone
              </label>
              <input
                id="editPhone"
                type="text"
                value={editForm.phone}
                onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="editEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
                Email
              </label>
              <input
                id="editEmail"
                type="email"
                required
                value={editForm.email}
                onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="editRole" className="mb-1 block text-sm font-medium text-fg-secondary">
                Role
              </label>
              <select
                id="editRole"
                value={editForm.role}
                onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {formatStatus(role)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="flex items-center gap-2 text-sm font-medium text-fg-secondary">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })}
                  className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                />
                Active (can log in)
              </label>
            </div>

            <div className="mb-3">
              <label htmlFor="editLocation" className="mb-1 block text-sm font-medium text-fg-secondary">
                Location
              </label>
              <select
                id="editLocation"
                value={editForm.locationId}
                onChange={(event) => setEditForm({ ...editForm, locationId: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">No location assigned</option>
                {locations?.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-1">
              <label htmlFor="editNewPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                Reset password
              </label>
              <input
                id="editNewPassword"
                type="password"
                placeholder="Leave blank to keep current password"
                value={editForm.newPassword}
                onChange={(event) => setEditForm({ ...editForm, newPassword: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <button
              type="submit"
              disabled={editSubmitting}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {editSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}

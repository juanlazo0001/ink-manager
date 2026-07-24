import { Fragment, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import PhoneInput from '../components/PhoneInput'
import { SkeletonCards } from '../components/Skeleton'
import StatusPill from '../components/StatusPill'
import { apiFetch, ApiError } from '../lib/api'
import { formatStatus, isValidPhoneDigits, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { PERMISSION_GROUPS, CONFIGURABLE_ROLES } from '../lib/permissions'
import { artistsQueryKey } from '../lib/queryKeys'
import { useAuth } from '../context/useAuth'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useSocket } from '../context/useSocket'
import PresenceDot from '../components/PresenceDot'
import { PlusIcon, ViewIcon, InstagramIcon, FacebookIcon } from '../components/icons'

type PermissionMatrix = Record<string, Record<string, boolean>>
type TeamTab = 'staff' | 'artists' | 'permissions'

interface ArtistCard {
  id: string
  bio: string | null
  specialties: string[]
  portfolioImages: string[]
  instagramHandle: string | null
  facebookProfileUrl: string | null
  isGuest: boolean
  guestStartDate: string | null
  guestEndDate: string | null
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

interface StaffDeletePreview {
  isArtist: boolean
  artistAppointments: number
  artistAssignedInquiries: number
  giftCardsIssued: number
  inquiryNotes: number
  appointmentPhotos: number
  conversationTags: number
  personalTasksCreatedForOthers: number
  personalTasksOwn: number
  taskDismissals: number
  sectionSeens: number
  conversationReads: number
  conversationParticipants: number
  dismissedDuplicatePairs: number
  prefillDrafts: number
  importBatches: number
  isSelf: boolean
  isLastActiveOwner: boolean
  blockedByArtistHistory: boolean
}

const DELETE_CONFIRM_TEXT = 'DELETE'

interface LocationOption {
  id: string
  name: string
}

// CUSTOMER is not a real staff role -- no CUSTOMER-role user can ever
// authenticate into any staff route (confirmed during the View As
// permissions audit) -- so it's never offered here. It's intentionally
// still present in CONFIGURABLE_ROLES (lib/permissions.ts) for the
// separate Permissions-matrix tab, which is a distinct, deliberately
// unrelated system -- not touched by this.
//
// Staff/Artists split: the Staff tab's add/edit role selector only offers
// OWNER/FRONT_DESK -- ARTIST creation moved to its own "+ Add Artist" flow
// on the Artists tab, which locks role to ARTIST rather than showing a
// selector. Once created, this UI never lets a role be converted between
// the "staff" and "artist" categories (a deliberate simplification, not a
// backend restriction -- STAFF_ROLES on the API side still permits it via
// direct API access if ever genuinely needed operationally).
const STAFF_ROLE_OPTIONS = ['OWNER', 'FRONT_DESK']

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
  const { onlineUserIds } = useSocket()
  const queryClient = useQueryClient()
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

  function openAddStaff() {
    setAddForm(EMPTY_ADD_FORM)
    setAddAvatarUrl(null)
    setAddFormError(null)
    setShowAddModal(true)
  }

  const [editingUser, setEditingUser] = useState<TeamUser | null>(null)
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM)
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null)
  const [editFormError, setEditFormError] = useState<string | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [deletingUser, setDeletingUser] = useState<TeamUser | null>(null)
  const [deletePreview, setDeletePreview] = useState<StaffDeletePreview | null>(null)
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false)
  const [deletePreviewError, setDeletePreviewError] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [permissionsMatrix, setPermissionsMatrix] = useState<PermissionMatrix | null>(null)
  const [permissionsError, setPermissionsError] = useState<string | null>(null)
  const [permissionsSuccess, setPermissionsSuccess] = useState(false)
  const [permissionsSubmitting, setPermissionsSubmitting] = useState(false)

  const [locations, setLocations] = useState<LocationOption[] | null>(null)

  // Staff tab = OWNER/FRONT_DESK only -- artists appear exclusively on the
  // Artists tab now, even though `users` (the full roster fetch below)
  // still includes them, since the Artists tab's "Edit account"/"View as"
  // actions reuse this same data + the edit modal below.
  const staffUsers = users?.filter((u) => u.role === 'OWNER' || u.role === 'FRONT_DESK') ?? []

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

    if (!isValidPhoneDigits(addForm.phone)) {
      setAddFormError('Enter a complete 10-digit phone number.')
      return
    }

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

  async function openDeleteModal(teamUser: TeamUser) {
    if (!user?.studioId) return
    setDeletingUser(teamUser)
    setDeleteConfirmText('')
    setDeleteError(null)
    setDeletePreview(null)
    setDeletePreviewError(null)
    setDeletePreviewLoading(true)
    try {
      const preview = await apiFetch<StaffDeletePreview>(`/studios/${user.studioId}/users/${teamUser.id}/delete-preview`)
      setDeletePreview(preview)
    } catch (err) {
      setDeletePreviewError(err instanceof Error ? err.message : 'Failed to load what will be deleted')
    } finally {
      setDeletePreviewLoading(false)
    }
  }

  async function handleConfirmDelete() {
    if (!user?.studioId || !deletingUser) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(`/studios/${user.studioId}/users/${deletingUser.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: deleteConfirmText }),
      })
      setDeletingUser(null)
      setRefreshIndex((index) => index + 1)
      if (deletingUser.role === 'ARTIST') queryClient.invalidateQueries({ queryKey: artistsQueryKey(user.studioId) })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete team member')
    } finally {
      setDeleting(false)
    }
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

    if (!isValidPhoneDigits(editForm.phone)) {
      setEditFormError('Enter a complete 10-digit phone number.')
      return
    }

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
      if (editingUser.role === 'ARTIST') queryClient.invalidateQueries({ queryKey: artistsQueryKey(user.studioId) })
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

            {isOwner && activeTab === 'staff' && (
              <button
                type="button"
                onClick={openAddStaff}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                <PlusIcon className="h-4 w-4" />
                Add team member
              </button>
            )}

            {isOwner && activeTab === 'artists' && (
              <button
                type="button"
                onClick={() => navigate('/artists/new')}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                <PlusIcon className="h-4 w-4" />
                Add Artist
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
                    {staffUsers.map((teamUser) => {
                      const isSelf = teamUser.id === user?.userId
                      return (
                        <tr key={teamUser.id}>
                          <td className="py-3 text-fg">
                            <div className="flex items-center gap-2.5">
                              <div className="relative h-7 w-7 shrink-0">
                                {teamUser.avatarUrl ? (
                                  <img
                                    src={teamUser.avatarUrl}
                                    alt={teamUser.name ?? teamUser.email}
                                    className="h-7 w-7 rounded-full object-cover"
                                  />
                                ) : (
                                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-xs font-semibold text-fg">
                                    {(teamUser.name ?? teamUser.email).slice(0, 1).toUpperCase()}
                                  </span>
                                )}
                                <PresenceDot online={onlineUserIds.has(teamUser.id)} />
                              </div>
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
                              <button
                                type="button"
                                onClick={() => openDeleteModal(teamUser)}
                                disabled={isSelf}
                                title={isSelf ? "You can't delete your own account" : undefined}
                                className="rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Delete
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
                    {isOwner ? 'Use "Add Artist" above to add one.' : 'Ask a studio owner to add one.'}
                  </p>
                </div>
              )}

              {!artistsErrorMessage && artists && artists.length > 0 && (
                <div className="space-y-8">
                  {[
                    { label: 'Studio Artists', items: artists.filter((artist) => !artist.isGuest) },
                    { label: 'Guest Artists', items: artists.filter((artist) => artist.isGuest) },
                  ]
                    .filter((group) => group.items.length > 0)
                    .map((group) => (
                      <div key={group.label}>
                        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                          {group.label}
                        </h2>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {group.items.map((artist) => (
                            <div
                              key={artist.id}
                              onClick={() => navigate(`/artists/${artist.id}`)}
                              className="cursor-pointer rounded-2xl border border-border bg-surface p-5 transition hover:border-border-strong"
                            >
                      <div className="flex items-center gap-3">
                        <div className="relative h-12 w-12 shrink-0">
                          {artist.user.avatarUrl ? (
                            <img
                              src={artist.user.avatarUrl}
                              alt={artist.user.name ?? artist.user.email}
                              className="h-12 w-12 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-lg font-semibold text-fg">
                              {(artist.user.name ?? artist.user.email).slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <PresenceDot online={onlineUserIds.has(artist.user.id)} />
                        </div>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
                            <span className="truncate">{artist.user.name || artist.user.email}</span>
                            {artist.isGuest &&
                              (() => {
                                const ended = !!artist.guestEndDate && new Date(artist.guestEndDate) < new Date()
                                return (
                                  <span
                                    className={[
                                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                                      ended ? 'bg-surface-inset text-fg-muted' : 'bg-accent/10 text-accent',
                                    ].join(' ')}
                                  >
                                    {ended ? 'Guest (ended)' : 'Guest'}
                                  </span>
                                )
                              })()}
                          </p>
                          <p className="truncate text-xs text-fg-muted">{artist.user.email}</p>
                        </div>
                      </div>

                      {artist.bio && <p className="mt-3 line-clamp-2 text-sm text-fg-secondary">{artist.bio}</p>}

                      {(artist.instagramHandle || artist.facebookProfileUrl) && (
                        <div className="mt-3 flex items-center gap-2">
                          {artist.instagramHandle && (
                            <a
                              href={`https://instagram.com/${artist.instagramHandle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Instagram"
                              title="Instagram"
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                            >
                              <InstagramIcon className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {artist.facebookProfileUrl && (
                            <a
                              href={artist.facebookProfileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Facebook"
                              title="Facebook"
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                            >
                              <FacebookIcon className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      )}

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

                      {isOwner && (
                        <div className="mt-4 flex gap-2 border-t border-border pt-3">
                          {canUseViewAs && artist.user.id !== realUser?.userId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleViewAs(artist.user.id)
                              }}
                              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                            >
                              <ViewIcon className="h-3.5 w-3.5" />
                              View as
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const teamUser = users?.find((u) => u.id === artist.user.id)
                              if (teamUser) openEdit(teamUser)
                            }}
                            disabled={!users?.some((u) => u.id === artist.user.id)}
                            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Edit account
                          </button>
                          {artist.user.id !== realUser?.userId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                const teamUser = users?.find((u) => u.id === artist.user.id)
                                if (teamUser) openDeleteModal(teamUser)
                              }}
                              disabled={!users?.some((u) => u.id === artist.user.id)}
                              className="rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                            </div>
                          ))}
                        </div>
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
              <PhoneInput
                id="addPhone"
                value={addForm.phone}
                onChange={(digits) => setAddForm({ ...addForm, phone: digits })}
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
                {STAFF_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {formatStatus(role)}
                  </option>
                ))}
              </select>
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
              <PhoneInput
                id="editPhone"
                value={editForm.phone}
                onChange={(digits) => setEditForm({ ...editForm, phone: digits })}
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
              <label className="mb-1 block text-sm font-medium text-fg-secondary">Role</label>
              {editingUser.role === 'ARTIST' ? (
                <p className="rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg-secondary">
                  Artist — role isn't changed from here
                </p>
              ) : (
                <select
                  id="editRole"
                  value={editForm.role}
                  onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {STAFF_ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {formatStatus(role)}
                    </option>
                  ))}
                </select>
              )}
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

      {deletingUser && (
        <Modal
          title={`Delete ${deletingUser.name || deletingUser.email}`}
          onClose={() => {
            setDeletingUser(null)
            setDeletePreview(null)
            setDeletePreviewError(null)
            setDeleteError(null)
          }}
        >
          <p className="text-sm text-fg-secondary">
            Permanently delete <span className="font-semibold">{deletingUser.name || deletingUser.email}</span>?
            This cannot be undone.
          </p>

          {deletePreviewLoading && <p className="mt-4 text-sm text-fg-secondary">Checking what will be affected…</p>}
          {deletePreviewError && <p className="mt-3 text-sm text-danger">{deletePreviewError}</p>}

          {deletePreview && deletePreview.isLastActiveOwner && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              This studio must have at least one active owner. Make another user an owner first, or deactivate this
              account instead once that's done.
            </div>
          )}

          {deletePreview && !deletePreview.isLastActiveOwner && deletePreview.blockedByArtistHistory && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              This artist has {deletePreview.artistAppointments} appointment
              {deletePreview.artistAppointments === 1 ? '' : 's'} and {deletePreview.artistAssignedInquiries} assigned
              or preferred inquir{deletePreview.artistAssignedInquiries === 1 ? 'y' : 'ies'} — deleting their full
              history isn't supported here. Deactivate their account instead (Edit → uncheck "Active").
            </div>
          )}

          {deletePreview && !deletePreview.isLastActiveOwner && !deletePreview.blockedByArtistHistory && (
            <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
                This will permanently remove
              </p>
              <ul className="space-y-1 text-fg-secondary">
                <li>The account itself, and its Artist profile{deletePreview.isArtist ? '' : ' (n/a)'}</li>
                <li>
                  {deletePreview.personalTasksOwn} of their own personal task
                  {deletePreview.personalTasksOwn === 1 ? '' : 's'}
                </li>
                <li>
                  {deletePreview.taskDismissals + deletePreview.sectionSeens + deletePreview.conversationReads}{' '}
                  read-receipt / dismissal record{deletePreview.taskDismissals + deletePreview.sectionSeens + deletePreview.conversationReads === 1 ? '' : 's'}
                </li>
              </ul>
              {(deletePreview.giftCardsIssued > 0 ||
                deletePreview.inquiryNotes > 0 ||
                deletePreview.appointmentPhotos > 0 ||
                deletePreview.personalTasksCreatedForOthers > 0) && (
                <>
                  <p className="mb-2 mt-3 text-xs font-medium uppercase tracking-wider text-fg-muted">
                    Preserved (just loses the author link)
                  </p>
                  <ul className="space-y-1 text-fg-secondary">
                    {deletePreview.giftCardsIssued > 0 && (
                      <li>
                        {deletePreview.giftCardsIssued} gift card{deletePreview.giftCardsIssued === 1 ? '' : 's'} issued
                      </li>
                    )}
                    {deletePreview.inquiryNotes > 0 && (
                      <li>
                        {deletePreview.inquiryNotes} inquiry note{deletePreview.inquiryNotes === 1 ? '' : 's'}
                      </li>
                    )}
                    {deletePreview.appointmentPhotos > 0 && (
                      <li>
                        {deletePreview.appointmentPhotos} appointment photo{deletePreview.appointmentPhotos === 1 ? '' : 's'}{' '}
                        uploaded
                      </li>
                    )}
                    {deletePreview.personalTasksCreatedForOthers > 0 && (
                      <li>
                        {deletePreview.personalTasksCreatedForOthers} task
                        {deletePreview.personalTasksCreatedForOthers === 1 ? '' : 's'} created for a teammate
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {deletePreview && !deletePreview.isLastActiveOwner && !deletePreview.blockedByArtistHistory && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-fg-secondary">
                Type <span className="font-mono font-semibold text-fg">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger"
              />
            </div>
          )}

          {deleteError && <p className="mt-3 text-sm text-danger">{deleteError}</p>}

          {deletePreview && !deletePreview.isLastActiveOwner && !deletePreview.blockedByArtistHistory && (
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting || deleteConfirmText !== DELETE_CONFIRM_TEXT}
              className="mt-5 w-full rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Permanently'}
            </button>
          )}
        </Modal>
      )}
    </div>
  )
}

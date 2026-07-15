import { Fragment, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { apiFetch } from '../lib/api'
import { formatStatus, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { PERMISSION_GROUPS, CONFIGURABLE_ROLES } from '../lib/permissions'
import { useAuth } from '../context/useAuth'
import { PlusIcon } from '../components/icons'

type PermissionMatrix = Record<string, Record<string, boolean>>

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
  artist?: { bio: string | null; specialties: string[] }
}

const ROLE_OPTIONS = ['OWNER', 'FRONT_DESK', 'ARTIST', 'CUSTOMER']

const EMPTY_ADD_FORM = { email: '', password: '', role: 'FRONT_DESK' }

const EMPTY_EDIT_FORM = { name: '', phone: '', email: '', role: 'FRONT_DESK', isActive: true, newPassword: '' }

function emptyEditForm(teamUser: TeamUser) {
  return {
    name: teamUser.name ?? '',
    phone: teamUser.phone ?? '',
    email: teamUser.email,
    role: teamUser.role,
    isActive: teamUser.isActive,
    newPassword: '',
  }
}

export default function Team() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'

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

  if (!isOwner) {
    return (
      <div className="flex min-h-screen bg-neutral-900 text-white">
        <Sidebar />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
            <h1 className="text-2xl font-bold text-white sm:text-3xl">Team</h1>
            <p className="mt-4 text-sm text-neutral-400">Only the studio owner can manage the team.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Team</h1>
              <p className="mt-1 text-sm text-neutral-400">Everyone with access to your studio's portal.</p>
            </div>

            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
            >
              <PlusIcon className="h-4 w-4" />
              Add team member
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {error && <p className="text-sm text-red-400">{error}</p>}

            {!error && users === null && <p className="text-sm text-neutral-400">Loading team…</p>}

            {!error && users !== null && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500">
                      <th className="pb-3 font-medium">Name</th>
                      <th className="pb-3 font-medium">Email</th>
                      <th className="pb-3 font-medium">Role</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {users.map((teamUser) => {
                      const isSelf = teamUser.id === user?.userId
                      return (
                        <tr key={teamUser.id}>
                          <td className="py-3 text-white">
                            <div className="flex items-center gap-2.5">
                              {teamUser.avatarUrl ? (
                                <img
                                  src={teamUser.avatarUrl}
                                  alt={teamUser.name ?? teamUser.email}
                                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                                />
                              ) : (
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-white">
                                  {(teamUser.name ?? teamUser.email).slice(0, 1).toUpperCase()}
                                </span>
                              )}
                              {teamUser.name || '—'}
                            </div>
                          </td>
                          <td className="py-3 text-neutral-400">{teamUser.email}</td>
                          <td className="py-3 text-neutral-400">{formatStatus(teamUser.role)}</td>
                          <td className="py-3">
                            <span className={teamUser.isActive ? 'text-green-400' : 'text-neutral-500'}>
                              {teamUser.isActive ? 'Active' : 'Deactivated'}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={() => openEdit(teamUser)}
                              disabled={isSelf}
                              title={isSelf ? 'Edit your own account from your profile' : undefined}
                              className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Permissions</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Choose what each role can do in your studio's portal. Owner always has full access.
                </p>
              </div>

              {permissionsMatrix && (
                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={permissionsSubmitting}
                  className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                >
                  {permissionsSubmitting ? 'Saving…' : 'Save changes'}
                </button>
              )}
            </div>

            {permissionsError && <p className="mt-4 text-sm text-red-400">{permissionsError}</p>}

            {permissionsSuccess && <p className="mt-4 text-sm text-green-400">Permissions updated.</p>}

            {!permissionsError && !permissionsMatrix && (
              <p className="mt-4 text-sm text-neutral-400">Loading permissions…</p>
            )}

            {permissionsMatrix && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500">
                      <th className="pb-3 font-medium">Permission</th>
                      <th className="pb-3 text-center font-medium">Owner</th>
                      {CONFIGURABLE_ROLES.map((role) => (
                        <th key={role} className="pb-3 text-center font-medium">
                          {formatStatus(role)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {PERMISSION_GROUPS.map((group) => (
                      <Fragment key={group.label}>
                        <tr>
                          <td colSpan={5} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                            {group.label}
                          </td>
                        </tr>
                        {group.keys.map(({ key, label }) => (
                          <tr key={key}>
                            <td className="py-2 text-neutral-300">{label}</td>
                            <td className="py-2 text-center">
                              <input type="checkbox" checked disabled className="h-4 w-4 rounded border-neutral-700" />
                            </td>
                            {CONFIGURABLE_ROLES.map((role) => (
                              <td key={role} className="py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={permissionsMatrix[role]?.[key] ?? false}
                                  onChange={() => togglePermission(role, key)}
                                  className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
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
        </div>
      </div>

      {showAddModal && (
        <Modal title="Add team member" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddSubmit}>
            {addFormError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {addFormError}
              </div>
            )}

            <div className="mb-3 flex items-center gap-3">
              {addAvatarUrl ? (
                <img src={addAvatarUrl} alt="Profile picture preview" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 text-xs text-neutral-500">
                  No photo
                </div>
              )}
              <label className="cursor-pointer rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800">
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
                  className="text-xs font-medium text-neutral-400 transition hover:text-white"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mb-3">
              <label htmlFor="addEmail" className="mb-1 block text-sm font-medium text-neutral-300">
                Email
              </label>
              <input
                id="addEmail"
                type="email"
                required
                value={addForm.email}
                onChange={(event) => setAddForm({ ...addForm, email: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="addPassword" className="mb-1 block text-sm font-medium text-neutral-300">
                Temporary Password
              </label>
              <input
                id="addPassword"
                type="password"
                required
                value={addForm.password}
                onChange={(event) => setAddForm({ ...addForm, password: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div>
              <label htmlFor="addRole" className="mb-1 block text-sm font-medium text-neutral-300">
                Role
              </label>
              <select
                id="addRole"
                value={addForm.role}
                onChange={(event) => setAddForm({ ...addForm, role: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {formatStatus(role)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={addSubmitting}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
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
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {editFormError}
              </div>
            )}

            <div className="mb-3 flex items-center gap-3">
              {editAvatarUrl ? (
                <img src={editAvatarUrl} alt="Profile picture preview" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 text-xs text-neutral-500">
                  No photo
                </div>
              )}
              <label className="cursor-pointer rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800">
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
                  className="text-xs font-medium text-neutral-400 transition hover:text-white"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mb-3">
              <label htmlFor="editName" className="mb-1 block text-sm font-medium text-neutral-300">
                Name
              </label>
              <input
                id="editName"
                type="text"
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="editPhone" className="mb-1 block text-sm font-medium text-neutral-300">
                Phone
              </label>
              <input
                id="editPhone"
                type="text"
                value={editForm.phone}
                onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="editEmail" className="mb-1 block text-sm font-medium text-neutral-300">
                Email
              </label>
              <input
                id="editEmail"
                type="email"
                required
                value={editForm.email}
                onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="editRole" className="mb-1 block text-sm font-medium text-neutral-300">
                Role
              </label>
              <select
                id="editRole"
                value={editForm.role}
                onChange={(event) => setEditForm({ ...editForm, role: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {formatStatus(role)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(event) => setEditForm({ ...editForm, isActive: event.target.checked })}
                  className="h-4 w-4 rounded border-neutral-700 bg-neutral-900"
                />
                Active (can log in)
              </label>
            </div>

            <div className="mb-1">
              <label htmlFor="editNewPassword" className="mb-1 block text-sm font-medium text-neutral-300">
                Reset password
              </label>
              <input
                id="editNewPassword"
                type="password"
                placeholder="Leave blank to keep current password"
                value={editForm.newPassword}
                onChange={(event) => setEditForm({ ...editForm, newPassword: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <button
              type="submit"
              disabled={editSubmitting}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {editSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}

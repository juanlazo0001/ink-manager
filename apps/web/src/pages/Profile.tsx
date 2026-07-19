import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import Sidebar from '../components/Sidebar'
import PhoneInput from '../components/PhoneInput'
import { apiFetch } from '../lib/api'
import { formatPhoneInput, isValidPhoneDigits, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'

const EMPTY_FORM = { name: '', phone: '', email: '', bio: '', specialties: '' }

export default function Profile() {
  const { profile, loading, refresh } = useUserProfile()
  const isArtist = profile?.role === 'ARTIST'

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        email: profile.email,
        bio: profile.artist?.bio ?? '',
        specialties: profile.artist?.specialties.join(', ') ?? '',
      })
      setAvatarUrl(profile.avatarUrl)
    }
  }, [profile])

  function resetPasswordFields() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
  }

  function handleEdit() {
    setError(null)
    setSuccess(false)
    setEditing(true)
  }

  function handleCancel() {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        email: profile.email,
        bio: profile.artist?.bio ?? '',
        specialties: profile.artist?.specialties.join(', ') ?? '',
      })
      setAvatarUrl(profile.avatarUrl)
    }
    resetPasswordFields()
    setError(null)
    setEditing(false)
  }

  function updateField(field: 'name' | 'phone' | 'email' | 'bio' | 'specialties') {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setSuccess(false)

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setError('Profile picture must be under 5MB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setAvatarUrl(dataUrl)
    } catch {
      setError('Could not read that image. Please try a different file.')
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile) return

    setError(null)
    setSuccess(false)

    if (!isValidPhoneDigits(form.phone)) {
      setError('Enter a complete 10-digit phone number.')
      return
    }

    const emailChanged = form.email.trim() !== profile.email
    const changingPassword = newPassword.length > 0

    if (changingPassword) {
      if (newPassword.length < 8) {
        setError('New password must be at least 8 characters.')
        return
      }
      if (newPassword !== confirmNewPassword) {
        setError('New password and confirmation do not match.')
        return
      }
    }

    if ((emailChanged || changingPassword) && currentPassword.length === 0) {
      setError('Enter your current password to change your email or set a new password.')
      return
    }

    setSubmitting(true)

    const payload: Record<string, unknown> = {
      name: form.name,
      phone: form.phone,
      email: form.email,
      avatarUrl,
    }

    if (emailChanged || changingPassword) {
      payload.currentPassword = currentPassword
    }
    if (changingPassword) {
      payload.newPassword = newPassword
    }
    if (isArtist) {
      payload.bio = form.bio
      payload.specialties = form.specialties
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }

    try {
      await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify(payload) })
      await refresh()
      resetPasswordFields()
      setSuccess(true)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
          <h1 className="text-2xl font-bold text-fg sm:text-3xl">My profile</h1>
          <p className="mt-1 text-sm text-fg-secondary">Manage your account details and login.</p>

          <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
            {loading && !profile && <p className="text-sm text-fg-secondary">Loading profile…</p>}

            {!loading && !profile && <p className="text-sm text-danger">Could not load your profile.</p>}

            {success && (
              <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                Profile updated.
              </div>
            )}

            {profile && !editing && (
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    {profile.avatarUrl ? (
                      <img
                        src={profile.avatarUrl}
                        alt={profile.name ?? profile.email}
                        className="h-14 w-14 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border text-sm font-semibold text-fg-secondary">
                        {(profile.name ?? profile.email).slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-fg">{profile.name || 'Unnamed user'}</p>
                      <p className="mt-1 text-xs text-fg-secondary">{profile.email}</p>
                      {profile.phone && (
                        <p className="mt-1 text-xs text-fg-secondary">{formatPhoneInput(profile.phone)}</p>
                      )}
                      <p className="mt-1 text-xs text-fg-muted">{profile.role}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleEdit}
                    className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                  >
                    Edit
                  </button>
                </div>

                {isArtist && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Artist details</p>
                    <p className="mt-2 text-sm text-fg-secondary">{profile.artist?.bio || 'No bio yet.'}</p>
                    {profile.artist && profile.artist.specialties.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {profile.artist.specialties.map((specialty) => (
                          <span
                            key={specialty}
                            className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg-secondary"
                          >
                            {specialty}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {profile && editing && (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </div>
                )}

                <div className="mb-5 flex items-center gap-4">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile picture preview" className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-xs text-fg-muted">
                      No photo
                    </div>
                  )}

                  <label className="cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface">
                    {avatarUrl ? 'Change photo' : 'Upload photo'}
                    <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                  </label>

                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl(null)}
                      className="text-sm font-medium text-fg-secondary transition hover:text-fg"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="mb-5">
                  <label htmlFor="profileName" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Name
                  </label>
                  <input
                    id="profileName"
                    type="text"
                    value={form.name}
                    onChange={updateField('name')}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-5">
                  <label htmlFor="profilePhone" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Phone
                  </label>
                  <PhoneInput
                    id="profilePhone"
                    value={form.phone}
                    onChange={(digits) => setForm((current) => ({ ...current, phone: digits }))}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                {isArtist && (
                  <>
                    <div className="mb-5">
                      <label htmlFor="profileBio" className="mb-1 block text-sm font-medium text-fg-secondary">
                        Bio
                      </label>
                      <textarea
                        id="profileBio"
                        rows={3}
                        value={form.bio}
                        onChange={updateField('bio')}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    <div className="mb-5">
                      <label htmlFor="profileSpecialties" className="mb-1 block text-sm font-medium text-fg-secondary">
                        Specialties
                      </label>
                      <input
                        id="profileSpecialties"
                        type="text"
                        placeholder="e.g. Blackwork, Fine line, Realism"
                        value={form.specialties}
                        onChange={updateField('specialties')}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <p className="mt-1 text-xs text-fg-muted">Comma-separated.</p>
                    </div>
                  </>
                )}

                <div className="mb-2 border-t border-border pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Login &amp; security</p>
                </div>

                <div className="mb-5">
                  <label htmlFor="profileEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Email (used to sign in)
                  </label>
                  <input
                    id="profileEmail"
                    type="email"
                    required
                    value={form.email}
                    onChange={updateField('email')}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="profileNewPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                      New password
                    </label>
                    <input
                      id="profileNewPassword"
                      type="password"
                      placeholder="Leave blank to keep current"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div>
                    <label htmlFor="profileConfirmPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                      Confirm new password
                    </label>
                    <input
                      id="profileConfirmPassword"
                      type="password"
                      value={confirmNewPassword}
                      onChange={(event) => setConfirmNewPassword(event.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>

                <div className="mb-5">
                  <label htmlFor="profileCurrentPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Current password
                  </label>
                  <input
                    id="profileCurrentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="mt-1 text-xs text-fg-muted">
                    Required only if you change your email or set a new password.
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={submitting}
                    className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

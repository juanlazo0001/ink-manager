import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import Sidebar from '../components/Sidebar'
import PhoneInput from '../components/PhoneInput'
import { apiFetch } from '../lib/api'
import { formatPhoneInput, isValidPhoneDigits, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'

const EMPTY_FORM = { name: '', phone: '', bio: '', specialties: '' }

export default function Profile() {
  const { profile, loading, refresh } = useUserProfile()
  const { logout } = useAuth()
  const isArtist = profile?.role === 'ARTIST'

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Change email -- a separate, confirmation-gated flow (POST
  // /auth/change-email). The account keeps signing in with the OLD email
  // until the link sent to the new one is clicked, so this form never
  // touches `profile.email` itself, only shows `profile.pendingEmail` if
  // one is already in flight.
  const [changingEmail, setChangingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)
  const [emailSubmitting, setEmailSubmitting] = useState(false)

  // Change password -- separate from the forgot-password recovery flow
  // (that one doesn't require knowing the current password; this one
  // does, since the user is already signed in).
  const [changingPassword, setChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        bio: profile.artist?.bio ?? '',
        specialties: profile.artist?.specialties.join(', ') ?? '',
      })
      setAvatarUrl(profile.avatarUrl)
    }
  }, [profile])

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
        bio: profile.artist?.bio ?? '',
        specialties: profile.artist?.specialties.join(', ') ?? '',
      })
      setAvatarUrl(profile.avatarUrl)
    }
    setError(null)
    setEditing(false)
  }

  function updateField(field: 'name' | 'phone' | 'bio' | 'specialties') {
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

    setSubmitting(true)

    const payload: Record<string, unknown> = {
      name: form.name,
      phone: form.phone,
      avatarUrl,
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
      setSuccess(true)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setSubmitting(false)
    }
  }

  function openChangeEmail() {
    setNewEmail('')
    setEmailCurrentPassword('')
    setEmailError(null)
    setEmailSuccess(null)
    setChangingEmail(true)
  }

  async function handleChangeEmailSubmit(event: FormEvent) {
    event.preventDefault()
    setEmailError(null)

    setEmailSubmitting(true)
    try {
      await apiFetch('/auth/change-email', {
        method: 'POST',
        body: JSON.stringify({ newEmail, currentPassword: emailCurrentPassword }),
      })
      await refresh()
      setEmailSuccess(`Check ${newEmail} for a link to confirm the change. You'll keep signing in with your current email until then.`)
      setNewEmail('')
      setEmailCurrentPassword('')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to start email change')
    } finally {
      setEmailSubmitting(false)
    }
  }

  function openChangePassword() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
    setPasswordError(null)
    setChangingPassword(true)
  }

  async function handleChangePasswordSubmit(event: FormEvent) {
    event.preventDefault()
    setPasswordError(null)

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New password and confirmation do not match.')
      return
    }

    setPasswordSubmitting(true)
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      // The API invalidates every session (including this one) as of now
      // -- this tab's own token would 401 on its very next request, so
      // sign out immediately rather than leaving a stale "success" screen
      // the user can't actually do anything from.
      logout()
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password')
      setPasswordSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
          <h1 className="text-2xl font-bold text-fg sm:text-3xl">My profile</h1>
          <p className="mt-1 text-sm text-fg-secondary">Manage your account details and login.</p>

          <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
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

          {profile && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Login &amp; security</p>

              <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-fg">Email</p>
                    <p className="mt-1 text-xs text-fg-secondary">{profile.email}</p>
                    {profile.pendingEmail && (
                      <p className="mt-1 text-xs text-warning">
                        Change to {profile.pendingEmail} pending — check that inbox for a confirmation link.
                      </p>
                    )}
                  </div>
                  {!changingEmail && (
                    <button
                      type="button"
                      onClick={openChangeEmail}
                      className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      Change
                    </button>
                  )}
                </div>

                {emailSuccess && !changingEmail && (
                  <div className="mt-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                    {emailSuccess}
                  </div>
                )}

                {changingEmail && (
                  <form onSubmit={handleChangeEmailSubmit} className="mt-3">
                    {emailError && (
                      <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {emailError}
                      </div>
                    )}

                    <div className="mb-3">
                      <label htmlFor="newEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
                        New email
                      </label>
                      <input
                        id="newEmail"
                        type="email"
                        required
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    <div className="mb-3">
                      <label htmlFor="emailCurrentPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                        Current password
                      </label>
                      <input
                        id="emailCurrentPassword"
                        type="password"
                        required
                        value={emailCurrentPassword}
                        onChange={(event) => setEmailCurrentPassword(event.target.value)}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={emailSubmitting}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {emailSubmitting ? 'Sending…' : 'Send confirmation link'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChangingEmail(false)}
                        disabled={emailSubmitting}
                        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-fg">Password</p>
                    <p className="mt-1 text-xs text-fg-secondary">••••••••</p>
                  </div>
                  {!changingPassword && (
                    <button
                      type="button"
                      onClick={openChangePassword}
                      className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      Change
                    </button>
                  )}
                </div>

                {changingPassword && (
                  <form onSubmit={handleChangePasswordSubmit} className="mt-3">
                    {passwordError && (
                      <div className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {passwordError}
                      </div>
                    )}

                    <div className="mb-3">
                      <label htmlFor="currentPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                        Current password
                      </label>
                      <input
                        id="currentPassword"
                        type="password"
                        required
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    <div className="mb-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                          New password
                        </label>
                        <input
                          id="newPassword"
                          type="password"
                          required
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label htmlFor="confirmNewPassword" className="mb-1 block text-sm font-medium text-fg-secondary">
                          Confirm new password
                        </label>
                        <input
                          id="confirmNewPassword"
                          type="password"
                          required
                          value={confirmNewPassword}
                          onChange={(event) => setConfirmNewPassword(event.target.value)}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={passwordSubmitting}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {passwordSubmitting ? 'Saving…' : 'Change password'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChangingPassword(false)}
                        disabled={passwordSubmitting}
                        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

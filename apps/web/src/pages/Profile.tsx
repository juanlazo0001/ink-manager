import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PhoneInput from '../components/PhoneInput'
import Modal from '../components/Modal'
import { apiFetch } from '../lib/api'
import { formatPhoneInput, isValidPhoneDigits, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'
import { SparkleIcon, CloseIcon } from '../components/icons'

const DELETE_ACCOUNT_CONFIRM_TEXT = 'DELETE'

const EMPTY_FORM = { name: '', phone: '' }

export default function Profile() {
  const { profile, loading, refresh } = useUserProfile()
  const { logout, setSession } = useAuth()
  const navigate = useNavigate()
  // Not role === 'ARTIST' -- a solo studio's OWNER can also hold an Artist
  // profile (see soloStudio.ts), and that user's own artist details/
  // self-scheduling widgets below need to render for them too.
  const isArtist = Boolean(profile?.artist)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Part 2 (guest-artist onboarding): the nudge below already fades away
  // on its own once bio/specialties are filled in (no "new account" flag
  // needed -- an empty profile IS the signal), but a deliberate dismiss is
  // still offered since "encouraging, not nagging" means letting someone
  // opt out even if they genuinely don't want to fill it in yet. Scoped
  // per-user (not just per-browser) so a shared/reset browser doesn't
  // resurface it for someone who already dismissed it, and so it doesn't
  // leak across accounts on a shared machine either.
  const [profileNudgeDismissed, setProfileNudgeDismissed] = useState(false)
  useEffect(() => {
    if (!profile) return
    setProfileNudgeDismissed(localStorage.getItem(`ink-manager:profile-nudge-dismissed:${profile.id}`) === '1')
  }, [profile?.id])
  function dismissProfileNudge() {
    if (!profile) return
    localStorage.setItem(`ink-manager:profile-nudge-dismissed:${profile.id}`, '1')
    setProfileNudgeDismissed(true)
  }

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

  // Solo artist architecture, Phase 3: toggling this hits the new
  // dedicated PATCH /artists/:id/self-scheduling (self+solo scoped),
  // never the generic artists.manage-gated PATCH /artists/:id -- an
  // artist here is never editing anything BUT their own record.
  const [selfSchedulingSubmitting, setSelfSchedulingSubmitting] = useState(false)
  const [selfSchedulingError, setSelfSchedulingError] = useState<string | null>(null)

  // Solo artist architecture, Phase 4: artist-controlled, full stop -- no
  // staff bypass exists on the backend route this hits (PATCH /artists/
  // :id/profile-delegation), unlike self-scheduling above. Universal, not
  // solo-gated -- any artist, in any studio, controls whether staff can
  // edit their shared profile fields on their behalf.
  const [profileDelegationSubmitting, setProfileDelegationSubmitting] = useState(false)
  const [profileDelegationError, setProfileDelegationError] = useState<string | null>(null)

  // Per-guest-studio counterpart to the toggle above -- hits PATCH
  // /artists/:id/memberships/:membershipId/profile-delegation, targeting a
  // specific StudioMembership id rather than the artist's own current
  // session studio (which the route above is hardcoded to). One
  // submitting/error slot, keyed by membership id, since only one row is
  // ever being toggled at a time.
  const [guestDelegationSubmittingId, setGuestDelegationSubmittingId] = useState<string | null>(null)
  const [guestDelegationError, setGuestDelegationError] = useState<string | null>(null)

  // Artist mobility, Part 1: hits POST /artists/:id/go-solo, self-only, no
  // staff bypass -- same shape as profile-delegation above. Success returns
  // a fresh JWT (studioId/role changed, so the old one is stale -- see that
  // route's own comment) that must go through setSession, not a raw write,
  // for the same reason InviteAccept.tsx already does this.
  const [goingSolo, setGoingSolo] = useState(false)
  const [goSoloStudioName, setGoSoloStudioName] = useState('')
  const [goSoloError, setGoSoloError] = useState<string | null>(null)
  const [goSoloSubmitting, setGoSoloSubmitting] = useState(false)

  // Part 3: artist self-deletion. POST /users/me/delete-account,
  // requireRole(ARTIST), self only. Success has no fresh JWT to switch to
  // -- the account can't authenticate at all anymore -- so this logs out
  // and bounces to /login directly, same terminal shape a deactivated
  // account's own 401 already produces elsewhere.
  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState('')
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null)
  const [deleteAccountSubmitting, setDeleteAccountSubmitting] = useState(false)

  useEffect(() => {
    if (profile) {
      setForm({ name: profile.name ?? '', phone: profile.phone ?? '' })
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
      setForm({ name: profile.name ?? '', phone: profile.phone ?? '' })
      setAvatarUrl(profile.avatarUrl)
    }
    setError(null)
    setEditing(false)
  }

  function updateField(field: 'name' | 'phone') {
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

  async function handleToggleSelfScheduling() {
    if (!profile?.artist) return
    setSelfSchedulingError(null)
    setSelfSchedulingSubmitting(true)
    try {
      await apiFetch(`/artists/${profile.artist.id}/self-scheduling`, {
        method: 'PATCH',
        body: JSON.stringify({ allowsClientSelfScheduling: !profile.artist.allowsClientSelfScheduling }),
      })
      await refresh()
    } catch (err) {
      setSelfSchedulingError(err instanceof Error ? err.message : 'Failed to update self-scheduling')
    } finally {
      setSelfSchedulingSubmitting(false)
    }
  }

  async function handleToggleProfileDelegation() {
    if (!profile?.artist) return
    const current = profile.artist.memberships[0]?.allowsStudioProfileEdits ?? false
    setProfileDelegationError(null)
    setProfileDelegationSubmitting(true)
    try {
      await apiFetch(`/artists/${profile.artist.id}/profile-delegation`, {
        method: 'PATCH',
        body: JSON.stringify({ allowsStudioProfileEdits: !current }),
      })
      await refresh()
    } catch (err) {
      setProfileDelegationError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setProfileDelegationSubmitting(false)
    }
  }

  async function handleToggleGuestDelegation(membershipId: string, current: boolean) {
    if (!profile?.artist) return
    setGuestDelegationError(null)
    setGuestDelegationSubmittingId(membershipId)
    try {
      await apiFetch(`/artists/${profile.artist.id}/memberships/${membershipId}/profile-delegation`, {
        method: 'PATCH',
        body: JSON.stringify({ allowsStudioProfileEdits: !current }),
      })
      await refresh()
    } catch (err) {
      setGuestDelegationError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setGuestDelegationSubmittingId(null)
    }
  }

  async function handleGoSoloSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile?.artist) return
    setGoSoloError(null)
    setGoSoloSubmitting(true)
    try {
      const result = await apiFetch<{ token: string }>(`/artists/${profile.artist.id}/go-solo`, {
        method: 'POST',
        body: JSON.stringify({ studioName: goSoloStudioName.trim() }),
      })
      setSession(result.token)
      await refresh()
      setGoingSolo(false)
      setGoSoloStudioName('')
      navigate('/profile')
    } catch (err) {
      setGoSoloError(err instanceof Error ? err.message : 'Failed to go solo')
    } finally {
      setGoSoloSubmitting(false)
    }
  }

  function openDeleteAccount() {
    setDeleteAccountConfirmText('')
    setDeleteAccountError(null)
    setShowDeleteAccount(true)
  }

  async function handleDeleteAccountSubmit(event: FormEvent) {
    event.preventDefault()
    if (deleteAccountConfirmText !== DELETE_ACCOUNT_CONFIRM_TEXT) return

    setDeleteAccountError(null)
    setDeleteAccountSubmitting(true)
    try {
      await apiFetch('/users/me/delete-account', {
        method: 'POST',
        body: JSON.stringify({ confirm: deleteAccountConfirmText }),
      })
      // No fresh token to switch to -- the account can no longer
      // authenticate at all. logout() clears the session; ProtectedRoute
      // reacts to that on its own next render and bounces to /login.
      logout()
    } catch (err) {
      setDeleteAccountError(err instanceof Error ? err.message : 'Failed to delete account')
      setDeleteAccountSubmitting(false)
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
    <>
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

          {profile && isArtist && profile.artist && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Client self-scheduling</p>

              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-fg">
                    Let clients pick their own appointment time
                  </p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    When on, a client who accepts your estimate can pick a time from your real availability
                    themselves, instead of waiting for you or the studio to schedule it. Their pick is always a
                    pending request — you still review and confirm it, same as any other booking.
                  </p>
                  {!profile.isSoloStudioArtist && (
                    <p className="mt-2 text-xs text-fg-muted">
                      This is managed by your studio — ask an owner to enable it for you in Team → Artists.
                    </p>
                  )}
                  {selfSchedulingError && <p className="mt-2 text-xs text-danger">{selfSchedulingError}</p>}
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={profile.artist.allowsClientSelfScheduling}
                  disabled={!profile.isSoloStudioArtist || selfSchedulingSubmitting}
                  onClick={handleToggleSelfScheduling}
                  className={[
                    'relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40',
                    profile.artist.allowsClientSelfScheduling ? 'bg-accent' : 'bg-surface-inset border border-border',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-0.5 h-5 w-5 rounded-full bg-bg transition',
                      profile.artist.allowsClientSelfScheduling ? 'left-[22px]' : 'left-0.5',
                    ].join(' ')}
                  />
                </button>
              </div>
            </div>
          )}

          {/* UI simplification pass: delegating profile access to "your
              studio" is nonsensical for a solo artist -- they and the
              studio are the same entity, so there's no separate staff to
              delegate to. Hidden entirely, not shown-disabled.

              Also requires a real HOME membership to exist
              (memberships.length > 0, filtered server-side to type: HOME).
              A guest-only artist (no HOME anywhere) still has a session
              studioId -- set at account creation and never meaningfully
              reassigned for a guest-first identity -- so without this
              check the toggle would render as if it applied to a real home
              studio that doesn't exist, and PATCH /artists/:id/profile-
              delegation's own upsert would silently create a fake HOME
              membership at whatever studio the session happens to point
              to. Real guest studios get their own toggle below instead. */}
          {profile && isArtist && profile.artist && !profile.isSoloStudio && profile.artist.memberships.length > 0 && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Studio profile access</p>

              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-fg">Let studio staff edit my profile</p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    When on, studio staff can edit your portfolio photos, flash gallery pieces, and bio on your
                    behalf. When off, those stay yours to edit alone — staff sees them, but can't change them. This
                    never grants access to your login, password, or your own scheduling settings (like client
                    self-scheduling above) — those are always yours only, regardless of this toggle.
                  </p>
                  {profileDelegationError && <p className="mt-2 text-xs text-danger">{profileDelegationError}</p>}
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={profile.artist.memberships[0]?.allowsStudioProfileEdits ?? false}
                  disabled={profileDelegationSubmitting}
                  onClick={handleToggleProfileDelegation}
                  className={[
                    'relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40',
                    profile.artist.memberships[0]?.allowsStudioProfileEdits ? 'bg-accent' : 'bg-surface-inset border border-border',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-0.5 h-5 w-5 rounded-full bg-bg transition',
                      profile.artist.memberships[0]?.allowsStudioProfileEdits ? 'left-[22px]' : 'left-0.5',
                    ].join(' ')}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Lets an artist see, from their own Profile, every studio
              they're currently a real active guest at -- previously there
              was no way to confirm this anywhere except a studio's own Team
              page. Each row gets its own delegation toggle, since the
              existing "Studio profile access" toggle above only ever
              reaches the artist's own current/HOME studio -- there was no
              way to grant a GUEST studio the same access before this. */}
          {profile && isArtist && profile.artist && profile.artist.guestMemberships.length > 0 && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Guest studios</p>
              <p className="mt-1 text-xs text-fg-secondary">
                Studios you're currently a guest artist at. Each has its own toggle for letting that studio's staff
                edit your portfolio photos, flash gallery pieces, and bio on your behalf -- same rules as your home
                studio above, never your login or scheduling settings.
              </p>

              {guestDelegationError && <p className="mt-2 text-xs text-danger">{guestDelegationError}</p>}

              <div className="mt-4 space-y-3">
                {profile.artist.guestMemberships.map((membership) => (
                  <div
                    key={membership.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-inset px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{membership.studio.name}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        Guest artist since {new Date(membership.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={membership.allowsStudioProfileEdits}
                      aria-label={`Let ${membership.studio.name} staff edit my profile`}
                      disabled={guestDelegationSubmittingId === membership.id}
                      onClick={() => handleToggleGuestDelegation(membership.id, membership.allowsStudioProfileEdits)}
                      className={[
                        'relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40',
                        membership.allowsStudioProfileEdits ? 'bg-accent' : 'bg-surface border border-border',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute top-0.5 h-5 w-5 rounded-full bg-bg transition',
                          membership.allowsStudioProfileEdits ? 'left-[22px]' : 'left-0.5',
                        ].join(' ')}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Part 2 (guest-artist onboarding): shown whenever an artist's
              profile is still genuinely empty (no bio, no specialties) --
              this naturally covers "first login after a fresh invite
              accept" without needing a separate stored flag, and just as
              naturally stops showing the moment either field has real
              content, dismiss or not. Encouraging, not a hard block: no
              blocking modal, no forced redirect loop, just a friendly
              nudge sitting above the card that does the actual editing. */}
          {profile &&
            isArtist &&
            profile.artist &&
            !profile.artist.bio &&
            profile.artist.specialties.length === 0 &&
            !profileNudgeDismissed && (
              <div className="mt-6 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-5">
                <SparkleIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-fg">Welcome! Let's set up your artist profile.</p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    A bio, specialties, and a few portfolio pieces help clients (and your studio) get to know your
                    work -- it only takes a couple of minutes, whenever you're ready.
                  </p>
                  <Link
                    to={`/artists/${profile.artist.id}`}
                    className="mt-3 inline-flex rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover"
                  >
                    Complete my profile
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={dismissProfileNudge}
                  aria-label="Dismiss"
                  className="shrink-0 rounded-full p-1.5 text-fg-muted transition hover:bg-surface hover:text-fg"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
            )}

          {/* The single place bio/specialties/portfolio/social links/rates/
              scheduling buffer/services offered/preferred schedule are all
              editable -- ArtistDetail.tsx now supports full self-edit
              regardless of studio permissions (requirePermissionOrSelfArtist,
              artists.ts), so this is universal, not solo-only. Previously
              Profile.tsx also had its own bio/specialties fields, which
              just duplicated this page for the same data -- removed, this
              is the one place now. */}
          {profile && isArtist && profile.artist && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Artist profile</p>
              <div className="mt-4 flex items-start justify-between gap-4">
                <p className="text-sm text-fg-secondary">
                  Manage your bio, specialties, portfolio, social links, rates, scheduling buffer, services offered,
                  and preferred schedule.
                </p>
                <Link
                  to={`/artists/${profile.artist.id}`}
                  className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                >
                  Manage
                </Link>
              </div>
            </div>
          )}

          {/* Hidden once already solo -- going solo again would abandon the
              studio they're the only member of (leaving it with zero active
              users) to create a near-identical new one, never a meaningful
              action once there's no one else left to leave. */}
          {profile && isArtist && profile.artist && !profile.isSoloStudio && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Go solo</p>

              <div className="mt-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">Start your own studio-of-one</p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    Creates a brand new studio with you as its owner and artist. Your bio, portfolio, rates, and
                    flash gallery all come with you. You'll leave your current studio — its past appointments,
                    clients, and history stay exactly as they are, untouched.
                  </p>
                  {goSoloError && <p className="mt-2 text-xs text-danger">{goSoloError}</p>}
                </div>
                {!goingSolo && (
                  <button
                    type="button"
                    onClick={() => setGoingSolo(true)}
                    className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                  >
                    Go solo
                  </button>
                )}
              </div>

              {goingSolo && (
                <form onSubmit={handleGoSoloSubmit} className="mt-4 border-t border-border pt-4">
                  <div className="mb-3">
                    <label htmlFor="goSoloStudioName" className="mb-1 block text-sm font-medium text-fg-secondary">
                      New studio name
                    </label>
                    <input
                      id="goSoloStudioName"
                      type="text"
                      required
                      value={goSoloStudioName}
                      onChange={(event) => setGoSoloStudioName(event.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={goSoloSubmitting || !goSoloStudioName.trim()}
                      className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {goSoloSubmitting ? 'Creating…' : 'Confirm — go solo'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGoingSolo(false)
                        setGoSoloError(null)
                      }}
                      disabled={goSoloSubmitting}
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

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

          {/* Part 3: artist self-deletion, extended to solo owner-artists --
              matches the backend's own isEligible check (ARTIST, or OWNER
              with isSoloStudioArtist true). Not plain isArtist: a non-solo
              OWNER who also holds an Artist profile still has colleagues
              depending on that studio, and deleting their own account isn't
              a flow this route (or this button) covers. */}
          {profile && (profile.role === 'ARTIST' || (profile.role === 'OWNER' && profile.isSoloStudioArtist)) && (
            <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-danger">Danger zone</p>
              <div className="mt-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">Delete my account</p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    Permanently deletes your login, email, and profile content (bio, portfolio, flash gallery) and
                    ends every studio membership you have. Your appointment and client history at every studio
                    you've worked with is preserved for their records -- it just won't be tied to your personal
                    account anymore. This cannot be undone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openDeleteAccount}
                  className="shrink-0 rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
                >
                  Delete account
                </button>
              </div>
            </div>
          )}
        </div>

      {showDeleteAccount && (
        <Modal title="Delete your account" onClose={() => (deleteAccountSubmitting ? null : setShowDeleteAccount(false))}>
          <form onSubmit={handleDeleteAccountSubmit}>
            <p className="text-sm text-fg-secondary">
              This permanently deletes your login credentials, email, and profile content, and ends every studio
              membership (home and guest) you currently have. <span className="font-semibold text-fg">This cannot be undone.</span>
            </p>

            <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">This will permanently remove</p>
              <ul className="space-y-1 text-fg-secondary">
                <li>Your login (email and password) -- you won't be able to sign in again</li>
                <li>Your bio, specialties, and portfolio</li>
                <li>Flash pieces with no booking history (pieces that have real requests are retired, not deleted)</li>
              </ul>
              <p className="mb-2 mt-3 text-xs font-medium uppercase tracking-wider text-fg-muted">Preserved for each studio's records</p>
              <ul className="space-y-1 text-fg-secondary">
                <li>Past appointments and client relationships</li>
                <li>Notes, gift cards, and other records you were involved in</li>
              </ul>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-fg-secondary">
                Type <span className="font-mono font-semibold text-fg">{DELETE_ACCOUNT_CONFIRM_TEXT}</span> to confirm
              </label>
              <input
                type="text"
                value={deleteAccountConfirmText}
                onChange={(event) => setDeleteAccountConfirmText(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger"
              />
            </div>

            {deleteAccountError && <p className="mt-3 text-sm text-danger">{deleteAccountError}</p>}

            <button
              type="submit"
              disabled={deleteAccountSubmitting || deleteAccountConfirmText !== DELETE_ACCOUNT_CONFIRM_TEXT}
              className="mt-5 w-full rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleteAccountSubmitting ? 'Deleting…' : 'Permanently delete my account'}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}

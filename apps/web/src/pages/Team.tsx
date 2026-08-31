import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Eyebrow from '../components/Eyebrow'
import Modal from '../components/Modal'
import PhoneInput from '../components/PhoneInput'
import { SkeletonCards } from '../components/Skeleton'
import StatusPill from '../components/StatusPill'
import { apiFetch, ApiError } from '../lib/api'
import { formatStatus, isValidPhoneDigits, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { artistsQueryKey, artistInvitesQueryKey } from '../lib/queryKeys'
import TransfersPanel from '../components/TransfersPanel'
import { useAuth } from '../context/useAuth'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import { useViewAs } from '../context/useViewAs'
import { useSocket } from '../context/useSocket'
import PresenceDot from '../components/PresenceDot'
import { PlusIcon, ViewIcon, InstagramIcon, FacebookIcon, PencilIcon, TrashIcon, SendIcon, CheckIcon } from '../components/icons'
import { useThemePreset } from '../lib/useThemePreset'

type TeamTab = 'staff' | 'artists'

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
  // Artist mobility, Part 2: the ACTIVE membership connecting this artist
  // to the studio the list was fetched for -- HOME for this studio's own
  // roster, GUEST for an artist visiting from elsewhere. Distinct from
  // isGuest above (an older, single-studio "temporarily visiting" display
  // flag, unrelated to StudioMembership) -- both can be true independently.
  memberships: { id: string; type: 'HOME' | 'GUEST'; allowsStudioProfileEdits: boolean }[]
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
}

// 6a Epic: one scheduled stint within a GUEST membership.
interface ResidencyRow {
  id: string
  startDate: string
  endDate: string
  status: 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED'
}

interface ArtistInvite {
  id: string
  email: string
  name: string | null
  membershipType: 'HOME' | 'GUEST'
  tokenExpiresAt: string
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
  pending: boolean
  inviteExpiresAt: string | null
  artist?: { bio: string | null; specialties: string[] }
}

const EMPTY_INVITE_FORM = { email: '', name: '', phone: '', role: 'FRONT_DESK' }

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
  const { profile } = useUserProfile()
  const { onlineUserIds } = useSocket()
  const queryClient = useQueryClient()
  const isOwner = user?.role === 'OWNER'
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
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

  // Artist mobility, Part 2's own gap: ArtistMembershipInvite was invisible
  // to staff once sent (decoupled from User -- see that model's own schema
  // comment -- so it never showed up in the regular pending-invites list
  // above, which only ever queries User rows). Owner-only, same as the
  // regular invite list.
  const { data: artistInvites } = useQuery({
    queryKey: artistInvitesQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistInvite[]>(`/studios/${user!.studioId}/artist-invites`),
    enabled: isOwner,
  })

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

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE_FORM)
  const [inviteFormError, setInviteFormError] = useState<string | null>(null)
  const [inviteSubmitting, setInviteSubmitting] = useState(false)

  function openInvite() {
    setInviteForm(EMPTY_INVITE_FORM)
    setInviteFormError(null)
    setShowInviteModal(true)
  }

  // Artist mobility, Part 2: a separate modal from the Staff tab's invite
  // above -- STAFF_ROLE_OPTIONS deliberately never offers ARTIST there
  // (see its own comment: artist creation lives on this Artists tab
  // instead). This is the first artist flow that's an actual invite
  // (email + accept link) rather than "Add Artist"'s direct, password-set
  // creation -- so it gets its own small entry point rather than being
  // bolted onto either existing one.
  const [showInviteArtistModal, setShowInviteArtistModal] = useState(false)
  const [inviteArtistForm, setInviteArtistForm] = useState({
    email: '',
    name: '',
    membershipType: 'HOME',
    residencyStartDate: '',
    residencyEndDate: '',
  })
  const [inviteArtistFormError, setInviteArtistFormError] = useState<string | null>(null)
  const [inviteArtistSubmitting, setInviteArtistSubmitting] = useState(false)

  function openInviteArtist() {
    setInviteArtistForm({ email: '', name: '', membershipType: 'HOME', residencyStartDate: '', residencyEndDate: '' })
    setInviteArtistFormError(null)
    setShowInviteArtistModal(true)
  }

  async function handleInviteArtistSubmit(event: FormEvent) {
    event.preventDefault()
    if (!user?.studioId) return

    setInviteArtistFormError(null)
    setInviteArtistSubmitting(true)

    try {
      // residencyStartDate/residencyEndDate ride along unconditionally --
      // harmless for a HOME invite (the API only reads them when
      // membershipType is GUEST).
      await apiFetch(`/studios/${user.studioId}/invites`, {
        method: 'POST',
        body: JSON.stringify({ ...inviteArtistForm, role: 'ARTIST' }),
      })
      setShowInviteArtistModal(false)
      queryClient.invalidateQueries({ queryKey: artistsQueryKey(user.studioId) })
      queryClient.invalidateQueries({ queryKey: artistInvitesQueryKey(user.studioId) })
    } catch (err) {
      setInviteArtistFormError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setInviteArtistSubmitting(false)
    }
  }

  const [resendingArtistInviteId, setResendingArtistInviteId] = useState<string | null>(null)
  const [resendArtistInviteError, setResendArtistInviteError] = useState<string | null>(null)
  const [resendArtistInviteSuccessId, setResendArtistInviteSuccessId] = useState<string | null>(null)
  const [cancellingArtistInvite, setCancellingArtistInvite] = useState<ArtistInvite | null>(null)
  const [cancelArtistInviteError, setCancelArtistInviteError] = useState<string | null>(null)
  const [cancelArtistInviteSubmitting, setCancelArtistInviteSubmitting] = useState(false)

  // Part 4: ends this artist's membership at THIS studio only -- never
  // their account (POST /studios/:studioId/artists/:artistId/remove,
  // requireRole(OWNER)). Distinct from "Delete" above, which only ever
  // works for a real HOME artist here (disabled otherwise, since a real
  // GUEST never appears in `users`) -- this is the guest-facing
  // equivalent, though the backend accepts either membership type.
  const [removingArtist, setRemovingArtist] = useState<ArtistCard | null>(null)
  const [removeArtistError, setRemoveArtistError] = useState<string | null>(null)
  const [removeArtistSubmitting, setRemoveArtistSubmitting] = useState(false)

  // 6a Epic: residency management panel for one guest membership.
  const [managingResidenciesFor, setManagingResidenciesFor] = useState<ArtistCard | null>(null)
  const [residencies, setResidencies] = useState<ResidencyRow[] | null>(null)
  const [residenciesError, setResidenciesError] = useState<string | null>(null)
  const [newResidencyForm, setNewResidencyForm] = useState({ startDate: '', endDate: '' })
  const [residencyActionError, setResidencyActionError] = useState<string | null>(null)
  const [residencySubmitting, setResidencySubmitting] = useState(false)
  const [editingResidency, setEditingResidency] = useState<ResidencyRow | null>(null)
  const [editResidencyForm, setEditResidencyForm] = useState({ startDate: '', endDate: '' })

  const managingMembershipId = managingResidenciesFor?.memberships.find((m) => m.type === 'GUEST')?.id ?? null

  useEffect(() => {
    if (!managingMembershipId) {
      setResidencies(null)
      return
    }
    let ignore = false
    setResidenciesError(null)
    apiFetch<ResidencyRow[]>(`/residencies?membershipId=${managingMembershipId}`)
      .then((data) => {
        if (!ignore) setResidencies(data)
      })
      .catch((err) => {
        if (!ignore) setResidenciesError(err instanceof Error ? err.message : 'Failed to load residencies')
      })
    return () => {
      ignore = true
    }
  }, [managingMembershipId])

  async function refreshResidencies() {
    if (!managingMembershipId) return
    try {
      const data = await apiFetch<ResidencyRow[]>(`/residencies?membershipId=${managingMembershipId}`)
      setResidencies(data)
    } catch (err) {
      setResidenciesError(err instanceof Error ? err.message : 'Failed to load residencies')
    }
  }

  async function handleCreateResidency(event: FormEvent) {
    event.preventDefault()
    if (!managingMembershipId) return
    setResidencySubmitting(true)
    setResidencyActionError(null)
    try {
      await apiFetch('/residencies', {
        method: 'POST',
        body: JSON.stringify({ membershipId: managingMembershipId, ...newResidencyForm }),
      })
      setNewResidencyForm({ startDate: '', endDate: '' })
      await refreshResidencies()
    } catch (err) {
      setResidencyActionError(err instanceof Error ? err.message : 'Failed to create residency')
    } finally {
      setResidencySubmitting(false)
    }
  }

  async function handleCancelResidency(id: string) {
    setResidencyActionError(null)
    try {
      await apiFetch(`/residencies/${id}`, { method: 'PATCH', body: JSON.stringify({ cancel: true }) })
      await refreshResidencies()
    } catch (err) {
      setResidencyActionError(err instanceof Error ? err.message : 'Failed to cancel residency')
    }
  }

  function startEditingResidency(residency: ResidencyRow) {
    setEditingResidency(residency)
    setEditResidencyForm({ startDate: residency.startDate.slice(0, 10), endDate: residency.endDate.slice(0, 10) })
    setResidencyActionError(null)
  }

  async function handleEditResidencySave() {
    if (!editingResidency) return
    setResidencySubmitting(true)
    setResidencyActionError(null)
    try {
      await apiFetch(`/residencies/${editingResidency.id}`, { method: 'PATCH', body: JSON.stringify(editResidencyForm) })
      setEditingResidency(null)
      await refreshResidencies()
    } catch (err) {
      setResidencyActionError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setResidencySubmitting(false)
    }
  }

  async function handleConfirmRemoveArtist() {
    if (!user?.studioId || !removingArtist) return
    setRemoveArtistSubmitting(true)
    setRemoveArtistError(null)
    try {
      await apiFetch(`/studios/${user.studioId}/artists/${removingArtist.id}/remove`, { method: 'POST' })
      setRemovingArtist(null)
      queryClient.invalidateQueries({ queryKey: artistsQueryKey(user.studioId) })
    } catch (err) {
      setRemoveArtistError(err instanceof Error ? err.message : 'Failed to remove artist')
    } finally {
      setRemoveArtistSubmitting(false)
    }
  }

  async function handleResendArtistInvite(invite: ArtistInvite) {
    if (!user?.studioId) return
    setResendArtistInviteError(null)
    setResendArtistInviteSuccessId(null)
    setResendingArtistInviteId(invite.id)
    try {
      await apiFetch(`/studios/${user.studioId}/artist-invites/${invite.id}/resend`, { method: 'POST' })
      setResendArtistInviteSuccessId(invite.id)
    } catch (err) {
      setResendArtistInviteError(err instanceof Error ? err.message : 'Failed to resend invite')
    } finally {
      setResendingArtistInviteId(null)
    }
  }

  async function handleConfirmCancelArtistInvite() {
    if (!user?.studioId || !cancellingArtistInvite) return
    setCancelArtistInviteSubmitting(true)
    setCancelArtistInviteError(null)
    try {
      await apiFetch(`/studios/${user.studioId}/artist-invites/${cancellingArtistInvite.id}`, { method: 'DELETE' })
      setCancellingArtistInvite(null)
      queryClient.invalidateQueries({ queryKey: artistInvitesQueryKey(user.studioId) })
    } catch (err) {
      setCancelArtistInviteError(err instanceof Error ? err.message : 'Failed to cancel invite')
    } finally {
      setCancelArtistInviteSubmitting(false)
    }
  }

  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)
  const [resendError, setResendError] = useState<string | null>(null)
  const [resendSuccessId, setResendSuccessId] = useState<string | null>(null)
  const [cancellingInvite, setCancellingInvite] = useState<TeamUser | null>(null)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

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

  const [locations, setLocations] = useState<LocationOption[] | null>(null)

  // Staff tab = OWNER/FRONT_DESK only -- artists appear exclusively on the
  // Artists tab now, even though `users` (the full roster fetch below)
  // still includes them, since the Artists tab's "Edit account"/"View as"
  // actions reuse this same data + the edit modal below.
  const allStaff = users?.filter((u) => u.role === 'OWNER' || u.role === 'FRONT_DESK') ?? []
  const pendingInvites = allStaff.filter((u) => u.pending)
  const staffUsers = allStaff.filter((u) => !u.pending)

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

  async function handleInviteSubmit(event: FormEvent) {
    event.preventDefault()
    if (!user?.studioId) return

    if (!isValidPhoneDigits(inviteForm.phone)) {
      setInviteFormError('Enter a complete 10-digit phone number.')
      return
    }

    setInviteFormError(null)
    setInviteSubmitting(true)

    try {
      await apiFetch(`/studios/${user.studioId}/invites`, {
        method: 'POST',
        body: JSON.stringify(inviteForm),
      })
      setShowInviteModal(false)
      setInviteForm(EMPTY_INVITE_FORM)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setInviteFormError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setInviteSubmitting(false)
    }
  }

  async function handleResendInvite(teamUser: TeamUser) {
    if (!user?.studioId) return
    setResendError(null)
    setResendSuccessId(null)
    setResendingInviteId(teamUser.id)
    try {
      await apiFetch(`/studios/${user.studioId}/invites/${teamUser.id}/resend`, { method: 'POST' })
      setResendSuccessId(teamUser.id)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Failed to resend invite')
    } finally {
      setResendingInviteId(null)
    }
  }

  async function handleConfirmCancelInvite() {
    if (!user?.studioId || !cancellingInvite) return
    setCancelSubmitting(true)
    setCancelError(null)
    try {
      await apiFetch(`/studios/${user.studioId}/invites/${cancellingInvite.id}`, { method: 'DELETE' })
      setCancellingInvite(null)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel invite')
    } finally {
      setCancelSubmitting(false)
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

  // UI simplification pass: Team must not exist at all for a solo studio --
  // not simplified, not an empty stub. Direct navigation here (bookmark,
  // typed URL) redirects away rather than rendering, same pattern
  // ArtistCreate.tsx already uses for its own permission guard. Placed
  // after every hook above so hook call order never depends on
  // profile.isSoloStudio.
  if (profile?.isSoloStudio) {
    return <Navigate to="/profile" replace />
  }

  return (
    <>
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              {isEditorial && <Eyebrow>The Roster</Eyebrow>}
              <h1
                className={
                  isEditorial
                    ? 'mt-1 font-display text-[clamp(28px,3.4vw,38px)] font-normal tracking-[-0.015em] text-fg'
                    : 'text-2xl font-bold text-fg sm:text-3xl'
                }
              >
                Team
              </h1>
              <p className="mt-1 text-sm text-fg-secondary">Everyone with access to your studio's portal.</p>
            </div>

            {isOwner && activeTab === 'staff' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openAddStaff}
                  title="Create an account directly with a password, without sending an invite email"
                  className={
                    isEditorial
                      ? 'editorial-btn-secondary flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2.5 transition'
                      : 'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                  }
                >
                  Add directly
                </button>
                <button
                  type="button"
                  onClick={openInvite}
                  className={
                    isEditorial
                      ? 'editorial-btn-primary flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-bg transition hover:bg-accent-hover'
                      : 'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover'
                  }
                >
                  <PlusIcon className="h-4 w-4" />
                  Invite team member
                </button>
              </div>
            )}

            {isOwner && activeTab === 'artists' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/team/transfer')}
                  title="Move a departing artist's client contacts and in-flight project work to their new home studio"
                  className={
                    isEditorial
                      ? 'editorial-btn-secondary flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2.5 transition'
                      : 'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                  }
                >
                  Transfer clients
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/artists/new')}
                  title="Create an artist account directly with a password, without sending an invite email"
                  className={
                    isEditorial
                      ? 'editorial-btn-secondary flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2.5 transition'
                      : 'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                  }
                >
                  Add directly
                </button>
                <button
                  type="button"
                  onClick={openInviteArtist}
                  className={
                    isEditorial
                      ? 'editorial-btn-primary flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-bg transition hover:bg-accent-hover'
                      : 'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover'
                  }
                >
                  <PlusIcon className="h-4 w-4" />
                  Invite Artist
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-1 border-b border-border">
            {(
              [
                ['staff', 'Staff'],
                ['artists', 'Artists'],
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

          {activeTab === 'staff' && isOwner && pendingInvites.length > 0 && (
            <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/5 p-5">
              <h2 className="text-sm font-semibold text-fg">Pending invites</h2>
              <p className="mt-1 text-xs text-fg-secondary">
                Sent, but not yet activated. An invite link expires 7 days after it's sent or last resent.
              </p>
              {resendError && <p className="mt-3 text-sm text-danger">{resendError}</p>}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-fg-muted">
                      <th className="pb-2 font-medium">Email</th>
                      <th className="hidden pb-2 font-medium sm:table-cell">Role</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warning/20">
                    {pendingInvites.map((invite) => {
                      const expired = invite.inviteExpiresAt ? new Date(invite.inviteExpiresAt) < new Date() : false
                      return (
                        <tr key={invite.id}>
                          <td className="py-2.5 text-fg">{invite.email}</td>
                          <td className="hidden py-2.5 text-fg-secondary sm:table-cell">{formatStatus(invite.role)}</td>
                          <td className="py-2.5">
                            <StatusPill status="PENDING" label={expired ? 'Expired' : 'Pending'} />
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex justify-end gap-1.5 sm:gap-2">
                              <button
                                type="button"
                                onClick={() => handleResendInvite(invite)}
                                disabled={resendingInviteId === invite.id}
                                aria-label="Resend invite"
                                className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
                              >
                                {resendSuccessId === invite.id ? (
                                  <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <SendIcon className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="hidden sm:inline">
                                  {resendingInviteId === invite.id
                                    ? 'Resending…'
                                    : resendSuccessId === invite.id
                                      ? 'Sent!'
                                      : 'Resend'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCancellingInvite(invite)
                                  setCancelError(null)
                                }}
                                aria-label="Cancel invite"
                                className="flex items-center gap-1.5 rounded-full border border-danger/40 px-2 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 sm:px-3"
                              >
                                <TrashIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline">Cancel</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'staff' && isOwner && (
          // .card-surface (glass treatment under Editorial Gold) restored
          // here by explicit request, matching Clients' table -- overrides
          // the earlier "dense-data table, no glass" reasoning that had
          // removed it (still true for Conversations' thread list /
          // Calendar's grid / the permissions matrix below, just not
          // applied here anymore).
          <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-5">
            {viewAsError && <p className="mb-3 text-sm text-danger">{viewAsError}</p>}
            {error && <p className="text-sm text-danger">{error}</p>}

            {!error && users === null && <p className="text-sm text-fg-secondary">Loading team…</p>}

            {!error && users !== null && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className="py-2 font-medium">Name</th>
                      <th className="hidden py-2 font-medium md:table-cell">Email</th>
                      <th className="hidden py-2 font-medium sm:table-cell">Role</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 font-medium"></th>
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
                            <div className="flex justify-end gap-1.5 sm:gap-2">
                              {canUseViewAs && teamUser.id !== realUser?.userId && teamUser.role !== 'CUSTOMER' && (
                                <button
                                  type="button"
                                  onClick={() => handleViewAs(teamUser.id)}
                                  title="View as"
                                  className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1.5 text-xs font-medium text-fg transition hover:bg-surface sm:px-3"
                                >
                                  <ViewIcon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="hidden sm:inline">View as</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEdit(teamUser)}
                                disabled={isSelf}
                                title={isSelf ? 'Edit your own account from your profile' : 'Edit'}
                                className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
                              >
                                <PencilIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline">Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteModal(teamUser)}
                                disabled={isSelf}
                                title={isSelf ? "You can't delete your own account" : 'Delete'}
                                className="flex items-center gap-1.5 rounded-full border border-danger/40 px-2 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
                              >
                                <TrashIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline">Delete</span>
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

          {activeTab === 'artists' && isOwner && artistInvites && artistInvites.length > 0 && (
            <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/5 p-5">
              <h2 className="text-sm font-semibold text-fg">Pending invites</h2>
              <p className="mt-1 text-xs text-fg-secondary">
                Sent, but not yet accepted. An invite link expires 7 days after it's sent or last resent.
              </p>
              {resendArtistInviteError && <p className="mt-3 text-sm text-danger">{resendArtistInviteError}</p>}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-fg-muted">
                      <th className="pb-2 font-medium">Email</th>
                      <th className="hidden pb-2 font-medium sm:table-cell">Membership</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warning/20">
                    {artistInvites.map((invite) => {
                      const expired = new Date(invite.tokenExpiresAt) < new Date()
                      return (
                        <tr key={invite.id}>
                          <td className="py-2.5 text-fg">
                            {invite.name ? (
                              <>
                                {invite.name}
                                <span className="block text-xs text-fg-muted sm:inline sm:pl-1.5">{invite.email}</span>
                              </>
                            ) : (
                              invite.email
                            )}
                          </td>
                          <td className="hidden py-2.5 text-fg-secondary sm:table-cell">
                            {invite.membershipType === 'HOME' ? 'Home' : 'Guest'}
                          </td>
                          <td className="py-2.5">
                            <StatusPill status="PENDING" label={expired ? 'Expired' : 'Pending'} />
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex justify-end gap-1.5 sm:gap-2">
                              <button
                                type="button"
                                onClick={() => handleResendArtistInvite(invite)}
                                disabled={resendingArtistInviteId === invite.id}
                                aria-label="Resend invite"
                                className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
                              >
                                {resendArtistInviteSuccessId === invite.id ? (
                                  <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <SendIcon className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="hidden sm:inline">
                                  {resendingArtistInviteId === invite.id
                                    ? 'Resending…'
                                    : resendArtistInviteSuccessId === invite.id
                                      ? 'Sent!'
                                      : 'Resend'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCancellingArtistInvite(invite)
                                  setCancelArtistInviteError(null)
                                }}
                                aria-label="Cancel invite"
                                className="flex items-center gap-1.5 rounded-full border border-danger/40 px-2 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 sm:px-3"
                              >
                                <TrashIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline">Cancel</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'artists' && <TransfersPanel />}

          {activeTab === 'artists' && (
            <div className="mt-6">
              {artistsErrorMessage && (
                <div className="card-surface rounded-2xl border border-border bg-surface p-5">
                  <p className="text-sm text-danger">{artistsErrorMessage}</p>
                </div>
              )}

              {!artistsErrorMessage && artistsLoading && <SkeletonCards count={6} />}

              {!artistsErrorMessage && !artistsLoading && artists?.length === 0 && (
                <div className="card-surface rounded-2xl border border-border bg-surface p-5">
                  <p className="text-sm text-fg-secondary">
                    No artists yet.{' '}
                    {isOwner ? 'Use "Add Artist" above to add one.' : 'Ask a studio owner to add one.'}
                  </p>
                </div>
              )}

              {!artistsErrorMessage && artists && artists.length > 0 && (
                <div className="space-y-8">
                  {/* Grouped on the real, current membership type (Artist
                      mobility, Phase 1's StudioMembership.type) -- NOT
                      Artist.isGuest, the older, separate "temporarily
                      visiting" display flag from before that model existed.
                      An artist invited through the real Guest Artist flow
                      has a GUEST membership row but almost never has the
                      old isGuest flag set, so filtering on that left every
                      real guest artist miscategorized under "Studio
                      Artists". */}
                  {[
                    { label: 'Studio Artists', items: artists.filter((artist) => artist.memberships[0]?.type !== 'GUEST') },
                    { label: 'Guest Artists', items: artists.filter((artist) => artist.memberships[0]?.type === 'GUEST') },
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
                              className="cursor-pointer card-surface rounded-2xl border border-border bg-surface p-5 transition hover:border-border-strong"
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
                            {/* The ONLY guest-status badge now -- derived
                                exclusively from the real StudioMembership.type.
                                A second badge used to render here from the
                                legacy isGuest/guestEndDate fields (a
                                scheduling-only availability window, unrelated
                                to real membership -- see the "Limited
                                Availability Window" widget on ArtistDetail.tsx
                                for the full story), which is exactly how a
                                real HOME artist ended up wearing a stale
                                "Guest (ended)" badge here while correctly
                                sitting in the Studio Artists section below. */}
                            {artist.memberships[0]?.type === 'GUEST' && (
                              <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                                Guest artist
                              </span>
                            )}
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

                      {/* flex-wrap: an active guest artist gets a 4th button
                          (Remove, below) alongside View As/Edit account/
                          Delete -- plain `flex` with no wrap left the row
                          overflowing/squishing on a narrower card (this grid
                          goes up to 3 columns). Wrapping keeps every button
                          full-size and legible, just spilling onto a second
                          line with the same gap spacing on both axes, rather
                          than shrinking or clipping. */}
                      {isOwner && (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
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
                          {/* Edit account / Delete: for a real HOME artist
                              only -- someone this studio directly added.
                              Previously gated on `users?.some(...)` (whether
                              this artist appears in the studio's own User
                              roster), which is unreliable: a brand-new
                              identity's User.studioId is set to whichever
                              studio their FIRST invite happened to be
                              (HOME or GUEST) and never reassigned later, so
                              a genuine guest whose first-ever invite was a
                              guest invite could still incorrectly appear in
                              `users` and get real account-management
                              capabilities a studio that merely hosts them as
                              a guest should never have. memberships[0]?.type
                              is the real, current signal -- hidden entirely
                              for a guest, not just shown-disabled, since
                              "Remove" (below) is their actual action here. */}
                          {artist.memberships[0]?.type === 'HOME' && (
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
                          )}
                          {artist.memberships[0]?.type === 'HOME' && artist.user.id !== realUser?.userId && (
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
                          {/* 6a Epic: opens the residency-management panel
                              for this guest's membership at this studio.
                              Gated on the real residencies.manage
                              permission (OWNER always has it), not just
                              isOwner -- matches the matrix key's own
                              default of TRUE for FRONT_DESK too. */}
                          {artist.memberships[0]?.type === 'GUEST' &&
                            (isOwner || profile?.permissions.includes('residencies.manage')) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setManagingResidenciesFor(artist)
                                }}
                                className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                              >
                                Residencies
                              </button>
                            )}
                          {/* Part 4: the guest-facing counterpart to Delete
                              above -- ends the membership only, never the
                              account. */}
                          {artist.memberships[0]?.type === 'GUEST' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setRemoveArtistError(null)
                                setRemovingArtist(artist)
                              }}
                              className="rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10"
                            >
                              Remove
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

      {showInviteModal && (
        <Modal title="Invite team member" onClose={() => setShowInviteModal(false)}>
          <form onSubmit={handleInviteSubmit}>
            <p className="mb-4 text-sm text-fg-secondary">
              They'll get an email with a link to set their own password and activate their account.
            </p>

            {inviteFormError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {inviteFormError}
              </div>
            )}

            <div className="mb-3">
              <label htmlFor="inviteName" className="mb-1 block text-sm font-medium text-fg-secondary">
                Name
              </label>
              <input
                id="inviteName"
                type="text"
                value={inviteForm.name}
                onChange={(event) => setInviteForm({ ...inviteForm, name: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="invitePhone" className="mb-1 block text-sm font-medium text-fg-secondary">
                Phone
              </label>
              <PhoneInput
                id="invitePhone"
                value={inviteForm.phone}
                onChange={(digits) => setInviteForm({ ...inviteForm, phone: digits })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="inviteEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
                Email
              </label>
              <input
                id="inviteEmail"
                type="email"
                required
                value={inviteForm.email}
                onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="inviteRole" className="mb-1 block text-sm font-medium text-fg-secondary">
                Role
              </label>
              <select
                id="inviteRole"
                value={inviteForm.role}
                onChange={(event) => setInviteForm({ ...inviteForm, role: event.target.value })}
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
              disabled={inviteSubmitting}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {inviteSubmitting ? 'Sending…' : 'Send invite'}
            </button>
          </form>
        </Modal>
      )}

      {showInviteArtistModal && (
        <Modal title="Invite Artist" onClose={() => setShowInviteArtistModal(false)}>
          <form onSubmit={handleInviteArtistSubmit}>
            <p className="mb-4 text-sm text-fg-secondary">
              They'll get an email to accept. If they're new to Ink Manager, they'll set a password; if they already
              have an account elsewhere, they'll just log in to accept.
            </p>

            {inviteArtistFormError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {inviteArtistFormError}
              </div>
            )}

            <div className="mb-3">
              <label htmlFor="inviteArtistName" className="mb-1 block text-sm font-medium text-fg-secondary">
                Name
              </label>
              <input
                id="inviteArtistName"
                type="text"
                value={inviteArtistForm.name}
                onChange={(event) => setInviteArtistForm({ ...inviteArtistForm, name: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="inviteArtistEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
                Email
              </label>
              <input
                id="inviteArtistEmail"
                type="email"
                required
                value={inviteArtistForm.email}
                onChange={(event) => setInviteArtistForm({ ...inviteArtistForm, email: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="inviteArtistMembershipType" className="mb-1 block text-sm font-medium text-fg-secondary">
                Membership
              </label>
              <select
                id="inviteArtistMembershipType"
                value={inviteArtistForm.membershipType}
                onChange={(event) => setInviteArtistForm({ ...inviteArtistForm, membershipType: event.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="HOME">Home — this becomes their primary studio</option>
                <option value="GUEST">Guest — purely additive, their existing home is untouched</option>
              </select>
            </div>

            {/* 6a Epic: mandatory for a GUEST invite -- there's no
                "invite now, schedule later" for the first stint. Accepting
                the invite confirms these exact dates directly. */}
            {inviteArtistForm.membershipType === 'GUEST' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="inviteResidencyStart" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Residency start
                  </label>
                  <input
                    id="inviteResidencyStart"
                    type="date"
                    required
                    value={inviteArtistForm.residencyStartDate}
                    onChange={(event) => setInviteArtistForm({ ...inviteArtistForm, residencyStartDate: event.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label htmlFor="inviteResidencyEnd" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Residency end
                  </label>
                  <input
                    id="inviteResidencyEnd"
                    type="date"
                    required
                    value={inviteArtistForm.residencyEndDate}
                    onChange={(event) => setInviteArtistForm({ ...inviteArtistForm, residencyEndDate: event.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <p className="col-span-2 text-xs text-fg-muted">
                  This becomes their first confirmed residency the moment they accept -- accepting the invite is
                  their consent to these exact dates.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={inviteArtistSubmitting}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {inviteArtistSubmitting ? 'Sending…' : 'Send invite'}
            </button>
          </form>
        </Modal>
      )}

      {managingResidenciesFor && (
        <Modal
          title={`Residencies — ${managingResidenciesFor.user.name || managingResidenciesFor.user.email}`}
          onClose={() => {
            setManagingResidenciesFor(null)
            setEditingResidency(null)
            setResidencyActionError(null)
          }}
        >
          <p className="mb-4 text-sm text-fg-secondary">
            A stint you create here starts pending -- {managingResidenciesFor.user.name || 'they'} accept or decline it
            themselves; you can still edit dates or cancel at any point either way.
          </p>

          {residenciesError && <p className="mb-3 text-sm text-danger">{residenciesError}</p>}
          {residencyActionError && <p className="mb-3 text-sm text-danger">{residencyActionError}</p>}

          {editingResidency ? (
            <div className="mb-4 rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium text-fg">Edit stint</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={editResidencyForm.startDate}
                  onChange={(e) => setEditResidencyForm({ ...editResidencyForm, startDate: e.target.value })}
                  className="rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg"
                />
                <input
                  type="date"
                  value={editResidencyForm.endDate}
                  onChange={(e) => setEditResidencyForm({ ...editResidencyForm, endDate: e.target.value })}
                  className="rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg"
                />
              </div>
              {editingResidency.status === 'CONFIRMED' && (
                <p className="mt-2 text-xs text-fg-muted">
                  Changing dates on a confirmed stint resets it to pending -- they'll need to re-confirm.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleEditResidencySave}
                  disabled={residencySubmitting}
                  className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingResidency(null)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateResidency} className="mb-4 rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium text-fg">New stint</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  required
                  value={newResidencyForm.startDate}
                  onChange={(e) => setNewResidencyForm({ ...newResidencyForm, startDate: e.target.value })}
                  className="rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg"
                />
                <input
                  type="date"
                  required
                  value={newResidencyForm.endDate}
                  onChange={(e) => setNewResidencyForm({ ...newResidencyForm, endDate: e.target.value })}
                  className="rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg"
                />
              </div>
              <button
                type="submit"
                disabled={residencySubmitting}
                className="mt-3 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {residencySubmitting ? 'Creating…' : 'Propose stint'}
              </button>
            </form>
          )}

          <div className="divide-y divide-border">
            {(residencies ?? []).length === 0 && <p className="text-sm text-fg-secondary">No stints yet.</p>}
            {(residencies ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="text-fg">
                    {r.startDate.slice(0, 10)} – {r.endDate.slice(0, 10)}
                  </span>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      r.status === 'CONFIRMED'
                        ? 'bg-accent/10 text-accent'
                        : r.status === 'PENDING'
                          ? 'bg-surface-inset text-fg-secondary'
                          : 'bg-danger/10 text-danger'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                {(r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEditingResidency(r)}
                      className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelResidency(r.id)}
                      className="rounded-full border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {cancellingInvite && (
        <Modal title="Cancel invite" onClose={() => setCancellingInvite(null)}>
          <p className="text-sm text-fg-secondary">
            Cancel the pending invite for <span className="font-semibold">{cancellingInvite.email}</span>? Their invite
            link will stop working and they won't be able to activate an account unless invited again.
          </p>

          {cancelError && <p className="mt-3 text-sm text-danger">{cancelError}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCancellingInvite(null)}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
            >
              Keep invite
            </button>
            <button
              type="button"
              onClick={handleConfirmCancelInvite}
              disabled={cancelSubmitting}
              className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:opacity-60"
            >
              {cancelSubmitting ? 'Cancelling…' : 'Cancel invite'}
            </button>
          </div>
        </Modal>
      )}

      {cancellingArtistInvite && (
        <Modal title="Cancel invite" onClose={() => setCancellingArtistInvite(null)}>
          <p className="text-sm text-fg-secondary">
            Cancel the pending invite for <span className="font-semibold">{cancellingArtistInvite.email}</span>?
            Their invite link will stop working and they won't be able to accept unless invited again.
          </p>

          {cancelArtistInviteError && <p className="mt-3 text-sm text-danger">{cancelArtistInviteError}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCancellingArtistInvite(null)}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
            >
              Keep invite
            </button>
            <button
              type="button"
              onClick={handleConfirmCancelArtistInvite}
              disabled={cancelArtistInviteSubmitting}
              className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:opacity-60"
            >
              {cancelArtistInviteSubmitting ? 'Cancelling…' : 'Cancel invite'}
            </button>
          </div>
        </Modal>
      )}

      {removingArtist && (
        <Modal title="Remove artist" onClose={() => (removeArtistSubmitting ? null : setRemovingArtist(null))}>
          <p className="text-sm text-fg-secondary">
            Remove{' '}
            <span className="font-semibold">{removingArtist.user.name || removingArtist.user.email}</span> from your
            studio? This ends their membership here only -- their account, and any membership they have at another
            studio, are unaffected. Their past appointments and client history at your studio are preserved.
          </p>

          {removeArtistError && <p className="mt-3 text-sm text-danger">{removeArtistError}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRemovingArtist(null)}
              disabled={removeArtistSubmitting}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmRemoveArtist}
              disabled={removeArtistSubmitting}
              className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:opacity-60"
            >
              {removeArtistSubmitting ? 'Removing…' : 'Remove from studio'}
            </button>
          </div>
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
    </>
  )
}

import { createContext } from 'react'

export interface UserProfile {
  id: string
  email: string
  name: string | null
  phone: string | null
  avatarUrl: string | null
  role: string
  studioId: string
  createdAt: string
  pendingEmail: string | null
  artist?: {
    id: string
    bio: string | null
    specialties: string[]
    allowsClientSelfScheduling: boolean
    // Solo artist architecture, Phase 4: the artist's own HOME membership
    // row -- an array (same shape the backend's Prisma include returns),
    // even though exactly one HOME row exists per artist in practice.
    memberships: { allowsStudioProfileEdits: boolean }[]
    // Every studio this artist is currently an active real GUEST at --
    // previously GET /me never surfaced this at all, so a guest artist had
    // no way to confirm their own guest status anywhere except a studio's
    // own Team page. Each entry's own `id` is a real StudioMembership id,
    // used to target PATCH /artists/:id/memberships/:membershipId/
    // profile-delegation -- the existing (HOME-only) profile-delegation
    // toggle has no way to reach a studio the artist merely guests at.
    guestMemberships: {
      id: string
      allowsStudioProfileEdits: boolean
      createdAt: string
      studio: { id: string; name: string }
    }[]
  }
  permissions: string[]
  // Solo artist architecture, Phase 3: true only for an ARTIST-role user
  // with no other OWNER/FRONT_DESK at their studio -- lets Profile.tsx
  // show a real, self-service self-scheduling toggle instead of a
  // read-only "managed by your studio" note. Always false for any other
  // role.
  isSoloStudioArtist: boolean
  // UI simplification pass: true whenever the studio has exactly one
  // active-or-pending user, any role -- distinct from isSoloStudioArtist
  // above (which ignores other artists and only cares about OWNER/
  // FRONT_DESK gatekeepers). Drives hiding Team, Conversations' Team tab,
  // and the studio-delegation toggle for every role, not just artists.
  isSoloStudio: boolean
}

export interface UserProfileContextValue {
  profile: UserProfile | null
  loading: boolean
  refresh: () => Promise<void>
}

export const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined)

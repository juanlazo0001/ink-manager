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
  }
  permissions: string[]
  // Solo artist architecture, Phase 3: true only for an ARTIST-role user
  // with no other OWNER/FRONT_DESK at their studio -- lets Profile.tsx
  // show a real, self-service self-scheduling toggle instead of a
  // read-only "managed by your studio" note. Always false for any other
  // role.
  isSoloStudioArtist: boolean
}

export interface UserProfileContextValue {
  profile: UserProfile | null
  loading: boolean
  refresh: () => Promise<void>
}

export const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined)

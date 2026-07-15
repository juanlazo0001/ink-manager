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
  artist?: { bio: string | null; specialties: string[] }
  permissions: string[]
}

export interface UserProfileContextValue {
  profile: UserProfile | null
  loading: boolean
  refresh: () => Promise<void>
}

export const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined)

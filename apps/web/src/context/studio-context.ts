import { createContext } from 'react'

export interface Studio {
  id: string
  name: string
  logoUrl: string | null
  // Artist public page v2: a distinct upload from logoUrl -- see
  // Studio.iconLogo's own schema comment (apps/api/prisma/schema.prisma).
  iconLogo: string | null
  website: string | null
  createdAt: string
}

export interface StudioContextValue {
  studio: Studio | null
  loading: boolean
  refresh: () => Promise<void>
}

export const StudioContext = createContext<StudioContextValue | undefined>(undefined)

import { createContext } from 'react'

export interface Studio {
  id: string
  name: string
  logoUrl: string | null
  website: string | null
  createdAt: string
}

export interface StudioContextValue {
  studio: Studio | null
  loading: boolean
  refresh: () => Promise<void>
}

export const StudioContext = createContext<StudioContextValue | undefined>(undefined)

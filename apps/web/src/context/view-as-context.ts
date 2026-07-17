import { createContext } from 'react'

export interface ViewAsTarget {
  id: string
  name: string | null
  email: string
  role: string
}

export interface ViewAsContextValue {
  target: ViewAsTarget | null
  startViewAs: (targetUserId: string) => Promise<void>
  exitViewAs: () => void
}

export const ViewAsContext = createContext<ViewAsContextValue | undefined>(undefined)

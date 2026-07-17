import { useContext } from 'react'
import { ViewAsContext } from './view-as-context'

export function useViewAs() {
  const context = useContext(ViewAsContext)

  if (!context) {
    throw new Error('useViewAs must be used within a ViewAsProvider')
  }

  return context
}

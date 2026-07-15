import { useContext } from 'react'
import { StudioContext } from './studio-context'

export function useStudio() {
  const context = useContext(StudioContext)

  if (!context) {
    throw new Error('useStudio must be used within a StudioProvider')
  }

  return context
}

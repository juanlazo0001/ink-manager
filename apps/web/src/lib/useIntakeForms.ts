import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'

export interface IntakeFormOption {
  id: string
  name: string
  slug: string
  isDefault: boolean
}

// Shared by every prefilled-intake-link entry point (ClientDetail's "Copy
// prefilled link", the composer's "+ menu" intake-link item) that needs to
// know whether a form picker should even show -- "more than one form"
// (see IntakeFormPicker) is the only thing any of them actually branch on.
export function useIntakeForms(enabled: boolean) {
  return useQuery({
    queryKey: ['intake-forms'],
    queryFn: () => apiFetch<IntakeFormOption[]>('/intake-forms'),
    enabled,
    staleTime: 60_000,
  })
}

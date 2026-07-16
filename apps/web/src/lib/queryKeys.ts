export const inquiriesQueryKey = (studioId: string) => ['inquiries', studioId] as const
export const clientsQueryKey = (studioId: string) => ['clients', studioId] as const
export const appointmentsQueryKey = (studioId: string) => ['appointments', studioId] as const
export const artistsQueryKey = (studioId: string) => ['artists', studioId] as const
export const inquiryQueryKey = (id: string) => ['inquiry', id] as const

export const inquiriesQueryKey = (studioId: string) => ['inquiries', studioId] as const
export const clientsQueryKey = (studioId: string) => ['clients', studioId] as const
export const appointmentsQueryKey = (studioId: string) => ['appointments', studioId] as const
// Prefix-compatible with appointmentsQueryKey above, so existing
// invalidateQueries({ queryKey: appointmentsQueryKey(studioId) }) calls
// (e.g. AppointmentDetail.tsx after checkout/status changes) also
// invalidate the calendar's range-scoped queries for free.
export const appointmentsRangeQueryKey = (studioId: string, startIso: string, endIso: string) =>
  ['appointments', studioId, 'range', startIso, endIso] as const
export const artistsQueryKey = (studioId: string) => ['artists', studioId] as const
export const inquiryQueryKey = (id: string) => ['inquiry', id] as const
export const tasksQueryKey = (userId: string) => ['tasks', userId] as const
export const navCountsQueryKey = (userId: string) => ['nav-counts', userId] as const

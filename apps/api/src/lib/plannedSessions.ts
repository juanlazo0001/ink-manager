// Flat-rate pricing: a session whose showDurationToClient is false has its
// duration redacted before it ever reaches a client-facing response --
// not just hidden via frontend CSS/JS, so a client inspecting the network
// tab still can't see hours staff deliberately chose not to share. Used by
// every PUBLIC route that shows a session's hours to a client (the two
// estimate verify routes and the deposit-form verify route) -- staff-facing
// routes always return the real stored values regardless, since staff
// should always see the actual duration.
export function redactedSessionHours(session: {
  estimatedHoursMin: number;
  estimatedHoursMax: number;
  showDurationToClient: boolean;
}): { estimatedHoursMin: number | null; estimatedHoursMax: number | null } {
  if (!session.showDurationToClient) {
    return { estimatedHoursMin: null, estimatedHoursMax: null };
  }
  return { estimatedHoursMin: session.estimatedHoursMin, estimatedHoursMax: session.estimatedHoursMax };
}

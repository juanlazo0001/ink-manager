// Self-scheduling token TTL, shared by every route that mints a
// selfScheduleToken (estimates.ts's PROCEED branch, inquiries.ts's
// revise-estimate resend branch, appointments.ts's decline-and-reissue
// branch) -- previously three separate local constants kept in sync by
// hand rather than one source of truth.
export const SELF_SCHEDULE_TOKEN_TTL_DAYS = 7;

// Phase UI-4: "never spans more than one calendar day" needs to mean the
// STUDIO's calendar day, not the API server's own OS timezone or a naive
// UTC-date comparison. Moved to studioTime.ts (the shared home for every
// studio-timezone-aware time comparison after the Package D scheduling
// timezone bug) -- re-exported here so existing call sites don't need to
// change their import path.
export { isSameCalendarDay } from "./studioTime";

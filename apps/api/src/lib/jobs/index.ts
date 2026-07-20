// Side-effecting imports: each job module calls registerJob() at module
// load time. Importing this file (once, from index.ts) is what populates
// the registry before startScheduler() iterates it -- a job module that
// isn't imported here is simply never scheduled and never shows up in
// GET /jobs, regardless of whether the file exists.
import "./giftCardExpirationSweep";
import "./coldLeadSweep";
import "./reminderTicker";

export { startScheduler, runJob, getJob, listJobs } from "./registry";

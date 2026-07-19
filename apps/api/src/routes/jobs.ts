import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { logAudit } from "../lib/audit";
import { getJob, listJobs, runJob } from "../lib/jobs";

const router = Router();

router.use(requireAuth);
router.use(requireRole(Role.OWNER));

// Observability list for the Settings -> System section: every registered
// job alongside its most recent execution (by startedAt, not scheduledFor
// -- a manual run-now can land after today's cron slot and should show as
// "last run" even though its scheduledFor isn't the day's canonical slot).
router.get("/", async (_req, res) => {
  const jobs = listJobs();

  const withLastRun = await Promise.all(
    jobs.map(async (job) => {
      const lastRun = await prisma.jobRun.findFirst({
        where: { jobName: job.name },
        orderBy: { startedAt: "desc" },
      });
      return {
        jobName: job.name,
        description: job.description,
        schedule: job.schedule,
        lastRun,
      };
    }),
  );

  res.json(withLastRun);
});

// Manual trigger, forever -- how a failed sweep gets re-run without
// waiting for tomorrow's tick. scheduledFor is a fresh `new Date()`
// (unlike the cron path's day-truncated slot), so this is always its own
// unique slot: it's never blocked by today's cron run already having
// claimed the day, and running it twice in a row genuinely runs twice.
router.post("/:jobName/run-now", async (req, res) => {
  const jobName = req.params.jobName as string;
  const { studioId, userId } = req.user!;

  if (!getJob(jobName)) {
    return res.status(404).json({ error: `Unknown job: ${jobName}` });
  }

  const result = await runJob(jobName, new Date());

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "Job",
    entityId: jobName,
    action: "run_now",
    changes: result.skipped ? { skipped: true } : { status: result.jobRun.status, details: result.jobRun.details },
  });

  if (result.skipped) {
    return res.status(409).json({ error: "This exact slot was already claimed by a concurrent run" });
  }

  res.json(result.jobRun);
});

export default router;

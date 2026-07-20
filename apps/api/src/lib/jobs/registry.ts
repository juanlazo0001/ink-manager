import cron from "node-cron";
import { prisma } from "../prisma";
import { JobStatus } from "../../../generated/prisma/enums";
import type { Prisma } from "../../../generated/prisma/client";

export type JobDetails = Record<string, unknown>;

export interface JobDefinition {
  name: string;
  // Shown in the System settings UI.
  description: string;
  // Standard 5-field cron expression. Evaluated in the API process's own
  // clock (Railway containers run UTC) -- StudioSettings.timezone exists
  // for per-studio "the day" math inside a job's own run() (see each job's
  // comments), not for scheduling the tick itself. No per-studio cron
  // registration: studios can be added/removed at runtime and node-cron
  // has no notion of that, so one global tick iterates every studio.
  schedule: string;
  // Minutes between this job's own JobRun dedup slots (see computeSlot
  // below). Defaults to 1440 (one day) -- correct for the original
  // Phase 7A daily sweeps, but a job that ticks more often than once a
  // day MUST set this to its own real cadence (e.g. 15 for a 15-minute
  // ticker), or every tick after the first each day silently collides
  // with the first tick's already-claimed JobRun row and gets skipped --
  // a bug this comment exists because it was found the hard way once
  // already (see Phase 7B-2's reminder ticker).
  slotMinutes?: number;
  run: (scheduledFor: Date) => Promise<JobDetails>;
}

const registry = new Map<string, JobDefinition>();

export function registerJob(job: JobDefinition): void {
  registry.set(job.name, job);
}

export function getJob(name: string): JobDefinition | undefined {
  return registry.get(name);
}

export function listJobs(): JobDefinition[] {
  return [...registry.values()];
}

export type RunJobResult =
  | { skipped: true }
  | { skipped: false; jobRun: Awaited<ReturnType<typeof prisma.jobRun.update>> };

// Shared runner for every job: claim -> execute -> record. Used by both the
// cron tick and POST /jobs/:jobName/run-now so the two paths never diverge.
//
// Double-run guard: the JobRun row is `create`d -- claiming the
// (jobName, scheduledFor) slot -- BEFORE any work happens. If another
// process (or an overlapping tick) already claimed the exact same slot,
// the unique constraint rejects this create (Prisma P2002) and this
// function returns { skipped: true } without running the job's logic at
// all. This is why cron ticks compute scheduledFor as a coarse, DETERMINISTIC
// slot (the start of the current UTC day, via startOfUtcDay below)
// rather than a raw timestamp -- two processes/ticks landing
// within the same day compute the identical slot and correctly collide.
// Manual run-now instead passes a fresh `new Date()` (see routes/jobs.ts),
// which is always its own unique slot -- deliberately never blocked by
// today's already-claimed cron slot, since re-running a failed sweep on
// demand is the whole point of that endpoint.
//
// Never throws: a job that throws is recorded FAILED with the error
// message, logged to the console, and the promise still resolves --
// callers (the cron tick, run-now) never need a try/catch of their own,
// and one job's bug can never crash the API process.
export async function runJob(jobName: string, scheduledFor: Date): Promise<RunJobResult> {
  const job = registry.get(jobName);
  if (!job) throw new Error(`Unknown job: ${jobName}`);

  let jobRun;
  try {
    jobRun = await prisma.jobRun.create({
      data: { jobName, scheduledFor, status: JobStatus.RUNNING },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      console.log(`Job "${jobName}" skipped -- slot ${scheduledFor.toISOString()} already claimed`);
      return { skipped: true };
    }
    throw err;
  }

  try {
    const details = await job.run(scheduledFor);
    // Round-tripped through JSON for the same reason logAudit's diffObjects
    // is (lib/audit.ts) -- job details may contain Date values, and this
    // lands on a plain value Prisma's Json column will accept.
    const jsonDetails = JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue;
    const updated = await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: JobStatus.SUCCEEDED, finishedAt: new Date(), details: jsonDetails },
    });
    return { skipped: false, jobRun: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Job "${jobName}" failed`, err);
    const updated = await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: JobStatus.FAILED, finishedAt: new Date(), error: message },
    });
    return { skipped: false, jobRun: updated };
  }
}

// The deterministic "slot" a daily cron tick represents: the start of
// today in UTC. Two processes (or two overlapping ticks) firing on the
// same calendar day compute the identical Date, which is what makes the
// double-run guard above actually catch them regardless of a few
// milliseconds' (or even minutes') difference in real fire time.
//
// Kept as its own named export (rather than inlining computeSlot(date,
// 1440) everywhere) since it's the one every existing Phase 7A job
// implicitly relied on before slotMinutes existed.
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Generalizes startOfUtcDay to an arbitrary slot size: floors the given
// instant to the nearest slotMinutes boundary since the Unix epoch. For
// slotMinutes=1440 this produces exactly the same Date startOfUtcDay does
// (the epoch itself falls on a UTC day boundary), so every existing daily
// job's behavior is unchanged; a 15-minute job instead gets a fresh,
// distinct slot every 15 minutes all day long, rather than colliding with
// its own first successful run until midnight UTC.
export function computeSlot(date: Date, slotMinutes: number): Date {
  const slotMs = slotMinutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / slotMs) * slotMs);
}

// Registers a cron.schedule tick for every registered job. Called once at
// process boot (see index.ts), after every job module's own import has run
// registerJob -- see jobs/index.ts for the import order that guarantees
// this.
export function startScheduler(): void {
  for (const job of listJobs()) {
    const slotMinutes = job.slotMinutes ?? 1440;
    cron.schedule(job.schedule, () => {
      void runJob(job.name, computeSlot(new Date(), slotMinutes));
    });
    console.log(`[jobs] scheduled "${job.name}": ${job.schedule}`);
  }
}

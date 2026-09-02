// Package BJ, item 1: give every studio the liability-waiver chase --
// a client reminder that goes out the day before an appointment ONLY while
// that appointment's waiver is still unsigned.
//
// This is a seed rather than a hardcoded fourth built-in reminder because the
// same package added studio-configured reminders (StudioReminder): the waiver
// chase is simply the first row on that mechanism, which means a studio can
// retime it, reword it, or turn it off from Settings -> Defaults like any
// other reminder, instead of it being a thing only a deploy can change.
//
// A SCHEMA MIGRATION IS NOT THIS. `prisma migrate deploy` on a Railway deploy
// creates the tables; it never creates these rows. This script has to be run
// deliberately, once per database, and the run must be recorded in REPORT.md
// naming WHICH database it ran against.
//
// Idempotent and safe to re-run: keyed on (studioId, systemKey), it only ever
// creates a missing row. It never edits or re-enables a row that already
// exists, so a studio that reworded the message -- or deliberately switched it
// off -- keeps its choice through any later re-run.
//
// Usage (from apps/api):
//   npx tsx -r dotenv/config scripts/seed-waiver-reminder.ts dotenv_config_path=.env
//   ... dotenv_config_path=.env.production   <- production, deliberately
// Add --dry-run to report without writing.
import { prisma } from "../src/lib/prisma";
import { ReminderAudience, ReminderCondition } from "../generated/prisma/enums";

const DRY_RUN = process.argv.includes("--dry-run");

// Stable identity for this seeded row. Never change it: it is the only thing
// stopping a re-run from creating a second copy.
export const WAIVER_REMINDER_KEY = "waiver_unsigned_day_before";

// "The day before, at 10:00 in the studio's own timezone" -- not a rolling
// T-24h. Every reminder in this system targets a CIVIL DATE in the studio's
// timezone and fires at a configured local time, which is why nobody gets
// texted at 03:00 because that is when their appointment happens to fall.
export const WAIVER_REMINDER_OFFSET_DAYS = 1;
export const WAIVER_REMINDER_SEND_TIME = "10:00";

export const WAIVER_REMINDER_BODY =
  "Hi {{clientFirstName}}, your appointment with {{artistName}} at {{studioName}} is tomorrow at " +
  "{{appointmentTime}}. Please sign your liability waiver before you arrive so we can start on time: " +
  "{{waiverLink}}";

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(unknown)";
  console.log(`database: ${dbHost}`);
  console.log(DRY_RUN ? "mode    : DRY RUN (no writes)\n" : "mode    : WRITING\n");

  const studios = await prisma.studio.findMany({
    select: {
      id: true,
      name: true,
      reminders: { where: { systemKey: WAIVER_REMINDER_KEY }, select: { id: true, enabled: true } },
    },
    orderBy: { name: "asc" },
  });

  let created = 0;
  let alreadyPresent = 0;

  for (const studio of studios) {
    if (studio.reminders.length > 0) {
      alreadyPresent += 1;
      continue;
    }

    if (!DRY_RUN) {
      await prisma.studioReminder.create({
        data: {
          studioId: studio.id,
          label: "Liability waiver - day before",
          audience: ReminderAudience.CLIENT,
          condition: ReminderCondition.WAIVER_UNSIGNED,
          offsetDays: WAIVER_REMINDER_OFFSET_DAYS,
          sendTime: WAIVER_REMINDER_SEND_TIME,
          body: WAIVER_REMINDER_BODY,
          enabled: true,
          isSystem: true,
          systemKey: WAIVER_REMINDER_KEY,
        },
      });
    }
    created += 1;
  }

  console.log(`studios          : ${studios.length}`);
  console.log(`already had one  : ${alreadyPresent}`);
  console.log(`${DRY_RUN ? "would create" : "created"}     : ${created}`);
  console.log(`\nOn ${dbHost}. Record this database name in REPORT.md.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

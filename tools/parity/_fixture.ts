/*
 * The parity fixture for the inquiry detail screen.
 *
 * ─── WHY THIS PERSISTS, UNLIKE MOST FIXTURE WRITES ──────────────────
 *
 * Sessions here normally revert every dev write. This one is meant to
 * stay: the parity run has to be reproducible, and "run it against the
 * inquiry that had rich data that day" is not reproducible. Naming one
 * record and keeping it renderable is what makes a before/after
 * comparison mean anything six sessions from now.
 *
 * ─── WHAT IT ACTUALLY CHANGES ───────────────────────────────────────
 *
 * Only the two image URLs, and only because they were dead. They pointed
 * at `https://example.com/ref4.jpg` — a placeholder that 404s, so the
 * Reference Images and Placement Photos sections rendered a broken image
 * on web and nothing measurable on mobile. They now point at
 * Cloudinary's public demo images, which are real files that both
 * clients can load.
 *
 * Nothing else is touched: the estimate, artist, deposit, notes and
 * intake answers are the record's own.
 *
 *     npx tsx tools/parity/_fixture.ts          # report only
 *     npx tsx tools/parity/_fixture.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "../../apps/api/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** Named in the session report so the run can be repeated exactly. */
export const PARITY_INQUIRY_ID = "cms0vlzqi0003jci2bgphz3z9";

const REFERENCE = "https://res.cloudinary.com/demo/image/upload/sample.jpg";
const PLACEMENT = "https://res.cloudinary.com/demo/image/upload/sample2.jpg";

async function main() {
  const apply = process.argv.includes("--apply");
  const before = await prisma.inquiry.findUnique({
    where: { id: PARITY_INQUIRY_ID },
    select: { id: true, referenceImages: true, placementImages: true, status: true },
  });
  if (!before) throw new Error(`fixture inquiry ${PARITY_INQUIRY_ID} not found`);

  console.log("before:", JSON.stringify(before, null, 2));

  const dead = (u: string) => u.includes("example.com");
  const needsFix = before.referenceImages.some(dead) || before.placementImages.some(dead);
  if (!needsFix) {
    console.log("\nnothing to do — no dead placeholder URLs on this record.");
  } else if (!apply) {
    console.log("\nwould replace the example.com placeholders. Re-run with --apply.");
  } else {
    const after = await prisma.inquiry.update({
      where: { id: PARITY_INQUIRY_ID },
      data: {
        referenceImages: before.referenceImages.map((u) => (dead(u) ? REFERENCE : u)),
        placementImages: before.placementImages.map((u) => (dead(u) ? PLACEMENT : u)),
      },
      select: { referenceImages: true, placementImages: true },
    });
    console.log("\nafter:", JSON.stringify(after, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

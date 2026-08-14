// Seeds (or resets) the single dev client used by the A2P 10DLC walkthrough,
// so the run always starts from a known, genuinely opted-in state rather than
// whatever the last run left behind.
//
// Deliberately dev-only: it refuses to run against a database whose URL looks
// like the production one, for the same reason simulateTwilioInbound.ts does --
// it writes consent state.
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { generateUniqueReferralCode } from "../lib/referrals";

const STUDIO_SLUG = "dev-studio";
// Overridable so a fresh run can use a clean number/name rather than
// inheriting a previous run's thread. Both are reserved-fictional
// (NANP 555-01XX) numbers that no real subscriber can hold.
const WALKTHROUGH_PHONE = process.argv[2] ?? "9105550147";
const FIRST_NAME = process.argv[3] ?? "Jordan";
const LAST_NAME = process.argv[4] ?? "Reyes";

function assertDevDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  // The production database host is distinct from dev's; refuse anything that
  // isn't the known dev host rather than allow-listing by guesswork.
  if (!url.includes("hopper.proxy.rlwy.net")) {
    throw new Error(
      "REFUSING TO RUN: DATABASE_URL does not point at the known dev database host.\n" +
        "This script writes consent state and must never touch production.",
    );
  }
}

async function main() {
  assertDevDatabase();

  const studio = await prisma.studio.findFirst({ where: { slug: STUDIO_SLUG }, select: { id: true, name: true } });
  if (!studio) throw new Error(`Studio "${STUDIO_SLUG}" not found.`);

  let client = await prisma.client.findFirst({
    where: {
      studioId: studio.id,
      OR: [{ phone: WALKTHROUGH_PHONE }, { phones: { some: { phone: WALKTHROUGH_PHONE } } }],
    },
  });

  if (client) {
    client = await prisma.client.update({
      where: { id: client.id },
      data: {
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        phone: WALKTHROUGH_PHONE,
        // The point of the reset: back to opted-IN with consent on record.
        smsOptedOutAt: null,
        smsConsentGivenAt: new Date(),
      },
    });
    console.log("RESET existing walkthrough client:", client.id);
  } else {
    client = await prisma.client.create({
      data: {
        studioId: studio.id,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        phone: WALKTHROUGH_PHONE,
        smsConsentGivenAt: new Date(),
        referralCode: await generateUniqueReferralCode(),
      },
    });
    await prisma.clientPhone.create({
      data: { clientId: client.id, phone: WALKTHROUGH_PHONE, isPrimary: true },
    });
    console.log("CREATED walkthrough client:", client.id);
  }

  console.log(
    JSON.stringify(
      {
        studio: studio.name,
        clientId: client.id,
        name: `${client.firstName} ${client.lastName}`,
        phone: client.phone,
        smsOptedOutAt: client.smsOptedOutAt,
        smsConsentGivenAt: client.smsConsentGivenAt,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

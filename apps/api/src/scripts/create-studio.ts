import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { generateUniqueSlug, inviteEmailContent, INVITE_TOKEN_TTL_DAYS } from "../routes/studios";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { sendPlatformEmail } from "../lib/platformEmail";
import { logAudit } from "../lib/audit";

// Platform-operator-only mechanism to create a brand new Studio -- there is
// no UI button or authenticated route for this, on purpose (see the "no
// platform-operator role" gap flagged in REPORT.md). Run directly:
//
//   cd apps/api
//   npx tsx src/scripts/create-studio.ts --name "Some Studio" --owner-email owner@example.com [--owner-name "Jane Doe"] [--owner-phone 555-1234] [--solo-artist]
//
// Authorization boundary is the same one `prisma migrate deploy` and
// `prisma db seed` already rely on: whoever can run this has direct
// filesystem + DATABASE_URL access (dev via .env, production only as a
// deliberate one-off pointed at .env.production per DEVELOPMENT.md) --
// nothing here is reachable over HTTP. Deliberately does NOT reuse
// POST /studios/bootstrap's BOOTSTRAP_SECRET-header pattern: this script's
// entire point is that it never needs to be an HTTP-reachable action in the
// first place, so a shared-secret header would just be a weaker copy of the
// filesystem/DB credential boundary that already gates it.
//
// The studio's first user is created exactly like a team invite -- a real
// User row (role OWNER) with an inviteToken and no password, emailed a
// setup link -- never a directly-set password like /studios/bootstrap does.
// --solo-artist additionally gives that same OWNER user an Artist profile
// and a HOME StudioMembership at creation time (not deferred to invite
// acceptance): the pending User row already exists and invite acceptance
// only ever touches password/inviteToken/isActive, so attaching Artist +
// StudioMembership now is safe and means the account is fully correct the
// moment they set their password. allowsStudioProfileEdits: true because a
// solo artist editing their own studio's profile fields isn't "delegated"
// access from someone else -- they ARE the studio.

interface ParsedArgs {
  studioName: string;
  ownerEmail: string;
  ownerName: string | null;
  ownerPhone: string | null;
  soloArtist: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && argv[idx + 1] !== undefined ? argv[idx + 1]! : null;
  };

  const studioName = get("--name");
  const ownerEmail = get("--owner-email");
  const soloArtist = argv.includes("--solo-artist");

  if (!studioName || !ownerEmail) {
    console.error(
      "Usage: npx tsx src/scripts/create-studio.ts --name \"Studio Name\" --owner-email owner@example.com [--owner-name \"Full Name\"] [--owner-phone 555-1234] [--solo-artist]"
    );
    process.exit(1);
  }

  return {
    studioName,
    ownerEmail: ownerEmail.trim(),
    ownerName: get("--owner-name"),
    ownerPhone: get("--owner-phone"),
    soloArtist,
  };
}

async function main() {
  const { studioName, ownerEmail, ownerName, ownerPhone, soloArtist } = parseArgs(process.argv.slice(2));

  const existing = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (existing) {
    console.error(`A user with email ${ownerEmail} already exists (id ${existing.id}). Aborting.`);
    process.exit(1);
  }

  const slug = await generateUniqueSlug(studioName);
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { studio, owner, artist } = await prisma.$transaction(async (tx) => {
    const studio = await tx.studio.create({ data: { name: studioName, slug } });

    const owner = await tx.user.create({
      data: {
        email: ownerEmail,
        role: Role.OWNER,
        studioId: studio.id,
        name: ownerName,
        phone: ownerPhone,
        password: null,
        inviteToken,
        inviteTokenExpiresAt,
      },
    });

    const artist = soloArtist
      ? await tx.artist.create({ data: { userId: owner.id, specialties: [], portfolioImages: [] } })
      : null;

    if (artist) {
      await tx.studioMembership.create({
        data: { studioId: studio.id, artistId: artist.id, type: "HOME", allowsStudioProfileEdits: true },
      });
    }

    return { studio, owner, artist };
  });

  await logAudit({
    studioId: studio.id,
    actorUserId: null,
    entityType: "Studio",
    entityId: studio.id,
    action: "platform_studio_created",
    changes: { name: studioName, slug, ownerEmail, soloArtist },
  });

  const inviteUrl = `${PUBLIC_APP_URL}/invite/${inviteToken}`;
  try {
    await sendPlatformEmail({ to: ownerEmail, ...inviteEmailContent(studio.name, inviteUrl) });
    console.log(`Invite email sent to ${ownerEmail}.`);
  } catch (err) {
    console.error("Failed to send invite email -- share this link with the owner manually:", inviteUrl);
    console.error(err);
  }

  console.log("");
  console.log("Studio created:");
  console.log(`  id: ${studio.id}`);
  console.log(`  slug: ${studio.slug}`);
  console.log(`  owner user id: ${owner.id}`);
  if (artist) {
    console.log(`  artist id: ${artist.id} (solo artist -- OWNER + Artist + HOME StudioMembership)`);
  }
  console.log(`  invite url (fallback, expires in ${INVITE_TOKEN_TTL_DAYS} days): ${inviteUrl}`);
}

main()
  .catch((err) => {
    console.error("FATAL", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

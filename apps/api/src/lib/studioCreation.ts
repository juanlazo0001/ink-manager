import { prisma } from "./prisma";
import { Role } from "../../generated/prisma/enums";
import { generateUniqueSlug } from "../routes/studios";

export class StudioCreationError extends Error {
  code: "email_taken";
  constructor(code: "email_taken", message: string) {
    super(message);
    this.code = code;
  }
}

// Two ways a new owner account can prove it controls the email it's
// signing up with -- exactly the two paths this app has today. "invite"
// matches the platform-operator create-studio.ts script's existing
// behavior unchanged (no password yet, an emailed setup link). "password"
// is public self-serve signup: a real password set immediately, gated
// behind POST /auth/verify-email/:token before login works (see
// User.emailVerifiedAt's own schema comment for why the token, not
// emailVerifiedAt itself, is the actual login gate).
export type CreateStudioAuth =
  | { mode: "invite"; inviteToken: string; inviteTokenExpiresAt: Date }
  | {
      mode: "password";
      passwordHash: string;
      emailVerificationToken: string;
      emailVerificationTokenExpiresAt: Date;
    };

export interface CreateStudioParams {
  studioName: string;
  ownerEmail: string;
  ownerName: string | null;
  ownerPhone: string | null;
  // Gives the OWNER an Artist profile + HOME StudioMembership at creation
  // time (not deferred to invite acceptance) -- see create-studio.ts's own
  // comment for why this is safe to do immediately rather than on accept.
  soloArtist: boolean;
  auth: CreateStudioAuth;
}

// Studio + owner User (+ optional Artist/HOME StudioMembership for the
// solo case) in one transaction -- the ONE creation path both
// create-studio.ts (platform operator) and the public signup route call,
// rather than two independently-maintained copies of the same logic.
// Deliberately does NOT send any email or write an audit log -- those
// differ meaningfully between callers (different audit action, different
// email content/fallback behavior), so each caller owns its own.
export async function createStudioWithOwner(params: CreateStudioParams) {
  const { studioName, ownerEmail, ownerName, ownerPhone, soloArtist, auth } = params;

  const existing = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (existing) {
    throw new StudioCreationError("email_taken", `A user with email ${ownerEmail} already exists.`);
  }

  const slug = await generateUniqueSlug(studioName);

  return prisma.$transaction(async (tx) => {
    const studio = await tx.studio.create({ data: { name: studioName, slug } });

    // Created eagerly rather than left to getOrCreateSettings' lazy
    // fallback (routes/studioSettings.ts) -- a brand new studio's very
    // first client-facing payment link can be created before anyone ever
    // opens the Settings page, and every payment-flow read path falls
    // back to `?? false` when this row doesn't exist yet. Eagerly
    // creating it here means the schema's own embeddedPaymentsEnabled
    // default actually takes effect from the studio's first moment, not
    // just from whenever Settings happens to first get read.
    await tx.studioSettings.create({ data: { studioId: studio.id } });

    const owner = await tx.user.create({
      data: {
        email: ownerEmail,
        role: Role.OWNER,
        studioId: studio.id,
        name: ownerName,
        phone: ownerPhone,
        ...(auth.mode === "invite"
          ? {
              password: null,
              inviteToken: auth.inviteToken,
              inviteTokenExpiresAt: auth.inviteTokenExpiresAt,
            }
          : {
              password: auth.passwordHash,
              emailVerificationToken: auth.emailVerificationToken,
              emailVerificationTokenExpiresAt: auth.emailVerificationTokenExpiresAt,
            }),
      },
    });

    const artist = soloArtist
      ? await tx.artist.create({ data: { userId: owner.id, specialties: [], portfolioImages: [] } })
      : null;

    if (artist) {
      // allowsStudioProfileEdits: true -- a solo artist editing their own
      // studio's profile fields isn't "delegated" access from someone
      // else, they ARE the studio (same reasoning create-studio.ts's own
      // comment already established).
      await tx.studioMembership.create({
        data: { studioId: studio.id, artistId: artist.id, type: "HOME", allowsStudioProfileEdits: true },
      });
    }

    return { studio, owner, artist };
  });
}

import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { emailKey, makeLimiter } from "../lib/rateLimit";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { requireAuth } from "../middleware/auth";
import type { AuthPayload } from "../middleware/auth";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { sendPlatformEmail } from "../lib/platformEmail";
import { renderPlatformEmailHtml } from "../lib/emailTemplate";
import { createStudioWithOwner, StudioCreationError } from "../lib/studioCreation";
import { logAudit } from "../lib/audit";

const router = Router();

const SALT_ROUNDS = 10;

// Compared against when no user is found, so lookup failures and password
// mismatches take the same amount of time and don't leak which one occurred.
const DUMMY_PASSWORD_HASH = "$2b$10$ty/pJLsBz1GB9M5f62ncJeCjuhSWkSjnEOiYd5dKmTolbjHQJ.bzu";

const PASSWORD_RESET_TOKEN_TTL_HOURS = 1;
const EMAIL_CHANGE_TOKEN_TTL_HOURS = 24;
const EMAIL_VERIFICATION_TOKEN_TTL_HOURS = 24;

const MINUTE = 60 * 1000;

// Public, unauthenticated, and the whole point of each is "create real
// state (a studio, an email send) from one request" -- exactly the shape
// abuse targets. 5/15min per IP is deliberately tight: a real person only
// ever needs one of each per signup attempt; genuine retries (typo'd
// email, slow inbox) are well under that.
//
// Unchanged in limit; moved onto the shared Postgres store so two API
// processes count together. See lib/rateLimit.ts.
const signupLimiter = makeLimiter({ name: "signup-ip", windowMs: 15 * MINUTE, limit: 5 });
const resendVerificationLimiter = makeLimiter({
  name: "resend-verification-ip",
  windowMs: 15 * MINUTE,
  limit: 5,
});

/*
 * ─── LOGIN. PREVIOUSLY NOT RATE LIMITED AT ALL ──────────────────────
 *
 * Found in session BE: signup and resend-verification were guarded and
 * `/login` was wide open, which is the wrong way round — signup costs an
 * attacker a studio record, login costs them somebody's account.
 *
 * TWO LIMITERS, DELIBERATELY, because either alone is defeated by the
 * obvious move against it:
 *
 *   per IP     stops one machine hammering many accounts
 *   per EMAIL  stops many machines hammering one account, which is what
 *              credential stuffing actually looks like — the point of a
 *              botnet is that no single address looks busy
 *
 * BOTH COUNT FAILURES ONLY (`skipSuccessfulRequests`). This is the
 * calibration that matters: a person using the app normally never
 * accumulates anything, so no amount of ordinary traffic can lock a
 * studio out, while an attacker — whose requests are ~100% failures —
 * hits the wall almost immediately. Counting all requests would have
 * forced much looser numbers to stay safe for real users, which is
 * exactly backwards.
 *
 *   IP     15 failures / 15 min. A whole studio can share one NAT
 *          address; five staff each fumbling a password twice is 10.
 *          15 leaves room for that and still stops a script in seconds.
 *   EMAIL   8 failures / 15 min. A human who has failed eight times in a
 *          quarter of an hour needs the reset link, not another guess.
 *
 * Neither is a lockout: both windows are rolling and short.
 */
const loginIpLimiter = makeLimiter({
  name: "login-ip",
  windowMs: 15 * MINUTE,
  limit: 15,
  skipSuccessfulRequests: true,
});
const loginEmailLimiter = makeLimiter({
  name: "login-email",
  windowMs: 15 * MINUTE,
  limit: 8,
  skipSuccessfulRequests: true,
  keyGenerator: emailKey,
});

/*
 * ─── FORGOT PASSWORD ────────────────────────────────────────────────
 *
 * The abuse here is not guessing, it is SENDING: each request mails a
 * real person. Unlimited, it is a mail-bomb aimed at any address the
 * attacker names, and a way to burn the platform's sending reputation.
 *
 * Counts ALL requests, not just failures — the route deliberately answers
 * identically whether or not the account exists, so "failure" is not a
 * thing it can distinguish, and `skipSuccessfulRequests` would count
 * nothing at all.
 *
 * NO ENUMERATION ORACLE. The limiter runs BEFORE the handler and keys on
 * the submitted string, so an address that has no account is counted and
 * 429s exactly like one that does. If it only limited real accounts, the
 * 429 itself would answer "does this email exist" — which is the one
 * thing this route is written to never reveal.
 *
 * An hour rather than fifteen minutes: nobody legitimately needs six
 * reset emails in an hour, and the slower window is what makes the mail
 * volume bounded rather than merely paced.
 */
const forgotPasswordEmailLimiter = makeLimiter({
  name: "forgot-password-email",
  windowMs: 60 * MINUTE,
  limit: 5,
  keyGenerator: emailKey,
});
const forgotPasswordIpLimiter = makeLimiter({
  name: "forgot-password-ip",
  windowMs: 60 * MINUTE,
  limit: 15,
});

/*
 * ─── RESET PASSWORD ─────────────────────────────────────────────────
 *
 * Guessing a token. Keyed on IP ONLY, and that is the deliberate choice:
 * the token is in the PATH, so keying on it would give an attacker a
 * fresh budget for every value they try — a limiter that rate-limits
 * nothing. IP is the only stable identity a token-guesser has.
 *
 * 10 an hour. A real person follows the link once, occasionally twice
 * after mistyping a new password.
 */
const resetPasswordIpLimiter = makeLimiter({
  name: "reset-password-ip",
  windowMs: 60 * MINUTE,
  limit: 10,
});

// Fire-and-forget on purpose, everywhere in this file: the token/DB state
// change is the real, durable effect of every route below and always
// happens first, synchronously, before this is ever called -- a Bird
// outage (see lib/platformEmail.ts's own current unresolved-auth status)
// degrades a flow to "the link exists but the email didn't arrive," never
// to "the request silently did nothing" or "the request 500s." Errors are
// logged, never surfaced to the caller -- also closes a timing side
// channel on forgot-password specifically (awaiting a real network call to
// Bird only on the "email exists" branch would make that branch
// measurably slower than the "email doesn't exist" branch, defeating the
// same-response-either-way guarantee).
function sendPlatformEmailBestEffort(params: { to: string; subject: string; text: string; html: string }): void {
  sendPlatformEmail(params).catch((err) => {
    console.error("Failed to send platform email", { to: params.to, subject: params.subject, err });
  });
}

router.post("/login", loginIpLimiter, loginEmailLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Checked before the password comparison, not after -- a pending-invite
  // user has no password hash at all (see the schema comment on
  // User.password), so comparing against it would always fail and fall
  // into the generic "invalid credentials" branch below, which is the
  // wrong message for someone who hasn't finished setting up their
  // account yet. Not a user-enumeration concern the way forgot-password's
  // identical-response requirement is -- this app's own login flow
  // already reveals account state distinctly for deactivated accounts
  // (below), and an invite's existence is already known to both the
  // admin who sent it and the invitee who received it.
  if (user?.inviteToken) {
    return res.status(401).json({ error: "Check your email to activate your account." });
  }

  // Public self-serve signup only -- see User.emailVerificationToken's own
  // schema comment for why this field, not emailVerifiedAt, is the actual
  // gate. Every invite-based account (team invite, artist invite,
  // create-studio.ts) never has this set at all, so this branch is a true
  // no-op for them, same as the inviteToken check above being a no-op for
  // a password-based account. Checked before the password comparison, same
  // precedent as inviteToken above -- this app's login flow already reveals
  // account state distinctly (deactivated, pending invite) rather than
  // treating every branch as an enumeration risk.
  if (user?.emailVerificationToken) {
    return res.status(401).json({
      error: "Check your email to verify your account before logging in.",
      code: "email_not_verified",
    });
  }

  const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  if (!user.isActive) {
    return res.status(401).json({ error: "This account has been deactivated. Contact your studio owner." });
  }

  const payload: AuthPayload = { userId: user.id, studioId: user.studioId, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  res.json({ token });
});

// Public. Deliberately returns the exact same response whether or not
// `email` belongs to a real account -- the standard "don't let forgot-
// password become an email-enumeration oracle" practice. The ONLY branch
// that differs is invisible to the caller: a real match gets a token +
// email, everything else is silently a no-op.
router.post("/auth/forgot-password", forgotPasswordIpLimiter, forgotPasswordEmailLimiter, async (req, res) => {
  const { email } = req.body ?? {};

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // A pending-invite or deactivated account also gets the generic response
  // (no token issued) -- resetting a password that doesn't functionally
  // exist yet (invite) or shouldn't be usable right now (deactivated)
  // would be confusing at best, and issuing a token there would leak
  // account-state information through a side channel this route is
  // specifically designed not to have.
  if (user && !user.inviteToken && user.isActive) {
    const passwordResetToken = crypto.randomBytes(32).toString("hex");
    const passwordResetTokenExpiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken, passwordResetTokenExpiresAt },
    });

    const resetUrl = `${PUBLIC_APP_URL}/reset-password/${passwordResetToken}`;
    sendPlatformEmailBestEffort({
      to: user.email,
      subject: "Reset your Ink Manager password",
      text: `We received a request to reset your Ink Manager password. Reset it here: ${resetUrl}\n\nThis link expires in ${PASSWORD_RESET_TOKEN_TTL_HOURS} hour(s). If you didn't request this, you can safely ignore this email.`,
      html: renderPlatformEmailHtml({
        heading: "Reset your password",
        bodyParagraphs: ["We received a request to reset your Ink Manager password. Click the button below to choose a new one."],
        buttonText: "Reset password",
        buttonUrl: resetUrl,
        footnote: `This link expires in ${PASSWORD_RESET_TOKEN_TTL_HOURS} hour(s). If you didn't request this, you can safely ignore this email.`,
      }),
    });
  }

  res.json({ message: "If an account exists for that email, a password reset link has been sent." });
});

router.post("/auth/reset-password/:token", resetPasswordIpLimiter, async (req, res) => {
  const token = req.params.token as string;
  const { newPassword } = req.body ?? {};

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "newPassword must be at least 8 characters" });
  }

  const user = await prisma.user.findUnique({ where: { passwordResetToken: token } });

  if (!user) {
    return res.status(404).json({ error: "This link is invalid." });
  }
  if (!user.passwordResetTokenExpiresAt || user.passwordResetTokenExpiresAt < new Date()) {
    return res.status(410).json({ error: "This link has expired." });
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // passwordChangedAt is what the JWT middleware compares every existing
  // token's own `iat` against (see middleware/auth.ts) -- this is the
  // actual session-invalidation mechanism, not just "the password
  // changed." Set in the SAME update as the new hash/token-clear so
  // there's no window where a stale session could still slip through.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: passwordHash,
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
      passwordChangedAt: new Date(),
    },
  });

  res.json({ message: "Password reset. You can now log in with your new password." });
});

router.post("/auth/change-email", requireAuth, async (req, res) => {
  const { newEmail, currentPassword } = req.body ?? {};

  if (typeof newEmail !== "string" || newEmail.trim().length === 0) {
    return res.status(400).json({ error: "newEmail is required" });
  }
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return res.status(400).json({ error: "currentPassword is required" });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const currentPasswordMatches = await bcrypt.compare(currentPassword, user.password ?? DUMMY_PASSWORD_HASH);
  if (!currentPasswordMatches) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const trimmedEmail = newEmail.trim();
  if (trimmedEmail === user.email) {
    return res.status(400).json({ error: "That's already your current email." });
  }

  const existingWithEmail = await prisma.user.findUnique({ where: { email: trimmedEmail } });
  if (existingWithEmail) {
    return res.status(409).json({ error: "That email is already in use." });
  }

  const emailChangeToken = crypto.randomBytes(32).toString("hex");
  const emailChangeTokenExpiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  // `email` itself is untouched -- the account keeps authenticating with
  // the OLD address until POST /auth/confirm-email-change/:token
  // succeeds. pendingEmail is only ever read by that one route.
  await prisma.user.update({
    where: { id: user.id },
    data: { pendingEmail: trimmedEmail, emailChangeToken, emailChangeTokenExpiresAt },
  });

  const confirmUrl = `${PUBLIC_APP_URL}/confirm-email-change/${emailChangeToken}`;
  sendPlatformEmailBestEffort({
    to: trimmedEmail,
    subject: "Confirm your new Ink Manager email",
    text: `Confirm this email address for your Ink Manager account: ${confirmUrl}\n\nThis link expires in ${EMAIL_CHANGE_TOKEN_TTL_HOURS} hours. Until confirmed, your account keeps signing in with your current email. If you didn't request this, you can safely ignore this email.`,
    html: renderPlatformEmailHtml({
      heading: "Confirm your new email",
      bodyParagraphs: ["Confirm this email address to finish updating your Ink Manager account. Until you do, your account keeps signing in with your current email."],
      buttonText: "Confirm new email",
      buttonUrl: confirmUrl,
      footnote: `This link expires in ${EMAIL_CHANGE_TOKEN_TTL_HOURS} hours. If you didn't request this, you can safely ignore this email.`,
    }),
  });

  res.json({ message: "Check your new email address to confirm the change." });
});

// Public -- the confirm link is clicked from an email client, which may
// not carry the browser session that requested the change (a different
// device, or a session that's since expired). Token-gated, same public-
// flow discipline as every other token route in this app.
router.post("/auth/confirm-email-change/:token", async (req, res) => {
  const token = req.params.token as string;

  const user = await prisma.user.findUnique({ where: { emailChangeToken: token } });

  if (!user || !user.pendingEmail) {
    return res.status(404).json({ error: "This link is invalid." });
  }
  if (!user.emailChangeTokenExpiresAt || user.emailChangeTokenExpiresAt < new Date()) {
    return res.status(410).json({ error: "This link has expired." });
  }

  // Re-checked at confirm time, not just at request time -- another
  // account could have taken the address in the intervening window
  // (unlikely, but the unique constraint would throw an unhandled 500
  // without this, not a clean error).
  const existingWithEmail = await prisma.user.findUnique({ where: { email: user.pendingEmail } });
  if (existingWithEmail && existingWithEmail.id !== user.id) {
    return res.status(409).json({ error: "That email is now in use by another account." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { email: user.pendingEmail, pendingEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null },
  });

  res.json({ message: "Email confirmed. You can now sign in with your new email address." });
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return res.status(400).json({ error: "currentPassword is required" });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "newPassword must be at least 8 characters" });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const currentPasswordMatches = await bcrypt.compare(currentPassword, user.password ?? DUMMY_PASSWORD_HASH);
  if (!currentPasswordMatches) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Same passwordChangedAt mechanism as reset-password above -- every
  // OTHER session (a laptop left logged in elsewhere, say) is invalidated
  // the instant this commits, not just future logins. This request's own
  // token stays valid for the rest of THIS request (req.user was already
  // resolved before this handler ran), but the very next request with the
  // same token gets rejected by the middleware's live check -- the
  // frontend re-logs-in immediately after a successful change specifically
  // because of this.
  await prisma.user.update({
    where: { id: user.id },
    data: { password: passwordHash, passwordChangedAt: new Date() },
  });

  res.json({ message: "Password changed. Please log in again." });
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function verificationEmailContent(verifyUrl: string) {
  return {
    subject: "Verify your Ink Manager email",
    text: `Welcome to Ink Manager! Verify your email to finish setting up your account: ${verifyUrl}\n\nThis link expires in ${EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours.`,
    html: renderPlatformEmailHtml({
      heading: "Verify your email",
      bodyParagraphs: ["Welcome to Ink Manager! Verify your email address to finish setting up your account and log in."],
      buttonText: "Verify email",
      buttonUrl: verifyUrl,
      footnote: `This link expires in ${EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours.`,
    }),
  };
}

// Internal, operational -- not client-facing. Goes out alongside (never
// instead of) the owner's own verification email, on every self-serve
// signup, so the team notices new signups without having to poll the DB.
// Same PLATFORM_NOTIFICATION_ADDRESS-agnostic pattern as everything else
// in this file: built via the same renderPlatformEmailHtml/
// sendPlatformEmailBestEffort pair, so a Bird outage degrades this to "no
// notification email," never to a broken/slowed signup -- the studio/
// owner/audit-log creation above already fully committed before this is
// ever called.
const PLATFORM_NOTIFICATION_ADDRESS = "hello@inkmanager.app";

function newSignupNotificationContent(params: { studioName: string; slug: string; persona: string; ownerEmail: string }) {
  const personaLabel = params.persona === "SOLO" ? "Independent artist" : "Studio";
  return {
    subject: `New signup: ${params.studioName}`,
    text: `A new studio signed up for Ink Manager.\n\nStudio: ${params.studioName} (${params.slug})\nPersona: ${personaLabel}\nOwner email: ${params.ownerEmail}`,
    html: renderPlatformEmailHtml({
      heading: "New studio signup",
      bodyParagraphs: [
        `${params.studioName} just signed up for Ink Manager.`,
        `Persona: ${personaLabel}`,
        `Owner email: ${params.ownerEmail}`,
        `Slug: ${params.slug}`,
      ],
      buttonText: "Open Ink Manager",
      buttonUrl: PUBLIC_APP_URL,
    }),
  };
}

// dev Bird email doesn't deliver to any address at all in this workspace
// (confirmed live, repeatedly, this session -- every @dev-studio.test send
// attempt gets a real 422 RecipientDomainNotAllowed from Bird's API, not a
// theoretical gap), so the verification link is always also logged
// server-side outside production -- otherwise local signup testing has no
// way to actually reach the link at all.
function logVerificationUrlInDev(email: string, verifyUrl: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[dev] Email verification link for ${email}: ${verifyUrl}`);
  }
}

// Public self-serve signup. One creation path (lib/studioCreation.ts) --
// same transaction create-studio.ts uses, just with a real password +
// pending email verification instead of an invite token. Persona only
// changes two things: whether an Artist/HOME membership is attached
// (SOLO) and studioName's own default.
router.post("/auth/signup", signupLimiter, async (req, res) => {
  const { persona, ownerName, email, password, phone } = req.body ?? {};
  let { studioName } = req.body ?? {};

  if (persona !== "SOLO" && persona !== "STUDIO") {
    return res.status(400).json({ error: "persona must be SOLO or STUDIO" });
  }
  if (typeof ownerName !== "string" || ownerName.trim().length === 0) {
    return res.status(400).json({ error: "ownerName is required" });
  }
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (persona === "STUDIO" && (typeof studioName !== "string" || studioName.trim().length === 0)) {
    return res.status(400).json({ error: "studioName is required for a studio account" });
  }
  // Solo may default it from their own name -- no slug-editing step at
  // signup means this doubles as the intake-form/flash-gallery URL's own
  // display name, so it needs to be something, not blank.
  if (persona === "SOLO" && (typeof studioName !== "string" || studioName.trim().length === 0)) {
    studioName = ownerName.trim();
  }

  const trimmedEmail = email.trim();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const emailVerificationToken = crypto.randomBytes(32).toString("hex");
  const emailVerificationTokenExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  let studio, owner;
  try {
    ({ studio, owner } = await createStudioWithOwner({
      studioName: studioName.trim(),
      ownerEmail: trimmedEmail,
      ownerName: ownerName.trim(),
      ownerPhone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
      soloArtist: persona === "SOLO",
      auth: { mode: "password", passwordHash, emailVerificationToken, emailVerificationTokenExpiresAt },
    }));
  } catch (err) {
    if (err instanceof StudioCreationError) {
      // Gracefully, not silently -- unlike forgot-password's deliberate
      // anti-enumeration design, this codebase already reveals "that email
      // is taken" directly elsewhere (change-email, team invites), so
      // matching that existing precedent here isn't a new leak surface.
      return res.status(409).json({ error: "An account with that email already exists. Try logging in instead." });
    }
    throw err;
  }

  await logAudit({
    studioId: studio.id,
    actorUserId: null,
    entityType: "Studio",
    entityId: studio.id,
    action: "self_serve_studio_created",
    changes: { name: studioName, slug: studio.slug, ownerEmail: trimmedEmail, persona },
  });

  const verifyUrl = `${PUBLIC_APP_URL}/verify-email/${emailVerificationToken}`;
  sendPlatformEmailBestEffort({ to: trimmedEmail, ...verificationEmailContent(verifyUrl) });
  sendPlatformEmailBestEffort({
    to: PLATFORM_NOTIFICATION_ADDRESS,
    ...newSignupNotificationContent({ studioName, slug: studio.slug, persona, ownerEmail: trimmedEmail }),
  });
  logVerificationUrlInDev(trimmedEmail, verifyUrl);

  res.status(201).json({ message: "Check your email to verify your account.", email: trimmedEmail, studioSlug: studio.slug });
});

// Public -- clicked from an email client, same token-gated discipline as
// every other public-flow token route in this file. Returns a real JWT
// (same shape /login and the artist-invite-accept new-identity branch
// return) so the frontend CAN log the owner in directly on successful
// verify rather than bouncing to a separate /login step -- Part 2's own
// call whether to actually use it that way.
router.post("/auth/verify-email/:token", async (req, res) => {
  const token = req.params.token as string;

  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });

  if (!user) {
    return res.status(404).json({ error: "This link is invalid." });
  }
  if (!user.emailVerificationTokenExpiresAt || user.emailVerificationTokenExpiresAt < new Date()) {
    return res.status(410).json({ error: "This link has expired. Request a new one from the login page." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerificationToken: null, emailVerificationTokenExpiresAt: null },
  });

  const payload: AuthPayload = { userId: user.id, studioId: user.studioId, role: user.role };
  const jwtToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  res.json({ message: "Email verified.", token: jwtToken });
});

// Public. Same identical-response-either-way discipline as forgot-password
// above -- doesn't reveal whether the email belongs to a real account, an
// already-verified one, or an invite-based one that never needed
// verification in the first place. Rotates a fresh token each call
// (rather than resending the same one) so an old, possibly-leaked link
// stops working the moment a new one is requested.
router.post("/auth/resend-verification", resendVerificationLimiter, async (req, res) => {
  const { email } = req.body ?? {};

  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "email is required" });
  }

  const trimmedEmail = email.trim();
  const user = await prisma.user.findUnique({ where: { email: trimmedEmail } });

  if (user?.emailVerificationToken) {
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationTokenExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken, emailVerificationTokenExpiresAt },
    });

    const verifyUrl = `${PUBLIC_APP_URL}/verify-email/${emailVerificationToken}`;
    sendPlatformEmailBestEffort({ to: trimmedEmail, ...verificationEmailContent(verifyUrl) });
    logVerificationUrlInDev(trimmedEmail, verifyUrl);
  }

  res.json({ message: "If that account needs verification, a new link has been sent." });
});

export default router;

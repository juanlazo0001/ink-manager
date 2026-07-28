import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { requireAuth } from "../middleware/auth";
import type { AuthPayload } from "../middleware/auth";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { sendPlatformEmail } from "../lib/platformEmail";

const router = Router();

const SALT_ROUNDS = 10;

// Compared against when no user is found, so lookup failures and password
// mismatches take the same amount of time and don't leak which one occurred.
const DUMMY_PASSWORD_HASH = "$2b$10$ty/pJLsBz1GB9M5f62ncJeCjuhSWkSjnEOiYd5dKmTolbjHQJ.bzu";

const PASSWORD_RESET_TOKEN_TTL_HOURS = 1;
const EMAIL_CHANGE_TOKEN_TTL_HOURS = 24;

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

router.post("/login", async (req, res) => {
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
router.post("/auth/forgot-password", async (req, res) => {
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
      html: `<p>We received a request to reset your Ink Manager password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in ${PASSWORD_RESET_TOKEN_TTL_HOURS} hour(s). If you didn't request this, you can safely ignore this email.</p>`,
    });
  }

  res.json({ message: "If an account exists for that email, a password reset link has been sent." });
});

router.post("/auth/reset-password/:token", async (req, res) => {
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
    html: `<p>Confirm this email address for your Ink Manager account.</p><p><a href="${confirmUrl}">Confirm new email</a></p><p>This link expires in ${EMAIL_CHANGE_TOKEN_TTL_HOURS} hours. Until confirmed, your account keeps signing in with your current email. If you didn't request this, you can safely ignore this email.</p>`,
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

export default router;

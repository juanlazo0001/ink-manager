import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./jwt";

// Raw REST calls against Google's OAuth2 and Gmail APIs -- no googleapis
// SDK dependency, mirroring how twilio.ts wraps its provider (a thin,
// purpose-built layer over the handful of calls this app actually needs),
// just via fetch instead of an SDK since Gmail's REST surface here is
// small: token exchange/refresh/revoke, send, list, get, mark-read.
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1";

// Both requested together per this feature's own spec, regardless of
// gmail.modify's actual permission overlap with gmail.send -- Google just
// grants the union, and requesting exactly what's documented keeps the
// OAuth consent screen's own scope list matching what was configured there.
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify";

export function isGmailConfigured(): boolean {
  return !!process.env.GMAIL_CLIENT_ID && !!process.env.GMAIL_CLIENT_SECRET;
}

function requireGmailCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Gmail integration is not configured on this server");
  }
  return { clientId, clientSecret };
}

// Signed, short-lived carrier for "which studio/user initiated this OAuth
// flow" -- the callback below is a public route (Google's redirect can't
// carry this app's own Bearer JWT), so identity has to travel through the
// one round-trippable channel OAuth gives us: the `state` param. Reuses the
// app's existing JWT_SECRET (still server-only, never exposed) rather than
// inventing a second secret for what's structurally the same kind of thing
// (a signed, verifiable, time-limited claim). The 10-minute expiry is a
// user-experience bound (how long the Google consent screen may sit
// unattended before this flow is considered abandoned), not a security
// requirement -- state tampering is what the signature itself prevents.
interface GmailOAuthState {
  studioId: string;
  actorUserId: string;
  purpose: "gmail_oauth";
}

export function signGmailOAuthState(studioId: string, actorUserId: string): string {
  const payload: GmailOAuthState = { studioId, actorUserId, purpose: "gmail_oauth" };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "10m" });
}

export function verifyGmailOAuthState(state: string): GmailOAuthState | null {
  try {
    const payload = jwt.verify(state, JWT_SECRET) as GmailOAuthState;
    return payload.purpose === "gmail_oauth" ? payload : null;
  } catch {
    return null;
  }
}

export function buildGmailAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = requireGmailCredentials();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES);
  url.searchParams.set("access_type", "offline");
  // Forces Google to reissue a refresh_token even if this Google account
  // already granted this app consent before -- without it, a reconnect
  // after a prior disconnect could silently come back with no
  // refresh_token at all (Google only issues one on the very first consent
  // grant by default), which would otherwise look like a mysterious
  // connect failure with no obvious cause.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function gmailErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string; error_description?: string };
    if (typeof data.error === "object" && data.error?.message) return data.error.message;
    if (typeof data.error === "string" && data.error_description) return data.error_description;
    if (typeof data.error === "string") return data.error;
  } catch {
    // fall through to the generic message below
  }
  return `Gmail API error (${res.status})`;
}

export interface GmailTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GmailTokens> {
  const { clientId, clientSecret } = requireGmailCredentials();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) throw new Error(await gmailErrorMessage(res));
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresIn: data.expires_in };
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = requireGmailCredentials();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(await gmailErrorMessage(res));
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function revokeGmailToken(token: string): Promise<void> {
  await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
}

// Per-process, in-memory only -- never persisted (access tokens are
// short-lived, ~1hr, and there's no correctness reason to survive a
// restart; the refresh token in the DB is the only thing that actually
// needs to last). This is what satisfies "don't request a new token on
// every single send": within one process's lifetime, a studio's access
// token is reused across sends/polls until it's within 60s of expiring.
const accessTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export async function getValidAccessToken(studioId: string, refreshToken: string): Promise<string> {
  const cached = accessTokenCache.get(studioId);
  const now = Date.now();
  if (cached && cached.expiresAt - 60_000 > now) return cached.accessToken;

  const { accessToken, expiresIn } = await refreshAccessToken(refreshToken);
  accessTokenCache.set(studioId, { accessToken, expiresAt: now + expiresIn * 1000 });
  return accessToken;
}

export async function getGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(await gmailErrorMessage(res));
  return res.json() as Promise<{ emailAddress: string }>;
}

// RFC 2047 B-encoding for a Subject header with non-ASCII characters --
// plain ASCII (the overwhelming common case: "Message from {Studio Name}",
// "Re: ...") passes through untouched.
function encodeMimeWord(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

interface SendGmailMessageParams {
  accessToken: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

function buildRawMime(params: SendGmailMessageParams): string {
  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodeMimeWord(params.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ];
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) headers.push(`References: ${params.references}`);

  const raw = `${headers.join("\r\n")}\r\n\r\n${params.body}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export interface SendGmailMessageResult {
  id: string;
  threadId: string;
}

// The one real-send path -- both the composer's outbound email branch
// (routes/conversations.ts) and the Settings "Send test email" action
// (routes/integrations.ts) call this directly; there's no third caller
// yet, so unlike SMS's clientSms.ts, no separate policy-layer wrapper
// exists on top of it.
export async function sendGmailMessage(params: SendGmailMessageParams): Promise<SendGmailMessageResult> {
  const raw = buildRawMime(params);
  const res = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw, ...(params.threadId ? { threadId: params.threadId } : {}) }),
  });
  if (!res.ok) throw new Error(await gmailErrorMessage(res));
  const data = (await res.json()) as { id: string; threadId: string };
  return { id: data.id, threadId: data.threadId };
}

// One extra lightweight call right after a send, to capture the true RFC822
// Message-ID header (NOT the same as the Gmail API's own `id` field) --
// needed so a LATER reply from this app can set In-Reply-To/References
// correctly. Best-effort from every caller (a failure here never blocks
// the send itself, which has already succeeded by the time this runs).
export async function getRfc822MessageId(accessToken: string, gmailMessageId: string): Promise<string | null> {
  const res = await fetch(
    `${GMAIL_API_BASE}/users/me/messages/${gmailMessageId}?format=metadata&metadataHeaders=Message-ID`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { payload?: { headers?: { name: string; value: string }[] } };
  const header = data.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id");
  return header?.value ?? null;
}

// Time-window based, not history-id based: simpler to reason about (no
// historyId-expired edge case to handle), and correctness doesn't depend on
// it being exact -- a poll's own query window can overlap the previous
// one's on purpose (see emailPoller.ts's small backward buffer), since
// dedup on gmailMessageId in the DB is the real idempotency guard, not this
// query. `in:inbox` alone (no `is:unread`) is deliberate: a message a staff
// member already read directly in Gmail webmail before this poll ran must
// still sync in, not be skipped for having lost its unread flag.
export async function listInboxMessagesSince(
  accessToken: string,
  afterEpochSeconds: number,
): Promise<{ id: string; threadId: string }[]> {
  const results: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages`);
    url.searchParams.set("q", `in:inbox after:${afterEpochSeconds}`);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(await gmailErrorMessage(res));
    const data = (await res.json()) as { messages?: { id: string; threadId: string }[]; nextPageToken?: string };
    results.push(...(data.messages ?? []));
    pageToken = data.nextPageToken;
    // Sane per-tick cap -- a studio getting more than this many new inbox
    // messages within one poll interval picks up the rest on the next tick
    // rather than this one job run fetching unboundedly.
  } while (pageToken && results.length < 200);

  return results;
}

function findHeader(headers: { name: string; value: string }[], name: string): string | null {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

// Depth-first search for the first non-attachment part of the given mime
// type. Attachments (a part with a filename) are always skipped -- out of
// scope for v1 per this feature's own spec.
function extractPart(part: GmailMessagePart, mimeType: string): string | null {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const found = extractPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

// Minimal, pragmatic fallback for an HTML-only email (common for
// marketing/auto-reply senders) -- strips tags and decodes the handful of
// entities likely to actually appear in a short inbound message. Not a full
// HTML-to-text pass; good enough for a plain-text CRM record of what a
// client wrote, not a faithful re-render.
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export interface GmailFullMessage {
  subject: string;
  from: string;
  threadId: string;
  rfc822MessageId: string | null;
  plainTextBody: string;
}

export async function getFullMessage(accessToken: string, gmailMessageId: string): Promise<GmailFullMessage> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/messages/${gmailMessageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(await gmailErrorMessage(res));
  const data = (await res.json()) as { threadId: string; payload?: GmailMessagePart & { headers?: { name: string; value: string }[] } };

  const headers = data.payload?.headers ?? [];
  const subject = findHeader(headers, "Subject") ?? "(no subject)";
  const from = findHeader(headers, "From") ?? "";
  const rfc822MessageId = findHeader(headers, "Message-ID");

  let plainTextBody = data.payload ? extractPart(data.payload, "text/plain") : null;
  if (!plainTextBody) {
    const html = data.payload ? extractPart(data.payload, "text/html") : null;
    plainTextBody = html ? stripHtml(html) : "";
  }

  return { subject, from, threadId: data.threadId, rfc822MessageId, plainTextBody: (plainTextBody ?? "").trim() };
}

// "Jane Doe" <jane@example.com> -> jane@example.com. Falls back to the raw
// header value if it's a bare address with no display name.
export function extractEmailAddress(headerValue: string): string | null {
  const match = headerValue.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  const trimmed = headerValue.trim();
  return trimmed.includes("@") ? trimmed : null;
}

// Cleanup only, not a correctness mechanism -- emailPoller.ts's own
// after:<lastPolledAt> query window plus the gmailMessageId dedup check are
// what actually prevent reprocessing. This just keeps the connected Gmail
// inbox from accumulating an ever-growing pile of "unread" messages that
// have already been imported into Ink Manager. Best-effort: a failure here
// never affects whether the message was successfully imported.
export async function markMessageRead(accessToken: string, gmailMessageId: string): Promise<void> {
  await fetch(`${GMAIL_API_BASE}/users/me/messages/${gmailMessageId}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

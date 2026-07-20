import crypto from "node:crypto";

// AES-256-GCM for every provider credential a studio connects (Twilio auth
// token today; email/IG/FB/Google Calendar tokens later on this same
// chassis). One platform-level key (INTEGRATION_ENCRYPTION_KEY, base64,
// 32 raw bytes) encrypts every studio's secrets -- there is no per-studio
// key, so losing/rotating this one key means every connected studio has
// to reconnect. Decryption happens ONLY server-side at send/receive time;
// no route ever returns a decrypted secret, only masked display values.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer | null {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) return null;

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }

  return key.length === 32 ? key : null;
}

export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

// Ciphertext is stored as "iv:authTag:data", each base64 -- a random IV
// per encryption (GCM requires a unique nonce per message under the same
// key) and the auth tag alongside it so decryption can verify integrity,
// not just confidentiality.
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  if (!key) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");

  const [ivB64, authTagB64, dataB64] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Malformed ciphertext");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// Never returned raw -- Account SID display keeps its recognizable "AC"
// prefix (so staff can confirm it's the right kind of value at a glance)
// with everything else masked, e.g. "AC…****".
export function maskAccountSid(sid: string): string {
  if (sid.length <= 6) return "*".repeat(sid.length);
  return `${sid.slice(0, 2)}…${"*".repeat(4)}`;
}

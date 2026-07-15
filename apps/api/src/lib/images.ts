// Shared by Studio.logoUrl, User.avatarUrl (self-service and admin-set) —
// base64 data URLs stored directly on the row rather than adding file
// storage infra for small profile/branding images.
export const MAX_IMAGE_SOURCE_MB = 5;
// Base64 inflates size by ~4/3, plus a little room for the data: URL prefix.
export const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil((MAX_IMAGE_SOURCE_MB * 1_000_000 * 4) / 3) + 100;

export function validateImageDataUrl(
  value: unknown,
  fieldName: string,
): { value: string | null } | { error: string } {
  if (value === null) return { value: null };

  if (typeof value !== "string" || !value.startsWith("data:image/")) {
    return { error: `${fieldName} must be an image data URL or null` };
  }

  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return { error: `${fieldName} image is too large. Please use an image under ${MAX_IMAGE_SOURCE_MB}MB.` };
  }

  return { value };
}

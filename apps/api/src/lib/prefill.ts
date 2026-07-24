// Contact + tattoo fields only -- mirrors the public intake form's own
// prefillable fields (channel/colorOrBlackGrey/hasBeenTattooedBefore stay
// explicit client choices, never silently prefilled). Shared by the
// staff-side manual prefill route and the Claude-assisted draft-inquiry
// extraction, so both paths land on the exact same allowlist.
export const PREFILLABLE_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "description",
  "placement",
  "estimatedSize",
  "budget",
  "desiredTiming",
  "preferredArtistId",
] as const;

// Built as an explicit projection of named fields, same allowlist
// discipline as the share-to-artist projection -- never trusts the caller
// (or, for the Claude flow, the model) to have only sent recognized keys.
export function sanitizePrefillPayload(payload: unknown): Record<string, string> {
  if (typeof payload !== "object" || payload === null) return {};
  const result: Record<string, string> = {};
  for (const field of PREFILLABLE_FIELDS) {
    const value = (payload as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim().length > 0) {
      result[field] = value.trim();
    }
  }
  return result;
}

// Shared between artists.ts (PATCH /:id, PATCH /:id/preferred-schedule) and
// studios.ts (the comprehensive atomic artist-creation path in
// POST /:studioId/users) -- both need to validate the exact same
// artist-profile field shapes, so this is the one place that defines them.

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isValidDateOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return !Number.isNaN(new Date(value).getTime());
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidPreferredSchedule(
  value: unknown,
): value is Array<{ dayOfWeek: number; startTime: string; endTime: string }> {
  if (!Array.isArray(value)) return false;

  return value.every(
    (block) =>
      block &&
      typeof block === "object" &&
      typeof block.dayOfWeek === "number" &&
      Number.isInteger(block.dayOfWeek) &&
      block.dayOfWeek >= 0 &&
      block.dayOfWeek <= 6 &&
      typeof block.startTime === "string" &&
      TIME_PATTERN.test(block.startTime) &&
      typeof block.endTime === "string" &&
      TIME_PATTERN.test(block.endTime),
  );
}

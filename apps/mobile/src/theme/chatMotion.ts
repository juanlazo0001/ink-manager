/**
 * Chat motion presets (spec §10).
 *
 * Named rather than inlined so the same spring is literally the same
 * object everywhere it is used — a header collapse and a drag snap-back
 * that differ by five units of damping read as two different apps.
 *
 * Part 1 uses S2. S1, S3 and S4 land with Part 3's motion work; they are
 * declared here now so that part adds callers rather than a second file.
 */

/** Pop — incoming entry, typing, long-press lift. */
export const S1 = { stiffness: 200, damping: 16, mass: 1 } as const;

/** Settle — drag snap-back, header collapse, sheet dismiss, pill. */
export const S2 = { stiffness: 260, damping: 30, mass: 1 } as const;

/** UI — composer growth, send-button, swipe snap. */
export const S3 = { stiffness: 320, damping: 28, mass: 1 } as const;

/** Fly — the send-fly (§10). */
export const S4 = { stiffness: 240, damping: 26, mass: 1 } as const;

/**
 * §8's conversation-list metrics, in one place because more than one
 * component has to agree about them.
 *
 * The controls row, the section labels, the rows and the separators all
 * derive their horizontal geometry from these. When they were each
 * carrying their own `space.lg` the column drifted: the list read as
 * three stacked things with similar-but-not-equal margins rather than
 * one column.
 */

/** §8: rows and the controls row share a 20pt horizontal inset. */
export const LIST_INSET = 20;

/** §8: the row avatar. See LIST_SEPARATOR_INSET — the two are tied. */
export const LIST_AVATAR = 44;

/**
 * §8: section labels (`PINNED`, `CONVERSATIONS`) sit 2pt further in than
 * the rows -- optical alignment, because Jura caps at 10 with .2em
 * tracking have visibly more side-bearing than an avatar's hard edge.
 */
export const LIST_LABEL_INSET = 22;

/**
 * §8: separators inset 76 -- the avatar's 20pt inset plus its 44pt width
 * plus the 12pt gap to the text. The rule starts where the text starts,
 * so it reads as dividing the CONTENT rather than boxing the avatars.
 */
export const LIST_SEPARATOR_INSET = LIST_INSET + LIST_AVATAR + 12;

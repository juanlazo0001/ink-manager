import { prisma } from "./prisma";

interface ArtistCandidate {
  id: string;
  name: string;
}

async function loadStudioArtists(studioId: string): Promise<ArtistCandidate[]> {
  const artists = await prisma.artist.findMany({
    where: { user: { studioId } },
    select: { id: true, user: { select: { name: true } } },
  });
  return artists
    .filter((a): a is typeof a & { user: { name: string } } => Boolean(a.user.name))
    .map((a) => ({ id: a.id, name: a.user.name }));
}

function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Classic DP edit distance -- names are short enough (a handful of words)
// that this needs no library.
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// A candidate counts as "fuzzy" once its edit distance is small relative
// to the longer name's own length -- roughly one typo per four characters
// (25%), floored at 1 so even a short name tolerates a single-character
// slip. Deliberately loose: a fuzzy match is never auto-applied on its
// own, only offered up for staff review (see ImportRow.artistFlaggedForReview),
// so a generous threshold costs nothing but one extra glance in the
// review table, never a silently-wrong assignment.
function isFuzzyMatch(distance: number, maxLen: number): boolean {
  if (maxLen === 0) return false;
  const threshold = Math.max(1, Math.floor(maxLen * 0.25));
  return distance > 0 && distance <= threshold;
}

export interface ArtistMatchResult {
  matchedArtistId: string | null;
  artistFlaggedForReview: boolean;
}

// Exact (case/whitespace-insensitive) match against the studio's own
// Artist display names (User.name) first -- the only outcome that's
// applied without a flag. If none, the single closest fuzzy candidate
// (see isFuzzyMatch) is offered but flagged for review rather than
// silently applied; no candidate at all is also flagged, with
// matchedArtistId left null. Either way, review presents the same
// artist-picker so staff can confirm, correct, or clear it.
export async function matchArtistForImportRow(studioId: string, rawArtistName: string | null): Promise<ArtistMatchResult> {
  if (!rawArtistName) return { matchedArtistId: null, artistFlaggedForReview: false };

  const normalizedInput = normalizeArtistName(rawArtistName);
  if (!normalizedInput) return { matchedArtistId: null, artistFlaggedForReview: false };

  const artists = await loadStudioArtists(studioId);

  const exact = artists.find((a) => normalizeArtistName(a.name) === normalizedInput);
  if (exact) return { matchedArtistId: exact.id, artistFlaggedForReview: false };

  let bestCandidate: ArtistCandidate | null = null;
  let bestDistance = Infinity;

  for (const artist of artists) {
    const normalizedCandidate = normalizeArtistName(artist.name);
    const distance = levenshteinDistance(normalizedInput, normalizedCandidate);
    const maxLen = Math.max(normalizedInput.length, normalizedCandidate.length);
    if (isFuzzyMatch(distance, maxLen) && distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = artist;
    }
  }

  return { matchedArtistId: bestCandidate?.id ?? null, artistFlaggedForReview: true };
}

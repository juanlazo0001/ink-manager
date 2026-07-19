// Month view has no resource columns, so appointments are told apart by a
// per-artist color instead. Deterministic (hashed from the artist id) and
// pure frontend -- no schema change, no manual color-assignment UI. A
// "let staff pick their own color" setting would be a reasonable future
// enhancement, but is out of scope for this pass.
const PALETTE = [
  '#5b8def', // blue
  '#e0a53f', // amber
  '#7fbf7f', // green
  '#d97fd9', // orchid
  '#e07a7a', // coral
  '#6bc7c7', // teal
  '#b08fe0', // violet
  '#e0975b', // orange
]

export function colorForArtistId(artistId: string): string {
  let hash = 0
  for (let i = 0; i < artistId.length; i++) {
    hash = (hash * 31 + artistId.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

export interface ArtistLike {
  user: { email: string; name: string | null; avatarUrl: string | null }
}

export function artistLabel(artist: ArtistLike): string {
  return artist.user.name ?? artist.user.email
}

export function ArtistAvatar({ artist, className }: { artist: ArtistLike; className: string }) {
  const label = artistLabel(artist)
  if (artist.user.avatarUrl) {
    return <img src={artist.user.avatarUrl} alt={label} className={`${className} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${className} flex shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-fg`}>
      {label.slice(0, 1).toUpperCase()}
    </span>
  )
}

export interface ArtistLike {
  user: { email: string; name: string | null; avatarUrl: string | null }
}

export function artistLabel(artist: ArtistLike): string {
  return artist.user.name ?? artist.user.email
}

export function ArtistAvatar({ artist, className }: { artist: ArtistLike; className: string }) {
  return <FlatArtistAvatar name={artistLabel(artist)} avatarUrl={artist.user.avatarUrl} className={className} />
}

// Same rendering as ArtistAvatar, but for endpoints (GET /appointments's
// list shape) that flatten the artist to a plain { name, avatarUrl } rather
// than nesting a `user` -- avoids call sites re-deriving a fake ArtistLike
// just to reuse the image-or-initials markup.
export function FlatArtistAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string
  avatarUrl: string | null
  className: string
}) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={`${className} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${className} flex shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-fg`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

import { useEffect, useRef, useState } from 'react'
import { ArtistAvatar, artistLabel, type ArtistLike } from './ArtistAvatar'
import { ChevronDownIcon } from './icons'

export interface ArtistOption extends ArtistLike {
  id: string
}

interface ArtistSelectProps {
  id: string
  artists: ArtistOption[] | undefined
  value: string | null
  onChange: (artistId: string | null) => void
  placeholder?: string
  loadingLabel?: string
  // When set, an extra option (e.g. "Any artist" / "No preference") appears
  // at the top of the list and calls onChange(null) -- omit for a required
  // pick where clearing back to nothing selected isn't a valid state.
  clearLabel?: string
  className?: string
  disabled?: boolean
}

// Avatar-capable replacement for a native <select> of artists -- browsers
// can't render an <img> inside <option>, so every artist picker in the app
// (assign, filter, preferred-artist) goes through this one listbox instead,
// mirroring the button+listbox pattern originally built for InquiryDetail's
// "Assign Artist" picker.
export default function ArtistSelect({
  id,
  artists,
  value,
  onChange,
  placeholder = 'Select an artist',
  loadingLabel = 'Loading artists…',
  clearLabel,
  className = '',
  disabled = false,
}: ArtistSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = artists?.find((artist) => artist.id === value)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2 text-left text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <ArtistAvatar artist={selected} className="h-6 w-6" />
            <span className="truncate">{artistLabel(selected)}</span>
          </span>
        ) : (
          <span className="text-fg-muted">{artists === undefined ? loadingLabel : (clearLabel ?? placeholder)}</span>
        )}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-fg-muted" />
      </button>
      {open && artists && artists.length > 0 && (
        <ul
          role="listbox"
          aria-labelledby={id}
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface-inset py-1 shadow-lg"
        >
          {clearLabel && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-fg-muted hover:bg-surface"
              >
                {clearLabel}
              </button>
            </li>
          )}
          {artists.map((artist) => (
            <li key={artist.id}>
              <button
                type="button"
                role="option"
                aria-selected={artist.id === value}
                onClick={() => {
                  onChange(artist.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface"
              >
                <ArtistAvatar artist={artist} className="h-7 w-7" />
                <span className="min-w-0 flex-1 truncate">{artistLabel(artist)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

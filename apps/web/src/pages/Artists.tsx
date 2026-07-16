import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../context/useAuth'

interface Artist {
  id: string
  bio: string | null
  specialties: string[]
  portfolioImages: string[]
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
}

export default function Artists() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'

  const [artists, setArtists] = useState<Artist[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    async function load() {
      setError(null)

      try {
        const data = await apiFetch<Artist[]>('/artists')
        if (!ignore) setArtists(data)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view artists.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load artists')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [])

  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Artists</h1>
              <p className="mt-1 text-sm text-neutral-400">Everyone tattooing at your studio.</p>
            </div>

            {isOwner && (
              <Link
                to="/team"
                className="flex items-center gap-2 rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
              >
                Add an artist from Team
              </Link>
            )}
          </div>

          {error && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!error && artists === null && <p className="mt-6 text-sm text-neutral-400">Loading artists…</p>}

          {!error && artists !== null && artists.length === 0 && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-neutral-400">
                No artists yet.{' '}
                {isOwner
                  ? 'Add one from the Team page — their profile here is created automatically.'
                  : 'Ask a studio owner to add one from the Team page.'}
              </p>
            </div>
          )}

          {!error && artists && artists.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {artists.map((artist) => (
                <div
                  key={artist.id}
                  onClick={() => navigate(`/artists/${artist.id}`)}
                  className="cursor-pointer rounded-2xl border border-neutral-800 bg-neutral-900 p-5 transition hover:border-neutral-700"
                >
                  <div className="flex items-center gap-3">
                    {artist.user.avatarUrl ? (
                      <img
                        src={artist.user.avatarUrl}
                        alt={artist.user.name ?? artist.user.email}
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-lg font-semibold text-white">
                        {(artist.user.name ?? artist.user.email).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {artist.user.name || artist.user.email}
                      </p>
                      <p className="truncate text-xs text-neutral-500">{artist.user.email}</p>
                    </div>
                  </div>

                  {artist.bio && <p className="mt-3 line-clamp-2 text-sm text-neutral-400">{artist.bio}</p>}

                  {artist.specialties.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {artist.specialties.slice(0, 4).map((specialty) => (
                        <span
                          key={specialty}
                          className="inline-flex items-center rounded-full border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300"
                        >
                          {specialty}
                        </span>
                      ))}
                      {artist.specialties.length > 4 && (
                        <span className="inline-flex items-center px-1 text-xs text-neutral-500">
                          +{artist.specialties.length - 4} more
                        </span>
                      )}
                    </div>
                  )}

                  {artist.portfolioImages.length > 0 && (
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      {artist.portfolioImages.slice(0, 4).map((url) => (
                        <div key={url} className="aspect-square overflow-hidden rounded-lg border border-neutral-800">
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

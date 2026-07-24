import { formatDateTime } from '../lib/format'

export interface ImageDetail {
  url: string
  uploadedAt: string | null
  uploadedBy: { id: string; name: string | null; email: string } | null
}

interface ImageGridProps {
  images: string[]
  // Optional (and falls back to bare urls with no caption) purely so any
  // call site that only has a plain string[] handy still compiles -- every
  // current call site passes the resolved detail.
  details?: ImageDetail[]
  // Shared by InquiryDetail.tsx (2/4-col) and AppointmentDetail.tsx's
  // "Project details" widget (previously its own 3/6-col inline copy of
  // this exact grid+hover-caption markup) -- override to match whichever
  // column density a given widget wants.
  gridClassName?: string
}

export default function ImageGrid({ images, details, gridClassName = 'grid-cols-2 gap-3 sm:grid-cols-4' }: ImageGridProps) {
  if (images.length === 0) {
    return <p className="text-sm text-fg-secondary">None uploaded.</p>
  }

  const detailByUrl = new Map((details ?? []).map((d) => [d.url, d]))

  return (
    <div className={`grid ${gridClassName}`}>
      {images.map((url) => {
        const detail = detailByUrl.get(url)
        return (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="group relative block aspect-square overflow-hidden rounded-lg border border-border"
          >
            <img src={url} alt="" className="h-full w-full object-cover transition group-hover:opacity-80" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-[10px] leading-tight text-fg opacity-0 transition group-hover:opacity-100">
              {detail?.uploadedAt ? (
                <>
                  {formatDateTime(detail.uploadedAt)}
                  {detail.uploadedBy ? ` · ${detail.uploadedBy.name ?? detail.uploadedBy.email}` : ' · Client'}
                </>
              ) : (
                'No upload data'
              )}
            </div>
          </a>
        )
      })}
    </div>
  )
}

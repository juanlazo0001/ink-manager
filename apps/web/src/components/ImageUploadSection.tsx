import { useEffect, useRef, useState } from 'react'
import { uploadImageToCloudinary } from '../lib/cloudinary'

export interface ImageUploadState {
  urls: string[]
  uploading: boolean
}

interface UploadItem {
  id: string
  file?: File
  previewUrl: string
  status: 'uploading' | 'done' | 'error'
  url?: string
  error?: string
}

const LABEL_CLASS = 'block text-sm font-medium text-fg-secondary'

export default function ImageUploadSection({
  label,
  hint,
  initialUrls,
  onChange,
}: {
  label: string
  hint: string
  // Already-uploaded images to seed the grid with (edit mode) -- omitted
  // entirely for a fresh upload-only flow like the public intake form.
  initialUrls?: string[]
  onChange: (state: ImageUploadState) => void
}) {
  const [items, setItems] = useState<UploadItem[]>(() =>
    (initialUrls ?? []).map((url) => ({ id: crypto.randomUUID(), previewUrl: url, status: 'done' as const, url })),
  )
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    onChangeRef.current({
      urls: items.filter((item) => item.status === 'done').map((item) => item.url as string),
      uploading: items.some((item) => item.status === 'uploading'),
    })
  }, [items])

  async function uploadOne(item: UploadItem) {
    if (!item.file) return
    try {
      const url = await uploadImageToCloudinary(item.file)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'done', url } : i)))
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
            : i,
        ),
      )
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return

    const newItems: UploadItem[] = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    }))

    setItems((prev) => [...prev, ...newItems])
    newItems.forEach(uploadOne)
  }

  function handleRemove(id: string) {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id)
      // Only a freshly-picked file's previewUrl is a blob: URL needing
      // cleanup -- a seeded existing image's previewUrl is its real
      // Cloudinary URL, nothing to revoke.
      if (item?.file) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((i) => i.id !== id)
    })
  }

  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
        className="mt-2 block w-full text-sm text-fg-secondary file:mr-3 file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-raised"
      />

      {items.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-border">
              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              {item.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-fg">
                  Uploading…
                </div>
              )}
              {item.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-danger/80 p-1 text-center text-[10px] text-fg">
                  {item.error ?? 'Upload failed'}
                </div>
              )}
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-fg hover:bg-black/80"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

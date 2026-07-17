import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!ignore) setDataUrl(url)
      })
      .catch(() => {
        // No QR shown if generation fails; the code/link text is still there.
      })

    return () => {
      ignore = true
    }
  }, [value, size])

  if (!dataUrl) {
    return <div className="rounded-lg bg-surface" style={{ width: size, height: size }} />
  }

  return (
    <img
      src={dataUrl}
      alt="QR code"
      width={size}
      height={size}
      className="rounded-lg border border-border bg-white p-2"
    />
  )
}

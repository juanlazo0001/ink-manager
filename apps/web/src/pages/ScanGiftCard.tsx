import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { apiFetch, ApiError } from '../lib/api'
import { ScanIcon } from '../components/icons'

type CameraState = 'starting' | 'active' | 'denied' | 'unavailable'

interface ResolveResponse {
  recordType: string
  giftCardId?: string
  supported?: boolean
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  deposit: 'a deposit link',
  waiver: 'a waiver',
  estimate: 'an estimate',
  estimateRevision: 'an estimate revision',
  flashPayment: 'a flash prepayment link',
  selfSchedule: 'a self-schedule link',
  flashGallery: 'a flash gallery',
  intake: 'an intake form',
  policy: 'a studio policy page',
}

export default function ScanGiftCard() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const resolvingRef = useRef(false)

  const [cameraState, setCameraState] = useState<CameraState>('starting')
  const [manualCode, setManualCode] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)

  async function resolveCode(rawCode: string) {
    const trimmed = rawCode.trim()
    if (!trimmed || resolvingRef.current) return

    resolvingRef.current = true
    setResolving(true)
    setResolveError(null)

    try {
      const result = await apiFetch<ResolveResponse>(`/scan/resolve/${encodeURIComponent(trimmed)}`)

      if (result.recordType === 'giftCard' && result.giftCardId) {
        navigate(`/gift-cards/${result.giftCardId}`)
        return
      }

      if (result.supported === false) {
        setResolveError(
          `That code belongs to ${RECORD_TYPE_LABELS[result.recordType] ?? 'a record type'} the scanner doesn't handle yet.`,
        )
      } else {
        setResolveError('Code not found.')
      }
    } catch (err) {
      setResolveError(err instanceof ApiError && err.status === 404 ? 'Code not found.' : 'Something went wrong resolving that code.')
    } finally {
      resolvingRef.current = false
      setResolving(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const reader = new BrowserQRCodeReader()

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current ?? undefined,
        (result, _error, controls) => {
          if (cancelled) return
          controlsRef.current = controls
          if (result) {
            setCameraState('active')
            void resolveCode(result.getText())
            return
          }
          // Every failed decode attempt (no code in frame, blur, motion --
          // ZXing reports all of these as an Exception, most commonly
          // NotFoundException) fires this callback with `result` undefined.
          // That's expected per-frame noise while a real code drifts into
          // view, not something to surface -- the feed just keeps scanning.
          setCameraState((prev) => (prev === 'starting' ? 'active' : prev))
        },
      )
      .catch((err: unknown) => {
        if (cancelled) return
        const name = err instanceof Error ? err.name : ''
        setCameraState(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unavailable')
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveCode closes over stable refs/setters only; re-running this on every render would restart the camera stream.
  }, [])

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault()
    void resolveCode(manualCode)
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center gap-2">
        <ScanIcon className="h-5 w-5 text-accent" />
        <h1 className="text-xl font-bold text-fg">Scan</h1>
      </div>
      <p className="mt-1 text-sm text-fg-secondary">Scan a client's gift card QR, or type the code below.</p>

      <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-black">
        {cameraState !== 'denied' && cameraState !== 'unavailable' ? (
          <div className="relative aspect-square w-full">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            {cameraState === 'starting' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <p className="text-sm text-white">Starting camera…</p>
              </div>
            )}
            {resolving && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <p className="text-sm text-white">Looking up code…</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-white">
              {cameraState === 'denied' ? 'Camera access denied' : 'Camera unavailable'}
            </p>
            <p className="text-xs text-white/70">
              {cameraState === 'denied'
                ? 'Enable camera access for this site in your browser settings, or type the code below.'
                : "This device or browser doesn't support camera scanning -- type the code below instead."}
            </p>
          </div>
        )}
      </div>

      <form onSubmit={handleManualSubmit} className="mt-5">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-fg-muted">
          Enter code manually
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Code printed under the QR"
            className="flex-1 rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={resolving || !manualCode.trim()}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
          >
            Go
          </button>
        </div>
      </form>

      {resolveError && (
        <div className="mt-4 rounded-2xl card-surface border border-border bg-surface p-4">
          <p className="text-sm text-danger">{resolveError}</p>
        </div>
      )}
    </div>
  )
}

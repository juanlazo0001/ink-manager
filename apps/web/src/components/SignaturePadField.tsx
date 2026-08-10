import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import SignaturePad from 'signature_pad'
import { useTranslations } from '../i18n'

export interface SignaturePadHandle {
  isEmpty: () => boolean
  toDataURL: () => string
  clear: () => void
}

interface SignaturePadFieldProps {
  label: string
  // Parent-controlled -- shown after a failed submit attempt with an empty
  // pad, matching the label/error/clear-button layout every signing page
  // that uses this already had inline (DepositResponse.tsx originally).
  showError?: boolean
  // Fires when the built-in Clear button is pressed, so a parent showing
  // showError can dismiss it immediately (matching the original inline
  // implementation's behavior) rather than waiting for the next submit
  // attempt to re-evaluate it.
  onClear?: () => void
}

// Wraps the signature_pad library (already used by DepositResponse.tsx --
// this is that same canvas-setup/clear/toDataURL logic pulled out once a
// second real call site needed it, rather than a third copy-pasted block).
// Ref-based rather than a value+onChange prop: the parent only ever needs
// the drawn signature at submit time (toDataURL/isEmpty), never on every
// stroke, so there's no controlled-value re-render to wire up.
const SignaturePadField = forwardRef<SignaturePadHandle, SignaturePadFieldProps>(function SignaturePadField(
  { label, showError = false, onClear },
  ref,
) {
  const { t } = useTranslations()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const padRef = useRef<SignaturePad | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d')?.scale(ratio, ratio)

    const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' })
    padRef.current = pad

    return () => {
      pad.off()
      padRef.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toDataURL: () => padRef.current?.toDataURL('image/png') ?? '',
    clear: () => padRef.current?.clear(),
  }))

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-fg-secondary">{label}</label>
      <div className="overflow-hidden rounded-lg border border-border">
        <canvas ref={canvasRef} className="h-32 w-full touch-none" />
      </div>
      {showError && <p className="mt-2 text-sm text-danger">{t('common.pleaseSignBeforeSubmitting')}</p>}
      <button
        type="button"
        onClick={() => {
          padRef.current?.clear()
          onClear?.()
        }}
        className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface"
      >
        {t('common.clear')}
      </button>
    </div>
  )
})

export default SignaturePadField

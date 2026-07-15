import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SignaturePad from 'signature_pad'
import { apiFetch } from '../lib/api'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'

interface VerifyResponse {
  clientFirstName: string
  studioName: string
}

export default function SignConsentForm() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [signatureEmptyError, setSignatureEmptyError] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const signaturePadRef = useRef<SignaturePad | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false

    async function verify() {
      try {
        const data = await apiFetch<VerifyResponse>(`/consent-forms/verify/${token}`)
        if (ignore) return
        setVerifyData(data)
        setState('ready')
      } catch (err) {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : 'This link is invalid or has expired.')
        setState('invalid')
      }
    }

    verify()

    return () => {
      ignore = true
    }
  }, [token])

  useEffect(() => {
    if (state !== 'ready' || !canvasRef.current) return

    const canvas = canvasRef.current
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d')?.scale(ratio, ratio)

    const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' })
    signaturePadRef.current = pad

    return () => {
      pad.off()
      signaturePadRef.current = null
    }
  }, [state])

  function handleClear() {
    signaturePadRef.current?.clear()
    setSignatureEmptyError(false)
  }

  async function handleSubmit() {
    if (!token || !signaturePadRef.current) return

    if (signaturePadRef.current.isEmpty()) {
      setSignatureEmptyError(true)
      return
    }

    setSignatureEmptyError(false)
    setSubmitError(null)
    setSubmitting(true)

    try {
      const signatureData = signaturePadRef.current.toDataURL('image/png')

      await apiFetch(`/consent-forms/sign/${token}`, {
        method: 'PATCH',
        body: JSON.stringify({ signatureData }),
      })

      setState('success')
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Something went wrong submitting your signature. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {state === 'loading' && <p className="text-center text-sm text-gray-500">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">This link has expired</h1>
            <p className="mt-2 text-sm text-gray-500">{invalidMessage}</p>
            <p className="mt-4 text-sm text-gray-500">Please contact the studio to request a new link.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">Thank you, you're all set!</h1>
            <p className="mt-2 text-sm text-gray-500">Your signed consent form has been received.</p>
          </div>
        )}

        {state === 'ready' && verifyData && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Consent Form</h1>
            <p className="mt-1 text-sm text-gray-500">
              {verifyData.clientFirstName}, please review and sign below for {verifyData.studioName}.
            </p>

            <div className="mt-5 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
              <p>
                I understand that receiving a tattoo involves inherent risks, including but not limited to infection,
                allergic reaction, and scarring. I confirm that I am not currently under the influence of drugs or
                alcohol, that I am at least 18 years of age (or have provided applicable guardian consent), and that
                I have disclosed any relevant medical conditions to my artist. I release {verifyData.studioName} and
                its artists from liability for any complications arising from this procedure, provided reasonable
                care was taken. I understand aftercare instructions will be provided and that following them is my
                responsibility.
              </p>
            </div>

            <p className="mt-5 text-sm font-medium text-gray-700">Sign below</p>
            <div className="mt-2 overflow-hidden rounded-lg border border-gray-300">
              <canvas ref={canvasRef} className="h-40 w-full touch-none" />
            </div>

            {signatureEmptyError && <p className="mt-2 text-sm text-red-600">Please sign before submitting.</p>}
            {submitError && <p className="mt-2 text-sm text-red-600">{submitError}</p>}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleClear}
                className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

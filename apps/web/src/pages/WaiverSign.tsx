import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { formatDateTime } from '../lib/format'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import PhoneInput from '../components/PhoneInput'
import { applyThemePreset } from '../lib/themePresets'
import PublicPageFooter from '../components/PublicPageFooter'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
const LABEL_CLASS = 'block text-sm font-medium text-fg-secondary'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'

interface HealthQuestion {
  question: string
  type: 'yes_no' | 'yes_no_explain'
  explainPrompt?: string
}

interface VerifyResponse {
  studioName: string
  studioSlug: string
  themePreset: string
  appointmentStart: string
  appointmentEnd: string
  healthQuestions: HealthQuestion[]
  clauses: string[]
  acknowledgment: string | null
  photoRelease: string | null
}

interface HealthAnswerState {
  answer: 'YES' | 'NO' | ''
  explanation: string
}

function isAtLeast18(dob: string): boolean {
  const date = new Date(dob)
  if (Number.isNaN(date.getTime())) return false
  const eighteenYearsAgo = new Date()
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18)
  return date <= eighteenYearsAgo
}

export default function WaiverSign() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [data, setData] = useState<VerifyResponse | null>(null)

  const [legalName, setLegalName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [emergencyContactName, setEmergencyContactName] = useState('')
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('')
  const [healthAnswers, setHealthAnswers] = useState<Record<number, HealthAnswerState>>({})
  const [clauseInitials, setClauseInitials] = useState<Record<number, string>>({})
  const [signatureName, setSignatureName] = useState('')
  const [photoReleaseAccepted, setPhotoReleaseAccepted] = useState(false)
  const [photoReleaseSignatureName, setPhotoReleaseSignatureName] = useState('')

  const [idImagePreview, setIdImagePreview] = useState<string | null>(null)
  const [idImageUrl, setIdImageUrl] = useState<string | null>(null)
  const [idImageUploading, setIdImageUploading] = useState(false)
  const [idImageError, setIdImageError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let ignore = false

    apiFetch<VerifyResponse>(`/waivers/verify/${token}`)
      .then((result) => {
        if (ignore) return
        setData(result)
        applyThemePreset(result.themePreset)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : 'This link is invalid or has expired.')
        setState('invalid')
      })

    return () => {
      ignore = true
    }
  }, [token])

  async function handleIdImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setIdImageError(null)
    setIdImagePreview(URL.createObjectURL(file))
    setIdImageUrl(null)
    setIdImageUploading(true)

    try {
      const url = await uploadImageToCloudinary(file)
      setIdImageUrl(url)
    } catch (err) {
      setIdImageError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIdImageUploading(false)
    }
  }

  const allHealthAnswered = data
    ? data.healthQuestions.every((q, i) => {
        const entry = healthAnswers[i]
        if (!entry?.answer) return false
        if (q.type === 'yes_no_explain' && entry.answer === 'YES') return entry.explanation.trim().length > 0
        return true
      })
    : false

  const allClausesInitialed = data ? data.clauses.every((_, i) => (clauseInitials[i] ?? '').trim().length > 0) : false

  const canSubmit =
    legalName.trim().length > 0 &&
    dateOfBirth.length > 0 &&
    isAtLeast18(dateOfBirth) &&
    emergencyContactName.trim().length > 0 &&
    emergencyContactPhone.length === 10 &&
    allHealthAnswered &&
    !!idImageUrl &&
    !idImageUploading &&
    allClausesInitialed &&
    signatureName.trim().length > 0 &&
    (!photoReleaseAccepted || photoReleaseSignatureName.trim().length > 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !data) return

    setSubmitError(null)

    if (!isAtLeast18(dateOfBirth)) {
      setSubmitError('You must be 18 or older to be tattooed in North Carolina.')
      return
    }

    if (!canSubmit) {
      setSubmitError('Please complete every required field before signing.')
      return
    }

    setSubmitting(true)

    try {
      await apiFetch(`/waivers/sign/${token}`, {
        method: 'PATCH',
        body: JSON.stringify({
          legalName: legalName.trim(),
          dateOfBirth: new Date(dateOfBirth).toISOString(),
          emergencyContactName: emergencyContactName.trim(),
          emergencyContactPhone,
          healthAnswers: data.healthQuestions.map((_, i) => ({
            questionIndex: i,
            answer: healthAnswers[i]?.answer,
            explanation: healthAnswers[i]?.explanation?.trim() || undefined,
          })),
          idImageUrl,
          clauseInitials: data.clauses.map((_, i) => ({ clauseIndex: i, initials: clauseInitials[i]?.trim() })),
          signatureName: signatureName.trim(),
          photoReleaseAccepted,
          photoReleaseSignatureName: photoReleaseAccepted ? photoReleaseSignatureName.trim() : undefined,
        }),
      })

      setState('success')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-8 text-fg">
      <div className="mx-auto w-full max-w-lg">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center">
            <h1 className="text-xl font-semibold text-fg">This link isn't available</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">Please ask the front desk for a new link.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center">
            <h1 className="text-xl font-semibold text-fg">Thanks — you're all set!</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              Your waiver has been received. Please have your government ID ready for the front desk to verify.
            </p>
          </div>
        )}

        {state === 'ready' && data && (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h1 className="text-xl font-bold text-fg">Liability Waiver</h1>
            <p className="mt-1 text-sm text-fg-secondary">{data.studioName}</p>
            <p className="mt-1 text-sm text-fg-secondary">
              Appointment: {formatDateTime(data.appointmentStart)} – {formatDateTime(data.appointmentEnd)}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-fg">Personal details</h2>

                <div>
                  <label className={LABEL_CLASS}>Legal name *</label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className={LABEL_CLASS}>Date of birth *</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                  {dateOfBirth.length > 0 && !isAtLeast18(dateOfBirth) && (
                    <p className="mt-1 text-xs text-danger">
                      You must be 18 or older to be tattooed in North Carolina.
                    </p>
                  )}
                </div>

                <div>
                  <label className={LABEL_CLASS}>Emergency contact name *</label>
                  <input
                    type="text"
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className={LABEL_CLASS}>Emergency contact phone *</label>
                  <PhoneInput
                    value={emergencyContactPhone}
                    onChange={setEmergencyContactPhone}
                    required
                    className={INPUT_CLASS}
                  />
                </div>
              </section>

              <section className="space-y-4 border-t border-border pt-6">
                <h2 className="text-sm font-semibold text-fg">Health screening</h2>

                {data.healthQuestions.map((q, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <p className="text-sm text-fg">{q.question} *</p>
                    <div className="mt-2 flex gap-4">
                      {(['YES', 'NO'] as const).map((option) => (
                        <label key={option} className="flex items-center gap-2 text-sm text-fg-secondary">
                          <input
                            type="radio"
                            name={`health-${i}`}
                            checked={healthAnswers[i]?.answer === option}
                            onChange={() =>
                              setHealthAnswers({
                                ...healthAnswers,
                                [i]: { answer: option, explanation: healthAnswers[i]?.explanation ?? '' },
                              })
                            }
                            required
                            className="accent-accent"
                          />
                          {option === 'YES' ? 'Yes' : 'No'}
                        </label>
                      ))}
                    </div>

                    {q.type === 'yes_no_explain' && healthAnswers[i]?.answer === 'YES' && (
                      <textarea
                        rows={2}
                        placeholder={q.explainPrompt ?? 'Please explain'}
                        value={healthAnswers[i]?.explanation ?? ''}
                        onChange={(e) =>
                          setHealthAnswers({
                            ...healthAnswers,
                            [i]: { answer: 'YES', explanation: e.target.value },
                          })
                        }
                        className={`${INPUT_CLASS} mt-2`}
                      />
                    )}
                  </div>
                ))}
              </section>

              <section className="space-y-3 border-t border-border pt-6">
                <h2 className="text-sm font-semibold text-fg">Photo ID</h2>
                <p className="text-xs text-fg-muted">Take or upload a clear photo of your government-issued ID.</p>

                {idImagePreview && (
                  <img src={idImagePreview} alt="ID preview" className="max-h-48 rounded-lg border border-border" />
                )}

                <label className="inline-block cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface">
                  {idImageUrl ? 'Change photo' : 'Upload ID photo'}
                  <input type="file" accept="image/*" capture="environment" onChange={handleIdImageChange} className="hidden" />
                </label>

                {idImageUploading && <p className="text-xs text-fg-secondary">Uploading…</p>}
                {idImageError && <p className="text-xs text-danger">{idImageError}</p>}
              </section>

              <section className="space-y-3 border-t border-border pt-6">
                <h2 className="text-sm font-semibold text-fg">Please read and initial each clause</h2>

                {data.clauses.map((clause, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <p className="text-sm text-fg-secondary">{clause}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-fg-muted">Initials *</label>
                      <input
                        type="text"
                        maxLength={6}
                        value={clauseInitials[i] ?? ''}
                        onChange={(e) => setClauseInitials({ ...clauseInitials, [i]: e.target.value })}
                        className="w-20 rounded-lg border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                ))}
              </section>

              {data.acknowledgment && (
                <section className="space-y-2 border-t border-border pt-6">
                  <h2 className="text-sm font-semibold text-fg">Acknowledgment</h2>
                  {/* acknowledgmentSnapshot may hold rich HTML (Phase UI-3's
                      WYSIWYG editor) or older plain text -- sanitized either way. */}
                  <div
                    className="tiptap-content whitespace-pre-wrap text-sm text-fg-secondary"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.acknowledgment) }}
                  />
                </section>
              )}

              <section className="border-t border-border pt-6">
                <label className={LABEL_CLASS}>Signature — type your full legal name *</label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  required
                  className={INPUT_CLASS}
                />
              </section>

              {data.photoRelease && (
                <section className="space-y-3 rounded-lg border border-border p-4">
                  <h2 className="text-sm font-semibold text-fg">Photo/video release (optional)</h2>
                  <p className="text-xs text-fg-muted">
                    Optional — you may decline without affecting your appointment.
                  </p>
                  <div
                    className="tiptap-content whitespace-pre-wrap text-sm text-fg-secondary"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.photoRelease) }}
                  />

                  <label className="flex items-start gap-2 text-sm text-fg-secondary">
                    <input
                      type="checkbox"
                      checked={photoReleaseAccepted}
                      onChange={(e) => setPhotoReleaseAccepted(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-inset accent-accent"
                    />
                    I agree to the photo/video release above
                  </label>

                  {photoReleaseAccepted && (
                    <div>
                      <label className={LABEL_CLASS}>Signature for photo release *</label>
                      <input
                        type="text"
                        value={photoReleaseSignatureName}
                        onChange={(e) => setPhotoReleaseSignatureName(e.target.value)}
                        className={INPUT_CLASS}
                      />
                    </div>
                  )}
                </section>
              )}

              {submitError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Sign Waiver'}
              </button>
            </form>
          </div>
        )}

        <PublicPageFooter studioSlug={data?.studioSlug} />
      </div>
    </div>
  )
}

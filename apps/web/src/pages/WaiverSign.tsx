import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { formatDateTime } from '../lib/format'
import { parseDateString } from '../components/DateAndTimeRangeFields'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import PhoneInput from '../components/PhoneInput'
import { applyThemePreset } from '../lib/themePresets'
import PublicPageFooter from '../components/PublicPageFooter'
import SignaturePadField, { type SignaturePadHandle } from '../components/SignaturePadField'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'

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
  resolvedLocale?: string
}

interface HealthAnswerState {
  answer: 'YES' | 'NO' | ''
  explanation: string
}

// `dob` is a bare "YYYY-MM-DD" from a native <input type="date"> --
// parsed via parseDateString (LOCAL Y/M/D components), never `new
// Date(dob)` (UTC midnight), so this compares two local calendar dates
// instead of mixing a UTC-parsed instant against a real local "now."
function isAtLeast18(dob: string): boolean {
  const date = parseDateString(dob)
  if (!date) return false
  const eighteenYearsAgo = new Date()
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18)
  return date <= eighteenYearsAgo
}

export default function WaiverSign() {
  return (
    <LocaleProvider>
      <WaiverSignContent />
    </LocaleProvider>
  )
}

function WaiverSignContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState(t('common.linkExpiredHeading'))
  const [data, setData] = useState<VerifyResponse | null>(null)

  const [legalName, setLegalName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [emergencyContactName, setEmergencyContactName] = useState('')
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('')
  const [healthAnswers, setHealthAnswers] = useState<Record<number, HealthAnswerState>>({})
  const [clauseInitials, setClauseInitials] = useState<Record<number, string>>({})
  const [signatureName, setSignatureName] = useState('')
  const [signatureEmptyError, setSignatureEmptyError] = useState(false)
  const signaturePadRef = useRef<SignaturePadHandle | null>(null)
  const [photoReleaseAccepted, setPhotoReleaseAccepted] = useState(false)
  const [photoReleaseSignatureName, setPhotoReleaseSignatureName] = useState('')
  const [photoReleaseSignatureEmptyError, setPhotoReleaseSignatureEmptyError] = useState(false)
  const photoReleaseSignaturePadRef = useRef<SignaturePadHandle | null>(null)

  const [idImagePreview, setIdImagePreview] = useState<string | null>(null)
  const [idImageUrl, setIdImageUrl] = useState<string | null>(null)
  const [idImageUploading, setIdImageUploading] = useState(false)
  const [idImageError, setIdImageError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Language becomes customer-specific: no picker on this page anymore --
  // resolvedLocale comes purely from the server (client's own stored
  // preference, else Accept-Language), synced once on load.
  useEffect(() => {
    if (!token) return
    let ignore = false

    apiFetch<VerifyResponse>(`/waivers/verify/${token}`)
      .then((result) => {
        if (ignore) return
        setData(result)
        applyThemePreset(result.themePreset)
        setState('ready')
        if (result.resolvedLocale && result.resolvedLocale !== locale) setLocale(result.resolvedLocale as typeof locale)
      })
      .catch((err) => {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : t('common.linkExpiredHeading'))
        setState('invalid')
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setIdImageError(err instanceof Error ? err.message : t('waiver.uploadFailed'))
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
      setSubmitError(t('waiver.ageRequirement'))
      return
    }

    if (!canSubmit) {
      setSubmitError(t('waiver.pleaseCompleteEveryField'))
      return
    }

    if (!signaturePadRef.current || signaturePadRef.current.isEmpty()) {
      setSignatureEmptyError(true)
      setSubmitError(t('common.pleaseSignBeforeSubmitting'))
      return
    }

    if (
      photoReleaseAccepted &&
      (!photoReleaseSignaturePadRef.current || photoReleaseSignaturePadRef.current.isEmpty())
    ) {
      setPhotoReleaseSignatureEmptyError(true)
      setSubmitError(t('waiver.pleaseSignPhotoRelease'))
      return
    }

    setSignatureEmptyError(false)
    setPhotoReleaseSignatureEmptyError(false)
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
          signatureData: signaturePadRef.current.toDataURL(),
          photoReleaseAccepted,
          photoReleaseSignatureName: photoReleaseAccepted ? photoReleaseSignatureName.trim() : undefined,
          photoReleaseSignatureData: photoReleaseAccepted
            ? photoReleaseSignaturePadRef.current!.toDataURL()
            : undefined,
        }),
      })

      setState('success')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-8 text-fg">
      <div className="mx-auto w-full max-w-lg">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">{t('common.loading')}</p>}

        {state === 'invalid' && (
          <div className="rounded-2xl card-surface border border-border bg-surface p-6 text-center">
            <h1 className="text-xl font-semibold text-fg">{t('waiver.linkUnavailableHeading')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">{t('waiver.linkUnavailableBody')}</p>
          </div>
        )}

        {state === 'success' && (
          <div className="rounded-2xl card-surface border border-border bg-surface p-6 text-center">
            <h1 className="text-xl font-semibold text-fg">{t('waiver.receivedHeading')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{t('waiver.receivedBody')}</p>
          </div>
        )}

        {state === 'ready' && data && (
          <div className="rounded-2xl card-surface border border-border bg-surface p-5">
            <h1 className="text-xl font-bold text-fg">{t('waiver.pageHeading')}</h1>
            <p className="mt-1 text-sm text-fg-secondary">{data.studioName}</p>
            <p className="mt-1 text-sm text-fg-secondary">
              {t('waiver.appointmentRange', {
                start: formatDateTime(data.appointmentStart, locale),
                end: formatDateTime(data.appointmentEnd, locale),
              })}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-fg">{t('waiver.personalDetails')}</h2>

                <div>
                  <label className={LABEL_CLASS}>{t('waiver.legalName')}</label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className={LABEL_CLASS}>{t('waiver.dateOfBirth')}</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                  {dateOfBirth.length > 0 && !isAtLeast18(dateOfBirth) && (
                    <p className="mt-1 text-xs text-danger">{t('waiver.ageRequirement')}</p>
                  )}
                </div>

                <div>
                  <label className={LABEL_CLASS}>{t('waiver.emergencyContactName')}</label>
                  <input
                    type="text"
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    required
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className={LABEL_CLASS}>{t('waiver.emergencyContactPhone')}</label>
                  <PhoneInput
                    value={emergencyContactPhone}
                    onChange={setEmergencyContactPhone}
                    required
                    className={INPUT_CLASS}
                  />
                </div>
              </section>

              <section className="space-y-4 border-t border-border pt-6">
                <h2 className="text-sm font-semibold text-fg">{t('waiver.healthScreening')}</h2>

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
                          {option === 'YES' ? t('intake.yesOption') : t('intake.noOption')}
                        </label>
                      ))}
                    </div>

                    {q.type === 'yes_no_explain' && healthAnswers[i]?.answer === 'YES' && (
                      <textarea
                        rows={2}
                        placeholder={q.explainPrompt ?? t('waiver.explainPlaceholder')}
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
                <h2 className="text-sm font-semibold text-fg">{t('waiver.photoId')}</h2>
                <p className="text-xs text-fg-muted">{t('waiver.photoIdHint')}</p>

                {idImagePreview && (
                  <img src={idImagePreview} alt="ID preview" className="max-h-48 rounded-lg border border-border" />
                )}

                <label className="inline-block cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface">
                  {idImageUrl ? t('waiver.changePhoto') : t('waiver.uploadIdPhoto')}
                  <input type="file" accept="image/*" capture="environment" onChange={handleIdImageChange} className="hidden" />
                </label>

                {idImageUploading && <p className="text-xs text-fg-secondary">{t('waiver.uploading')}</p>}
                {idImageError && <p className="text-xs text-danger">{idImageError}</p>}
              </section>

              <section className="space-y-3 border-t border-border pt-6">
                <h2 className="text-sm font-semibold text-fg">{t('waiver.readAndInitial')}</h2>

                {data.clauses.map((clause, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <p className="text-sm text-fg-secondary">{clause}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-fg-muted">{t('waiver.initials')}</label>
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
                  <h2 className="text-sm font-semibold text-fg">{t('waiver.acknowledgment')}</h2>
                  {/* acknowledgmentSnapshot may hold rich HTML (Phase UI-3's
                      WYSIWYG editor) or older plain text -- sanitized either way. */}
                  <div
                    className="tiptap-content whitespace-pre-wrap text-sm text-fg-secondary"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.acknowledgment) }}
                  />
                </section>
              )}

              <section className="space-y-3 border-t border-border pt-6">
                <label className={LABEL_CLASS}>{t('waiver.signatureLabel')}</label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  required
                  className={INPUT_CLASS}
                />
                <SignaturePadField
                  ref={signaturePadRef}
                  label={t('waiver.signBelowRequired')}
                  showError={signatureEmptyError}
                  onClear={() => setSignatureEmptyError(false)}
                />
              </section>

              {data.photoRelease && (
                <section className="space-y-3 rounded-lg border border-border p-4">
                  <h2 className="text-sm font-semibold text-fg">{t('waiver.photoReleaseHeading')}</h2>
                  <p className="text-xs text-fg-muted">{t('waiver.photoReleaseHint')}</p>
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
                    {t('waiver.photoReleaseAgree')}
                  </label>

                  {photoReleaseAccepted && (
                    <div className="space-y-3">
                      <label className={LABEL_CLASS}>{t('waiver.photoReleaseSignatureLabel')}</label>
                      <input
                        type="text"
                        value={photoReleaseSignatureName}
                        onChange={(e) => setPhotoReleaseSignatureName(e.target.value)}
                        className={INPUT_CLASS}
                      />
                      <SignaturePadField
                        ref={photoReleaseSignaturePadRef}
                        label={t('waiver.signBelowRequired')}
                        showError={photoReleaseSignatureEmptyError}
                        onClear={() => setPhotoReleaseSignatureEmptyError(false)}
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
                {submitting ? t('waiver.submitting') : t('waiver.signWaiver')}
              </button>
            </form>
          </div>
        )}

        <PublicPageFooter studioSlug={data?.studioSlug} />
      </div>
    </div>
  )
}

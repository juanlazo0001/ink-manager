import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatPhoneInput } from '../lib/format'

interface LiveIntakeField {
  id: string
  fieldKind: 'SYSTEM' | 'CUSTOM'
  systemFieldKey: string | null
  customQuestionType: string | null
  label: string
  enabled: boolean
  order: number
}

interface InquiryForDetails {
  channel: string
  description: string
  colorOrBlackGrey: string
  placement: string
  estimatedSize: string
  hasBeenTattooedBefore: boolean
  budget: string | null
  desiredTiming: string | null
  customFieldAnswers: Record<string, { question: string; type: string; answer: string | string[] }> | null
  client: { firstName: string; lastName: string; email: string | null; phone: string | null }
  preferredArtist: { user: { name: string | null; email: string } } | null
}

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  PHONE: 'Phone',
  REFERRAL: 'Referral',
}

// Same key set POST /inquiries and the Settings field editor both use --
// pulls straight off the real Inquiry/Client columns (the "core safety
// property" columns this whole package left untouched), just formatted
// for display.
function systemFieldValue(key: string, inquiry: InquiryForDetails): string {
  switch (key) {
    case 'name':
      return `${inquiry.client.firstName} ${inquiry.client.lastName}`.trim() || 'Not provided'
    case 'email':
      return inquiry.client.email || 'Not provided'
    case 'phone':
      return inquiry.client.phone ? formatPhoneInput(inquiry.client.phone) : 'Not provided'
    case 'referralSource':
      return CHANNEL_LABELS[inquiry.channel] ?? inquiry.channel
    case 'description':
      return inquiry.description || 'Not provided'
    case 'colorOrBlackGrey':
      return inquiry.colorOrBlackGrey || 'Not provided'
    case 'placement':
      return inquiry.placement || 'Not provided'
    case 'size':
      return inquiry.estimatedSize || 'Not provided'
    case 'hasBeenTattooedBefore':
      return inquiry.hasBeenTattooedBefore ? 'Yes' : 'No'
    case 'preferredArtist':
      return inquiry.preferredArtist?.user.name || inquiry.preferredArtist?.user.email || 'No preference'
    case 'budget':
      return inquiry.budget ?? 'Not provided'
    case 'desiredTiming':
      return inquiry.desiredTiming ?? 'Not provided'
    default:
      return '—'
  }
}

function formatCustomAnswer(answer: { type: string; answer: string | string[] }): string {
  if (Array.isArray(answer.answer)) return answer.answer.join(', ') || 'Not provided'
  if (answer.type === 'YES_NO') return answer.answer === 'YES' ? 'Yes' : 'No'
  return answer.answer
}

// Package Q (revised) §5: one unified view of every field on this studio's
// CURRENT intake form (system + custom, in its current order/labels) --
// deliberately supplements, not replaces, the existing "Tattoo details" /
// "Reference images" / "Placement photos" cards elsewhere on this page.
// Those stay because they're editable case-management tools tied directly
// to the real Inquiry columns (staff can revise them after intake, e.g. a
// price renegotiation), a different job from this read-only "here's
// exactly what the client saw and answered" snapshot. referenceImages/
// placementImages are skipped here for the same reason -- their own cards
// already render real thumbnails with an edit affordance; a text-only
// "N image(s)" row here would just be a worse duplicate. Custom answers
// still render straight from their own self-contained snapshot
// (question/type/answer, captured at submission) even if the question was
// since edited or deleted -- an orphaned answer (question deleted, no
// longer in the live field list) has no current position to sort by, so
// it's appended at the end under its original label.
export default function InquiryDetailsSection({ inquiry }: { inquiry: InquiryForDetails }) {
  const [fields, setFields] = useState<LiveIntakeField[] | null>(null)

  useEffect(() => {
    let ignore = false
    apiFetch<LiveIntakeField[]>('/studio-settings/intake-form-fields')
      .then((data) => {
        if (!ignore) setFields(data.filter((f) => f.enabled).sort((a, b) => a.order - b.order))
      })
      .catch(() => {
        /* Section just doesn't render if this fails; not critical page content. */
      })
    return () => {
      ignore = true
    }
  }, [])

  if (!fields) return null

  const rows: { key: string; label: string; value: string }[] = []

  for (const field of fields) {
    if (field.fieldKind === 'SYSTEM' && field.systemFieldKey) {
      if (field.systemFieldKey === 'referenceImages' || field.systemFieldKey === 'placementImages') continue
      rows.push({ key: field.id, label: field.label, value: systemFieldValue(field.systemFieldKey, inquiry) })
    } else if (field.fieldKind === 'CUSTOM') {
      const answer = inquiry.customFieldAnswers?.[field.id]
      if (!answer) continue
      rows.push({ key: field.id, label: field.label, value: formatCustomAnswer(answer) })
    }
  }

  const liveCustomIds = new Set(fields.filter((f) => f.fieldKind === 'CUSTOM').map((f) => f.id))
  for (const [id, answer] of Object.entries(inquiry.customFieldAnswers ?? {})) {
    if (liveCustomIds.has(id)) continue
    rows.push({ key: id, label: answer.question, value: formatCustomAnswer(answer) })
  }

  if (rows.length === 0) return null

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">Inquiry Details</h2>
      <p className="mt-0.5 text-xs text-fg-secondary">
        Every field from this studio's intake form, in its current configured order and labels.
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="text-xs font-medium uppercase tracking-wider text-fg-muted">{row.label}</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

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
  // Which of the studio's (possibly several) named forms this was
  // submitted through -- null for anything predating multiple forms, or a
  // staff-logged walk-in with no form context. Drives which form's live
  // field list this section maps the answers onto (see the effect below).
  intakeFormId: string | null
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

// Defensive by construction, same discipline as AuditTrail.tsx's own
// formatValue (the "AuditTrail crash fix"): a historical snapshot's answer
// always renders from its OWN captured `type` (immutable at submission,
// see the Inquiry.customFieldAnswers doc comment), never the field's
// current/live customQuestionType -- so retyping a field after the fact
// (e.g. YES_NO -> SELECT) can never make an old answer mismatch what this
// function expects. This still guards the shape defensively regardless,
// since `answer` is untrusted historical JSON, not a value this app's own
// current type system can vouch for (an old pre-Package-Q row, or any
// future data drift, could have `answer` in a shape this function's own
// declared parameter type doesn't actually guarantee at runtime) -- a
// genuinely unexpected shape (e.g. an object where a string was expected)
// falls back to JSON.stringify rather than ever handing a raw object to
// React as a child, which would crash the page.
function formatCustomAnswer(answer: { type: string; answer: unknown }): string {
  const raw = answer.answer

  if (Array.isArray(raw)) {
    if (raw.every((v) => typeof v === 'string')) return raw.join(', ') || 'Not provided'
    return JSON.stringify(raw)
  }

  if (typeof raw === 'string') {
    // 'yes_no' (lowercase) is the pre-Package-Q-revised type string, still
    // baked into any snapshot taken before this migration -- both spellings
    // are checked so an old and a new YES_NO answer render identically.
    if (answer.type === 'YES_NO' || answer.type === 'yes_no') return raw === 'YES' ? 'Yes' : 'No'
    return raw || 'Not provided'
  }

  if (raw === null || raw === undefined) return 'Not provided'
  if (typeof raw === 'object') return JSON.stringify(raw)
  return String(raw)
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
interface InquiryDetailsSectionProps {
  inquiry: InquiryForDetails
  // True when wrapped in the page's own <Widget> -- skips this
  // component's own card/title. Unlike InquiryNotesSection's canManage,
  // whether this section has anything to show is only known once its own
  // fetch resolves (this studio's live intake fields, cross-referenced
  // against this inquiry's answers) -- onVisibilityChange reports that
  // back to the parent so it can decide whether to render the Widget
  // wrapper at all, same "hide entirely when empty" behavior as before
  // this was wrapped, just decided one level up.
  bare?: boolean
  onVisibilityChange?: (visible: boolean) => void
}

export default function InquiryDetailsSection({ inquiry, bare = false, onVisibilityChange }: InquiryDetailsSectionProps) {
  const [fields, setFields] = useState<LiveIntakeField[] | null>(null)

  // Maps this inquiry's answers onto the SAME form it was actually
  // submitted through (inquiry.intakeFormId) when known. Older inquiries
  // (predating multiple named forms) and staff-logged walk-ins have no
  // form recorded -- for those, falls back to the studio's current default
  // form, matching this section's own pre-multiple-forms behavior exactly
  // (there was only ever one studio-wide list before).
  useEffect(() => {
    let ignore = false

    async function load() {
      const formId =
        inquiry.intakeFormId ??
        (await apiFetch<{ id: string; isDefault: boolean }[]>('/intake-forms')).find((f) => f.isDefault)?.id

      if (!formId) return
      const data = await apiFetch<LiveIntakeField[]>(`/intake-forms/${formId}/fields`)
      if (!ignore) setFields(data.filter((f) => f.enabled).sort((a, b) => a.order - b.order))
    }

    load().catch(() => {
      /* Section just doesn't render if this fails; not critical page content. */
    })
    return () => {
      ignore = true
    }
  }, [inquiry.intakeFormId])

  const rows: { key: string; label: string; value: string }[] = []

  if (fields) {
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
  }

  const isVisible = rows.length > 0

  // Only reports once `fields` has actually loaded -- otherwise the very
  // first render (fields still null, rows still empty) reports isVisible:
  // false before the fetch above ever resolves, which flips the parent's
  // conditional wrapper off and unmounts this component before it gets a
  // chance to compute the real answer (a genuine "photos never show up"
  // bug, caught while verifying Powder Brows candidacy-review photos
  // actually render here).
  useEffect(() => {
    if (fields === null) return
    onVisibilityChange?.(isVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, isVisible])

  if (!fields || !isVisible) return null

  const content = (
    <>
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
    </>
  )

  if (bare) return content

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">Inquiry Details</h2>
      {content}
    </div>
  )
}

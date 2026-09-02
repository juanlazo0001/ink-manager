import { apiFetch } from '@/lib/api';

/**
 * The studio's CONFIGURED intake form, rendered as it is configured.
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────
 *
 * Mobile's "The request" listed seven hardcoded fields. Web renders every
 * field of the form the inquiry was actually submitted through, in that
 * form's order, with that form's labels — system fields AND the studio's
 * own custom questions.
 *
 * A hardcoded list is not merely incomplete, it is arbitrarily wrong: for
 * the dev studio it already omitted "How did you hear about us?" and
 * "Preferred artist", and a studio that reorders its form, renames a
 * label, disables a field or adds a custom question got none of that on
 * the phone while web showed all of it.
 *
 * ─── NOT NEW API SURFACE ────────────────────────────────────────────
 *
 *     GET /intake-forms                  the studio's forms
 *     GET /intake-forms/:id/fields       that form's live field list
 *
 * Both exist, both are `requireRole(OWNER, FRONT_DESK, ARTIST)`, and both
 * are what `apps/web/src/components/InquiryDetailsSection.tsx` calls. The
 * rules below are that component's, ported rather than reinvented.
 */

export interface IntakeField {
  id: string;
  fieldKind: 'SYSTEM' | 'CUSTOM';
  systemFieldKey: string | null;
  customQuestionType: string | null;
  label: string;
  enabled: boolean;
  order: number;
}

export interface CustomAnswer {
  question: string;
  type: string;
  answer: unknown;
}

/** Everything the row builder reads off the inquiry. */
export interface IntakeSource {
  channel?: string | null;
  description?: string | null;
  colorOrBlackGrey?: string | null;
  placement?: string | null;
  estimatedSize?: string | null;
  hasBeenTattooedBefore?: boolean | null;
  budget?: string | null;
  clientStatedBudget?: string | null;
  desiredTiming?: string | null;
  customFieldAnswers?: Record<string, CustomAnswer> | null;
  intakeFormId?: string | null;
  preferredArtist?: { id: string; user?: { name: string | null; email: string; avatarUrl?: string | null } | null } | null;
}

/**
 * The form this inquiry was submitted through, or the studio's default.
 *
 * Older inquiries (predating multiple named forms) and staff-logged
 * walk-ins have no `intakeFormId`. Web falls back to the default form for
 * exactly those, which reproduces its own pre-multiple-forms behaviour;
 * the same fallback is here so the two clients never map the same answers
 * onto different forms.
 */
export async function fetchIntakeFields(
  token: string,
  intakeFormId: string | null | undefined,
  signal?: AbortSignal,
): Promise<IntakeField[]> {
  let formId = intakeFormId ?? null;
  if (!formId) {
    const forms = await apiFetch<{ id: string; isDefault: boolean }[]>('/intake-forms', { token, signal });
    formId = forms.find((f) => f.isDefault)?.id ?? null;
  }
  if (!formId) return [];
  const fields = await apiFetch<IntakeField[]>(
    `/intake-forms/${encodeURIComponent(formId)}/fields`,
    { token, signal },
  );
  return fields.filter((f) => f.enabled).sort((a, b) => a.order - b.order);
}

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  PHONE: 'Phone',
  REFERRAL: 'Referral',
};

/** Web's `systemFieldValue`, key for key. */
function systemFieldValue(key: string, inq: IntakeSource): string {
  switch (key) {
    case 'referralSource':
      return inq.channel ? (CHANNEL_LABELS[inq.channel] ?? inq.channel) : 'Not provided';
    case 'description':
      return inq.description || 'Not provided';
    case 'colorOrBlackGrey':
      return inq.colorOrBlackGrey || 'Not provided';
    case 'placement':
      return inq.placement || 'Not provided';
    case 'size':
      return inq.estimatedSize || 'Not provided';
    case 'hasBeenTattooedBefore':
      return inq.hasBeenTattooedBefore ? 'Yes' : 'No';
    case 'budget':
      return inq.clientStatedBudget ?? inq.budget ?? 'Not provided';
    case 'desiredTiming':
      return inq.desiredTiming ?? 'Not provided';
    default:
      /*
       * An UNKNOWN system key renders its label with an em dash rather
       * than vanishing — web's own default branch. A field the server
       * adds tomorrow shows up as a row somebody can see and ask about,
       * instead of silently not existing on one client.
       */
      return '—';
  }
}

/**
 * Web's `formatCustomAnswer`, including the reason it is defensive.
 *
 * An answer renders from its OWN captured `type`, immutable at
 * submission, never the field's current type — so retyping a question
 * after the fact cannot make an old answer render wrongly. The shape is
 * still guarded, because this is untrusted historical JSON: anything
 * unexpected becomes a string rather than being handed to a `<Text>` as
 * an object.
 */
export function formatCustomAnswer(answer: CustomAnswer): string {
  const raw = answer.answer;
  if (Array.isArray(raw)) {
    if (raw.every((v) => typeof v === 'string')) return raw.join(', ') || 'Not provided';
    return JSON.stringify(raw);
  }
  if (typeof raw === 'string') {
    // 'yes_no' lowercase is the pre-revision spelling, still baked into
    // older snapshots. Both are checked so old and new render alike.
    if (answer.type === 'YES_NO' || answer.type === 'yes_no') return raw === 'YES' ? 'Yes' : 'No';
    return raw || 'Not provided';
  }
  if (raw === null || raw === undefined) return 'Not provided';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

export type IntakeRow =
  | { key: string; label: string; kind: 'text'; value: string }
  | { key: string; label: string; kind: 'artist'; artist: IntakeSource['preferredArtist'] };

/**
 * The rows to render, in the form's own order. Web's rules exactly:
 *
 *   · reference/placement images are SKIPPED — they have their own strip
 *     with a viewer, and a "1 image" text row would be a worse duplicate
 *   · name/email/phone are SKIPPED — the header card above already shows
 *     them, and repeating them is the duplication web removed
 *   · preferredArtist gets an avatar row, not plain text
 *   · custom answers come from the inquiry's own snapshot
 *   · an ORPHANED answer — its question since deleted, so it has no
 *     position to sort by — is appended at the end under its original
 *     label, rather than disappearing with the question
 */
export function buildIntakeRows(fields: IntakeField[], inq: IntakeSource): IntakeRow[] {
  const rows: IntakeRow[] = [];

  for (const field of fields) {
    if (field.fieldKind === 'SYSTEM' && field.systemFieldKey) {
      const key = field.systemFieldKey;
      if (key === 'referenceImages' || key === 'placementImages') continue;
      if (key === 'name' || key === 'email' || key === 'phone') continue;
      if (key === 'preferredArtist') {
        rows.push({ key: field.id, label: field.label, kind: 'artist', artist: inq.preferredArtist ?? null });
        continue;
      }
      rows.push({ key: field.id, label: field.label, kind: 'text', value: systemFieldValue(key, inq) });
    } else if (field.fieldKind === 'CUSTOM') {
      const answer = inq.customFieldAnswers?.[field.id];
      if (!answer) continue;
      rows.push({ key: field.id, label: field.label, kind: 'text', value: formatCustomAnswer(answer) });
    }
  }

  const liveCustomIds = new Set(fields.filter((f) => f.fieldKind === 'CUSTOM').map((f) => f.id));
  for (const [id, answer] of Object.entries(inq.customFieldAnswers ?? {})) {
    if (liveCustomIds.has(id)) continue;
    rows.push({ key: id, label: answer.question, kind: 'text', value: formatCustomAnswer(answer) });
  }

  return rows;
}

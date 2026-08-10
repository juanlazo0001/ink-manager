import { prisma } from "./prisma";
import { IntakeFieldKind, IntakeCustomQuestionType } from "../../generated/prisma/enums";
import { isSupportedLocale } from "./locale";

export interface SystemFieldDefault {
  key: string;
  label: string;
  required: boolean;
}

// Default order/labels/required exactly matching IntakeForm.tsx's
// hardcoded field order as it existed before this package -- a studio
// that never touches the builder sees zero change to their public form.
export const SYSTEM_FIELD_DEFAULTS: SystemFieldDefault[] = [
  { key: "name", label: "Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "referralSource", label: "How did you hear about us?", required: true },
  { key: "description", label: "Describe the tattoo you want", required: true },
  { key: "colorOrBlackGrey", label: "Color or Black & Grey?", required: true },
  { key: "placement", label: "Placement", required: true },
  { key: "size", label: "Estimated size", required: true },
  { key: "hasBeenTattooedBefore", label: "Have you been tattooed before?", required: true },
  { key: "preferredArtist", label: "Preferred artist", required: false },
  { key: "budget", label: "Budget", required: false },
  { key: "desiredTiming", label: "Desired timing", required: false },
  { key: "referenceImages", label: "Reference images", required: true },
  { key: "placementImages", label: "Placement photos", required: true },
];

export const SYSTEM_FIELD_KEYS = SYSTEM_FIELD_DEFAULTS.map((f) => f.key);

// The one place both the public form (GET /studio-settings/public) and
// submission validation (POST /inquiries) get a FORM's field list from --
// keeps their "form has zero rows yet" fallback identical, so a
// brand-new form (just created, not yet opened in the field editor) never
// sees the public form and the server-side validator disagree about what's
// required. Scoped by intakeFormId, not studioId -- see IntakeForm's own
// doc comment for why the field list moved from per-studio to per-form.
export async function getEffectiveIntakeFormFields(intakeFormId: string) {
  const fields = await prisma.intakeFormField.findMany({
    where: { intakeFormId },
    orderBy: { order: "asc" },
  });
  if (fields.length > 0) return fields;

  return SYSTEM_FIELD_DEFAULTS.map((f, i) => ({
    id: f.key,
    fieldKind: IntakeFieldKind.SYSTEM,
    systemFieldKey: f.key as string | null,
    customQuestionType: null as IntakeCustomQuestionType | null,
    label: f.label,
    helpText: null as string | null,
    required: f.required,
    enabled: true,
    options: null as unknown,
    order: i,
  }));
}

// A studio needs SOME way to identify and reach a submitter -- enforced
// here, server-side, on every write to this table (not just a UI-level
// disabled toggle). name can never be disabled; email and phone can each
// be disabled individually, just never BOTH at once.
export function validateFieldListConstraint(
  fields: { systemFieldKey: string | null; enabled: boolean }[],
): string | null {
  const byKey = new Map(fields.filter((f) => f.systemFieldKey).map((f) => [f.systemFieldKey as string, f]));

  const name = byKey.get("name");
  if (name && !name.enabled) {
    return "The name field cannot be disabled -- a studio needs some way to identify who submitted the form.";
  }

  const emailEnabled = byKey.get("email")?.enabled ?? false;
  const phoneEnabled = byKey.get("phone")?.enabled ?? false;
  if (!emailEnabled && !phoneEnabled) {
    return "At least one contact method (email or phone) must stay enabled.";
  }

  return null;
}

// Idempotent -- only creates rows for a FORM with zero SYSTEM rows, so
// re-running this (a fresh dev seed, opening a brand-new form's field
// editor for the first time) never duplicates a form's fields or clobbers
// customizations already made on top of the defaults.
export async function ensureDefaultSystemFields(studioId: string, intakeFormId: string): Promise<number> {
  const existingCount = await prisma.intakeFormField.count({
    where: { intakeFormId, fieldKind: IntakeFieldKind.SYSTEM },
  });
  if (existingCount > 0) return 0;

  await prisma.intakeFormField.createMany({
    data: SYSTEM_FIELD_DEFAULTS.map((f, i) => ({
      studioId,
      intakeFormId,
      fieldKind: IntakeFieldKind.SYSTEM,
      systemFieldKey: f.key,
      label: f.label,
      required: f.required,
      enabled: true,
      order: i,
    })),
  });

  return SYSTEM_FIELD_DEFAULTS.length;
}

export interface IntakeFormFieldInput {
  id?: string;
  fieldKind: string;
  systemFieldKey?: string | null;
  customQuestionType?: string | null;
  label: string;
  helpText?: string | null;
  required: boolean;
  enabled: boolean;
  options?: unknown;
  // Multi-language public forms, Part 6: keyed by locale, matching every
  // other translatable entity's PATCH shape -- only label/helpText/options
  // have a column on IntakeFormFieldTranslation.
  translations?: Record<string, { label?: string | null; helpText?: string | null; options?: unknown }>;
}

const CUSTOM_TYPES = new Set(Object.values(IntakeCustomQuestionType) as string[]);
const OPTION_TYPES = new Set([IntakeCustomQuestionType.SELECT, IntakeCustomQuestionType.MULTI_SELECT] as string[]);

// Full shape + business-rule validation for a PUT'd field list, run before
// any write touches the DB. Checked here (not just client-side) because
// this is the one place a studio's public intake form gets its structure --
// a bad payload here breaks every future submission, not just this request.
export function validateIntakeFormFieldsPayload(body: unknown): string | null {
  if (!Array.isArray(body) || body.length === 0) {
    return "Body must be a non-empty array of fields.";
  }

  const rows = body as IntakeFormFieldInput[];
  const seenSystemKeys = new Set<string>();

  for (const row of rows) {
    if (row.fieldKind !== IntakeFieldKind.SYSTEM && row.fieldKind !== IntakeFieldKind.CUSTOM) {
      return `Invalid fieldKind: ${String(row.fieldKind)}`;
    }
    if (typeof row.label !== "string" || row.label.trim().length === 0) {
      return "Every field needs a non-empty label.";
    }
    if (typeof row.required !== "boolean" || typeof row.enabled !== "boolean") {
      return "required and enabled must be booleans.";
    }

    if (row.fieldKind === IntakeFieldKind.SYSTEM) {
      if (!row.systemFieldKey || !SYSTEM_FIELD_KEYS.includes(row.systemFieldKey)) {
        return `Invalid or missing systemFieldKey: ${String(row.systemFieldKey)}`;
      }
      if (seenSystemKeys.has(row.systemFieldKey)) {
        return `Duplicate system field: ${row.systemFieldKey}`;
      }
      seenSystemKeys.add(row.systemFieldKey);
    } else {
      if (!row.customQuestionType || !CUSTOM_TYPES.has(row.customQuestionType)) {
        return `Invalid or missing customQuestionType: ${String(row.customQuestionType)}`;
      }
      if (OPTION_TYPES.has(row.customQuestionType)) {
        if (
          !Array.isArray(row.options) ||
          row.options.length === 0 ||
          row.options.some((o) => typeof o !== "string" || o.trim().length === 0)
        ) {
          return `"${row.label}" needs at least one non-empty option.`;
        }
      }
    }

    if (row.translations !== undefined) {
      if (typeof row.translations !== "object" || row.translations === null || Array.isArray(row.translations)) {
        return `"${row.label}": translations must be an object keyed by locale.`;
      }
      for (const [locale, fields] of Object.entries(row.translations)) {
        if (!isSupportedLocale(locale) || locale === "en") {
          return `"${row.label}": translations key "${locale}" is not a supported non-English locale.`;
        }
        if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
          return `"${row.label}": translations.${locale} must be an object.`;
        }
        for (const [field, value] of Object.entries(fields)) {
          if (field !== "label" && field !== "helpText" && field !== "options") {
            return `"${row.label}": translations.${locale}.${field} is not a translatable field.`;
          }
          if (field === "options") {
            if (value !== null && !(Array.isArray(value) && value.every((o) => typeof o === "string"))) {
              return `"${row.label}": translations.${locale}.options must be an array of strings or null.`;
            }
          } else if (value !== null && typeof value !== "string") {
            return `"${row.label}": translations.${locale}.${field} must be a string or null.`;
          }
        }
      }
    }
  }

  const missingKeys = SYSTEM_FIELD_KEYS.filter((k) => !seenSystemKeys.has(k));
  if (missingKeys.length > 0) {
    return `Missing required system field(s): ${missingKeys.join(", ")}. System fields can be disabled but not removed.`;
  }

  return validateFieldListConstraint(rows.map((r) => ({ systemFieldKey: r.systemFieldKey ?? null, enabled: r.enabled })));
}

export interface LiveIntakeFormField {
  id: string;
  fieldKind: IntakeFieldKind;
  systemFieldKey: string | null;
  customQuestionType: IntakeCustomQuestionType | null;
  label: string;
  required: boolean;
  enabled: boolean;
  options: unknown;
}

export interface CustomFieldAnswerSnapshot {
  question: string;
  type: IntakeCustomQuestionType;
  answer: string | string[];
}

const ARRAY_ANSWER_TYPES = new Set<IntakeCustomQuestionType>([
  IntakeCustomQuestionType.MULTI_SELECT,
  IntakeCustomQuestionType.PHOTO_UPLOAD,
]);

// Re-validates a submitted intake's custom-question answers against the
// studio's OWN current live field definitions -- never trusts client-
// supplied question text/type/options, only the field id and the answer
// value. Builds the snapshot persisted on Inquiry.customFieldAnswers
// (question text + type baked in alongside the answer) so a later edit or
// disable of the question never changes what an already-submitted inquiry
// shows. `fields` should already be filtered to this studio's live rows;
// only CUSTOM + enabled ones are considered here (a disabled question is
// never required, and any stray answer for it is silently dropped).
export function validateCustomFieldAnswers(
  fields: LiveIntakeFormField[],
  submitted: unknown,
): { error: string } | { value: Record<string, CustomFieldAnswerSnapshot> | null } {
  const customFields = fields.filter((f) => f.fieldKind === IntakeFieldKind.CUSTOM && f.enabled);
  if (customFields.length === 0) return { value: null };

  const answers = (submitted && typeof submitted === "object" ? submitted : {}) as Record<string, unknown>;
  const result: Record<string, CustomFieldAnswerSnapshot> = {};

  for (const f of customFields) {
    const raw = answers[f.id];
    const type = f.customQuestionType as IntakeCustomQuestionType;
    const isArrayAnswer = ARRAY_ANSWER_TYPES.has(type);
    const hasValue = isArrayAnswer
      ? Array.isArray(raw) && raw.length > 0
      : typeof raw === "string" && raw.trim().length > 0;

    if (!hasValue) {
      if (f.required) {
        return { error: `"${f.label}" is required` };
      }
      continue;
    }

    const options = Array.isArray(f.options) ? (f.options as string[]) : [];

    switch (type) {
      case IntakeCustomQuestionType.SELECT: {
        const answer = (raw as string).trim();
        if (!options.includes(answer)) {
          return { error: `"${f.label}" must be one of the offered options` };
        }
        result[f.id] = { question: f.label, type, answer };
        break;
      }
      case IntakeCustomQuestionType.MULTI_SELECT: {
        const answer = raw as unknown[];
        if (!answer.every((v) => typeof v === "string" && options.includes(v))) {
          return { error: `"${f.label}" must only include the offered options` };
        }
        result[f.id] = { question: f.label, type, answer: answer as string[] };
        break;
      }
      case IntakeCustomQuestionType.YES_NO: {
        const answer = (raw as string).trim();
        if (answer !== "YES" && answer !== "NO") {
          return { error: `"${f.label}" must be answered Yes or No` };
        }
        result[f.id] = { question: f.label, type, answer };
        break;
      }
      case IntakeCustomQuestionType.NUMBER: {
        const answer = (raw as string).trim();
        if (Number.isNaN(Number(answer))) {
          return { error: `"${f.label}" must be a number` };
        }
        result[f.id] = { question: f.label, type, answer };
        break;
      }
      case IntakeCustomQuestionType.DATE: {
        const answer = (raw as string).trim();
        if (Number.isNaN(new Date(answer).getTime())) {
          return { error: `"${f.label}" must be a valid date` };
        }
        result[f.id] = { question: f.label, type, answer };
        break;
      }
      case IntakeCustomQuestionType.PHOTO_UPLOAD: {
        const answer = raw as unknown[];
        if (!answer.every((v) => typeof v === "string" && v.trim().length > 0)) {
          return { error: `"${f.label}" must be a valid photo upload` };
        }
        result[f.id] = { question: f.label, type, answer: answer as string[] };
        break;
      }
      default: {
        // TEXT, PARAGRAPH
        result[f.id] = { question: f.label, type, answer: (raw as string).trim() };
      }
    }
  }

  return { value: Object.keys(result).length > 0 ? result : null };
}

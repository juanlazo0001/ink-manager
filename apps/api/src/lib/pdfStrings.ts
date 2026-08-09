// Multi-language public forms: lib/pdf.ts runs server-side with no React
// tree to read a LocaleContext from, so it needs its own small,
// independent string dictionary -- same t(key, vars) shape as the
// frontend's apps/web/src/i18n/useTranslations.ts, deliberately not
// shared code (different runtime, no DOM/React dependency here at all).
//
// Deliberately NOT `as const` on EN, for the identical reason as the
// frontend's own en.ts: `ES: typeof EN` only has to match KEY structure,
// not English VALUES.
import { DEFAULT_LOCALE, isSupportedPdfLocale, type PdfLocale } from "./pdfLocale";

const EN = {
  generatedOn: "Generated {{date}}",
  depositAgreementTitle: "Deposit Agreement",
  client: "Client: {{name}}",
  project: "Project: {{title}}",
  session: "Session: #{{n}}",
  depositAmount: "Deposit amount: {{amount}}",
  processingFee: "Processing fee: {{amount}}",
  totalCharged: "Total charged: {{amount}}",
  termsAgreedTo: "Terms agreed to",
  signature: "Signature",
  signedBy: "Signed by: {{name}}",
  dateTimeLabel: "Date/time: {{value}}",
  signatureImageError: "(signature image could not be rendered)",
  dash: "—",
  waiverTitle: "Liability Waiver & Consent",
  legalNameOnFile: "Legal name on file: {{name}}",
  dateOfBirthLabel: "Date of birth: {{value}}",
  appointmentDateLabel: "Appointment date: {{value}}",
  emergencyContactLabel: "Emergency contact: {{name}} ({{phone}})",
  healthScreening: "Health screening",
  answerLabel: "Answer: {{value}}",
  acknowledgedClauses: "Acknowledged clauses",
  initialedLabel: "Initialed: {{value}}",
  acknowledgment: "Acknowledgment",
  clientSignature: "Client signature",
  photoVideoRelease: "Photo / video release",
  releaseSignature: "Release signature",
  notAccepted: "Not accepted.",
  idVerification: "ID verification",
  idOnFile: "A government ID photo is on file in the app (not embedded in this PDF -- see app for the image itself).",
  noIdOnFile: "No ID image on file.",
  staffVerifiedYes: "Staff-verified: Yes, {{date}} by {{name}}",
  staffVerifiedNo: "Staff-verified: Not yet verified",
};

const ES: typeof EN = {
  generatedOn: "Generado el {{date}}",
  depositAgreementTitle: "Acuerdo de Depósito",
  client: "Cliente: {{name}}",
  project: "Proyecto: {{title}}",
  session: "Sesión: #{{n}}",
  depositAmount: "Monto del depósito: {{amount}}",
  processingFee: "Cargo por procesamiento: {{amount}}",
  totalCharged: "Total cobrado: {{amount}}",
  termsAgreedTo: "Términos aceptados",
  signature: "Firma",
  signedBy: "Firmado por: {{name}}",
  dateTimeLabel: "Fecha/hora: {{value}}",
  signatureImageError: "(no se pudo mostrar la imagen de la firma)",
  dash: "—",
  waiverTitle: "Exención de Responsabilidad y Consentimiento",
  legalNameOnFile: "Nombre legal registrado: {{name}}",
  dateOfBirthLabel: "Fecha de nacimiento: {{value}}",
  appointmentDateLabel: "Fecha de la cita: {{value}}",
  emergencyContactLabel: "Contacto de emergencia: {{name}} ({{phone}})",
  healthScreening: "Cuestionario de salud",
  answerLabel: "Respuesta: {{value}}",
  acknowledgedClauses: "Cláusulas reconocidas",
  initialedLabel: "Iniciales: {{value}}",
  acknowledgment: "Reconocimiento",
  clientSignature: "Firma del cliente",
  photoVideoRelease: "Autorización de foto / video",
  releaseSignature: "Firma de autorización",
  notAccepted: "No aceptado.",
  idVerification: "Verificación de identificación",
  idOnFile: "Hay una foto de identificación oficial registrada en la aplicación (no incluida en este PDF -- consulte la app para ver la imagen).",
  noIdOnFile: "No hay imagen de identificación registrada.",
  staffVerifiedYes: "Verificado por el personal: Sí, el {{date}} por {{name}}",
  staffVerifiedNo: "Verificado por el personal: Aún no verificado",
};

const DICTIONARIES: Record<PdfLocale, typeof EN> = { en: EN, es: ES };

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export type PdfStringKey = keyof typeof EN;

export function pdfT(locale: string | null | undefined, key: PdfStringKey, vars?: Vars): string {
  const resolved = isSupportedPdfLocale(locale) ? locale : DEFAULT_LOCALE;
  return interpolate(DICTIONARIES[resolved][key], vars);
}

// en-US/es-US, not es-ES -- this app's own audience is US-based (see
// e.g. WaiverSign.tsx's North Carolina age-of-majority text, PhoneInput's
// 10-digit US validation), so date FORMAT conventions (MM/DD/YYYY-style
// ordering) should stay consistent with the English version, only the
// surrounding label text and month/weekday names change.
export function pdfDateLocale(locale: string | null | undefined): string {
  return isSupportedPdfLocale(locale) && locale === "es" ? "es-US" : "en-US";
}

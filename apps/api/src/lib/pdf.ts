import PDFDocument from "pdfkit";

// Native, pure-JS PDF generation (pdfkit) -- deliberately NOT a
// headless-browser HTML-to-PDF approach. This project already got burned
// once by a phantom/unhoisted dependency (esbuild) breaking the Railway
// production build; a headless-Chrome dependency would carry the same or
// worse risk there (large binary, missing system libs in a minimal
// Nixpacks image, memory pressure on a small API dyno) for a document this
// simple. pdfkit has no native bindings and streams directly to a Buffer.

function decodeDataUrlPng(dataUrl: string): Buffer {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return Buffer.from(base64, "base64");
}

// acknowledgmentSnapshot/photoReleaseSnapshot are rich text from a
// Settings WYSIWYG editor (rendered as real HTML on the public signing
// page) -- this PDF is plain text, so tags need stripping rather than
// printed literally. Same simple approach as gmail.ts's own stripHtml.
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function addDocumentHeader(doc: PDFKit.PDFDocument, studioName: string, title: string) {
  doc.fontSize(18).font("Helvetica-Bold").text(studioName, { align: "center" });
  doc.moveDown(0.25);
  doc.fontSize(14).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown(0.25);
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#666666")
    .text(`Generated ${new Date().toLocaleString("en-US")}`, { align: "center" });
  doc.fillColor("#000000");
  doc.moveDown(1);
}

function addSectionTitle(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.75);
  doc.fontSize(12).font("Helvetica-Bold").text(text);
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(10);
}

function addSignatureBlock(
  doc: PDFKit.PDFDocument,
  label: string,
  signatureName: string | null,
  signatureData: string | null,
  signedAt: Date | null,
) {
  addSectionTitle(doc, label);
  doc.text(`Signed by: ${signatureName ?? "—"}`);
  doc.text(`Date/time: ${signedAt ? signedAt.toLocaleString("en-US") : "—"}`);
  if (signatureData) {
    try {
      const buf = decodeDataUrlPng(signatureData);
      doc.moveDown(0.25);
      doc.image(buf, { width: 180 });
    } catch {
      doc.text("(signature image could not be rendered)");
    }
  }
}

export interface DepositFormPdfInput {
  studioName: string;
  clientName: string;
  inquiryTitle: string | null;
  sessionNumber: number;
  depositAmount: number;
  feeAmount: number;
  totalCharged: number;
  terms: readonly { key: string; label: string }[];
  signatureName: string | null;
  signatureData: string | null;
  signedAt: Date | null;
}

// Renders TERMS' CURRENT wording, not a per-signing snapshot -- unlike
// LiabilityWaiver, DepositForm has no clausesSnapshot equivalent (only the
// 8 agreed* booleans, backed by a single shared, studio-wide TERMS array in
// deposits.ts). That array is described in its own comment as "exact SOP
// wording" and changes rarely, so this is an accepted, documented gap
// rather than a true historical snapshot -- flagged here and in REPORT.md,
// not silently treated as equivalent to the waiver's real snapshots.
export async function generateDepositFormPdf(input: DepositFormPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  addDocumentHeader(doc, input.studioName, "Deposit Agreement");

  doc.fontSize(10).font("Helvetica");
  doc.text(`Client: ${input.clientName}`);
  if (input.inquiryTitle) doc.text(`Project: ${input.inquiryTitle}`);
  doc.text(`Session: #${input.sessionNumber}`);
  doc.moveDown(0.5);
  doc.text(`Deposit amount: $${input.depositAmount.toFixed(2)}`);
  doc.text(`Processing fee: $${input.feeAmount.toFixed(2)}`);
  doc.font("Helvetica-Bold").text(`Total charged: $${input.totalCharged.toFixed(2)}`);
  doc.font("Helvetica");

  addSectionTitle(doc, "Terms agreed to");
  for (const term of input.terms) {
    // "✓" (U+2713) falls outside the base-14 fonts' WinAnsi encoding and
    // renders as a garbled substitute glyph -- a plain hyphen is
    // guaranteed correct in every pdfkit standard font.
    doc.text(`-  ${term.label}`, { indent: 10 });
    doc.moveDown(0.35);
  }

  addSignatureBlock(doc, "Signature", input.signatureName, input.signatureData, input.signedAt);

  return collectPdf(doc);
}

export interface WaiverPdfInput {
  studioName: string;
  clientName: string;
  appointmentDate: Date;
  legalName: string | null;
  dateOfBirth: Date | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  healthQuestions: { question: string; type: string }[];
  healthAnswers: { questionIndex: number; answer: string; explanation?: string }[];
  clauses: string[];
  clauseInitials: { clauseIndex: number; initials: string }[];
  acknowledgment: string | null;
  signatureName: string | null;
  signatureData: string | null;
  signedAt: Date | null;
  photoReleaseAccepted: boolean;
  photoReleaseText: string | null;
  photoReleaseSignatureName: string | null;
  photoReleaseSignatureData: string | null;
  idImageOnFile: boolean;
  verifiedAt: Date | null;
  verifiedByName: string | null;
}

// Deliberately does NOT embed the raw government-ID photo -- that's a much
// more sensitive piece of PII than the rest of this document, fetching it
// from Cloudinary at generation time adds an outbound dependency, and a
// downloadable PDF is materially easier to forward/leak than the same image
// viewed in-app behind the normal permission wall. This PDF instead just
// notes that an ID is on file; staff who need the image itself view it
// in-app, same as today.
export async function generateWaiverPdf(input: WaiverPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  addDocumentHeader(doc, input.studioName, "Liability Waiver & Consent");

  doc.fontSize(10).font("Helvetica");
  doc.text(`Client: ${input.clientName}`);
  doc.text(`Legal name on file: ${input.legalName ?? "—"}`);
  doc.text(`Date of birth: ${input.dateOfBirth ? input.dateOfBirth.toLocaleDateString("en-US") : "—"}`);
  doc.text(`Appointment date: ${input.appointmentDate.toLocaleString("en-US")}`);
  doc.text(`Emergency contact: ${input.emergencyContactName ?? "—"} (${input.emergencyContactPhone ?? "—"})`);

  addSectionTitle(doc, "Health screening");
  const answerByIndex = new Map(input.healthAnswers.map((a) => [a.questionIndex, a]));
  input.healthQuestions.forEach((q, i) => {
    const a = answerByIndex.get(i);
    doc.font("Helvetica-Bold").text(`${i + 1}. ${q.question}`);
    doc
      .font("Helvetica")
      .text(`Answer: ${a?.answer ?? "—"}${a?.explanation ? ` — ${a.explanation}` : ""}`, { indent: 10 });
    doc.moveDown(0.35);
  });

  addSectionTitle(doc, "Acknowledged clauses");
  const initialsByIndex = new Map(input.clauseInitials.map((c) => [c.clauseIndex, c.initials]));
  input.clauses.forEach((clause, i) => {
    doc.text(`${i + 1}. ${clause}`, { indent: 10 });
    doc.font("Helvetica-Oblique").text(`Initialed: ${initialsByIndex.get(i) ?? "—"}`, { indent: 10 });
    doc.font("Helvetica");
    doc.moveDown(0.35);
  });

  if (input.acknowledgment) {
    addSectionTitle(doc, "Acknowledgment");
    doc.text(stripHtml(input.acknowledgment));
  }

  addSignatureBlock(doc, "Client signature", input.signatureName, input.signatureData, input.signedAt);

  addSectionTitle(doc, "Photo / video release");
  if (input.photoReleaseAccepted) {
    if (input.photoReleaseText) doc.text(stripHtml(input.photoReleaseText));
    addSignatureBlock(
      doc,
      "Release signature",
      input.photoReleaseSignatureName,
      input.photoReleaseSignatureData,
      input.signedAt,
    );
  } else {
    doc.text("Not accepted.");
  }

  addSectionTitle(doc, "ID verification");
  doc.text(
    input.idImageOnFile
      ? "A government ID photo is on file in the app (not embedded in this PDF -- see app for the image itself)."
      : "No ID image on file.",
  );
  doc.text(
    `Staff-verified: ${input.verifiedAt ? `Yes, ${input.verifiedAt.toLocaleString("en-US")} by ${input.verifiedByName ?? "—"}` : "Not yet verified"}`,
  );

  return collectPdf(doc);
}

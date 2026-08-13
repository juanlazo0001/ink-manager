import archiver from "archiver";
import { stringify } from "csv-stringify";
import { prisma } from "./prisma";
import type { Prisma } from "../../generated/prisma/client";
import { generateDepositFormPdf, generateWaiverPdf } from "./pdf";
import { resolveWaiverSnapshotContent } from "../routes/waivers";
import { TERMS } from "../routes/deposits";
import { DEFAULT_THEME_PRESET, THEME_PRESET_ACCENT_COLORS, isValidThemePreset } from "./themePresets";
import { resolveRequestLocale } from "./contentTranslation";
import { EXPORT_FIELD_LABELS, buildClientContactValues, type ExportFieldKey } from "./clientExportFields";

// The comprehensive, health-data-inclusive counterpart to clients.ts's own
// lightweight POST /export. Kept in its own lib file (route-thin/lib-heavy,
// this app's own convention) since it's genuinely a different, heavier
// action -- up to five joined CSVs plus real signed PDFs, streamed into one
// ZIP -- not a variant of the column-picker export. Reached from the SAME
// "Export" button/modal on the frontend as the plain CSV export; which
// sections/PDFs actually get included is entirely driven by `options`
// below, not hardcoded here.

const BATCH_SIZE = 500;

// One entry per full-record category the export modal can offer, beyond
// the always-included clients.csv contact fields. Exported so both the
// route (validating the `sections` request body) and the frontend's own
// mirrored list (Clients.tsx) have one canonical source of the key set.
export const SECTION_KEYS = ["inquiries", "sessions", "giftCards", "deposits", "waivers"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface ClientFullExportOptions {
  // Contact-field columns for clients.csv -- same keys/order semantics as
  // POST /export's own `fields`.
  fields: readonly ExportFieldKey[];
  // Which full-record categories to include as their own CSV. Deliberately
  // required to be non-empty by the route -- this function doesn't itself
  // enforce that, so it stays reusable/testable on its own.
  sections: ReadonlySet<SectionKey>;
  // Bundle signed deposit-form/waiver PDFs for whichever of "deposits"/
  // "waivers" are also in `sections` -- a separate opt-in from including
  // those categories' CSV rows, since the PDFs are both far larger and
  // slower to generate (real pdfkit rendering per signed record).
  includePdfs: boolean;
}

function csvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// Health Q&A as human-readable "N. Question: Answer (explanation)" entries,
// never the raw JSON snapshot/answer blobs -- matches the single-waiver PDF
// route's own choice to render these fields, not dump their storage shape.
function formatHealthQA(
  questionsSnapshot: unknown,
  healthAnswers: unknown,
): string {
  const questions = (questionsSnapshot as { question: string }[] | null) ?? [];
  const answers = (healthAnswers as { questionIndex: number; answer: string; explanation?: string }[] | null) ?? [];
  const answerByIndex = new Map(answers.map((a) => [a.questionIndex, a]));
  return questions
    .map((q, i) => {
      const a = answerByIndex.get(i);
      const answer = a ? `${a.answer}${a.explanation ? ` (${a.explanation})` : ""}` : "--";
      return `${i + 1}. ${q.question}: ${answer}`;
    })
    .join(" | ");
}

// Always fetches every relation regardless of `sections` -- one client-
// scoped batch query either way, and conditionally shaping the Prisma
// `select` per section combination would add real complexity for a query
// that's already bounded by BATCH_SIZE. `sections`/`includePdfs` instead
// control which parts of this fetched data get WRITTEN below.
async function fetchClientBatch(where: Prisma.ClientWhereInput, cursor: string | undefined) {
  return prisma.client.findMany({
    where,
    orderBy: { id: "asc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: BATCH_SIZE,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      instagramHandle: true,
      facebookProfileUrl: true,
      otherContact: true,
      address: true,
      referralCode: true,
      createdAt: true,
      phones: { select: { phone: true, isPrimary: true }, orderBy: { isPrimary: "desc" } },
      emails: { select: { email: true, isPrimary: true }, orderBy: { isPrimary: "desc" } },
      studio: {
        select: {
          name: true,
          logoUrl: true,
          settings: {
            select: {
              themePreset: true,
              waiverHealthQuestions: true,
              waiverClauses: true,
              waiverAcknowledgment: true,
              waiverPhotoRelease: true,
              translations: true,
            },
          },
        },
      },
      inquiries: {
        select: {
          id: true,
          status: true,
          description: true,
          placement: true,
          colorOrBlackGrey: true,
          estimatedSize: true,
          budget: true,
          priceEstimateLow: true,
          priceEstimateHigh: true,
          timeEstimateHoursMin: true,
          timeEstimateHoursMax: true,
          channel: true,
          createdAt: true,
          declineNote: true,
          closedReason: true,
          lostReason: true,
          lostAt: true,
          service: { select: { name: true } },
          assignedArtist: { select: { user: { select: { name: true } } } },
          depositForms: {
            select: {
              id: true,
              sessionNumber: true,
              amountMode: true,
              depositAmount: true,
              feeAmount: true,
              totalCharged: true,
              paidManually: true,
              paidAt: true,
              paidVia: true,
              signedAt: true,
              signedLocale: true,
              signatureName: true,
              signatureData: true,
              termsSnapshot: true,
            },
          },
        },
      },
      appointments: {
        select: {
          id: true,
          inquiryId: true,
          startTime: true,
          endTime: true,
          status: true,
          appointmentType: true,
          depositPaid: true,
          finalCostCents: true,
          tipCents: true,
          notes: true,
          closeoutNotes: true,
          artist: { select: { user: { select: { name: true } } } },
        },
      },
      giftCards: {
        select: {
          id: true,
          code: true,
          amountCents: true,
          status: true,
          paymentMethod: true,
          expiresAt: true,
          paidAt: true,
          redeemedAt: true,
          appointmentId: true,
          exemptionReason: true,
        },
      },
      liabilityWaivers: {
        select: {
          id: true,
          appointmentId: true,
          status: true,
          legalName: true,
          dateOfBirth: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
          healthQuestionsSnapshot: true,
          healthAnswers: true,
          clausesSnapshot: true,
          clauseInitials: true,
          acknowledgmentSnapshot: true,
          photoReleaseSnapshot: true,
          photoReleaseAccepted: true,
          photoReleaseSignatureName: true,
          photoReleaseSignatureData: true,
          idImageUrl: true,
          signatureName: true,
          signatureData: true,
          signedAt: true,
          signedLocale: true,
          verifiedAt: true,
          verifiedBy: { select: { name: true } },
          appointment: { select: { startTime: true } },
        },
      },
    },
  });
}

// Streams a ZIP (clients.csv + whichever of `options.sections` were
// selected, plus signed PDFs if `options.includePdfs`) for every client
// matched by `where` directly into `res`. Caller is responsible for auth/
// permission checks and response headers (Content-Type: application/zip,
// Content-Disposition) before calling this.
export async function streamClientFullExport(
  where: Prisma.ClientWhereInput,
  options: ClientFullExportOptions,
  res: NodeJS.WritableStream,
): Promise<void> {
  const { fields, sections, includePdfs } = options;

  // Pinned to archiver 7.x, not the latest 8.x: 8.0.0 rewrote the package
  // as ESM-only with no "require" condition in its exports map at all, so
  // a plain `require("archiver")` (what this app's commonjs module target
  // compiles any import to, static or dynamic) throws ERR_REQUIRE_ESM at
  // runtime in production -- a gap `tsc --noEmit` can't see. 7.x is the
  // last version with the classic CJS factory API used here.
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  const clientsCsv = stringify({ header: true, columns: fields.map((key) => EXPORT_FIELD_LABELS[key]) });
  archive.append(clientsCsv, { name: "clients.csv" });

  const inquiriesCsv = sections.has("inquiries")
    ? stringify({
        header: true,
        columns: [
          "Inquiry ID",
          "Client ID",
          "Client Name",
          "Status",
          "Description",
          "Placement",
          "Color/Black & Grey",
          "Estimated Size",
          "Budget",
          "Price Estimate Low",
          "Price Estimate High",
          "Time Estimate Hours Min",
          "Time Estimate Hours Max",
          "Service",
          "Assigned Artist",
          "Channel",
          "Created Date",
          "Decline Note",
          "Closed Reason",
          "Lost Reason",
          "Lost At",
        ],
      })
    : null;
  if (inquiriesCsv) archive.append(inquiriesCsv, { name: "inquiries.csv" });

  const sessionsCsv = sections.has("sessions")
    ? stringify({
        header: true,
        columns: [
          "Session ID",
          "Client ID",
          "Client Name",
          "Inquiry ID",
          "Artist",
          "Start Time",
          "End Time",
          "Status",
          "Appointment Type",
          "Deposit Paid",
          "Final Cost (cents)",
          "Tip (cents)",
          "Notes",
          "Closeout Notes",
        ],
      })
    : null;
  if (sessionsCsv) archive.append(sessionsCsv, { name: "sessions.csv" });

  const giftCardsCsv = sections.has("giftCards")
    ? stringify({
        header: true,
        columns: [
          "Gift Card ID",
          "Client ID",
          "Client Name",
          "Code",
          "Amount (cents)",
          "Status",
          "Payment Method",
          "Expires At",
          "Paid At",
          "Redeemed At",
          "Attached Appointment ID",
          "Exemption Reason",
        ],
      })
    : null;
  if (giftCardsCsv) archive.append(giftCardsCsv, { name: "gift-cards.csv" });

  const includeDeposits = sections.has("deposits");
  const depositsCsv = includeDeposits
    ? stringify({
        header: true,
        columns: [
          "Deposit Form ID",
          "Client ID",
          "Client Name",
          "Inquiry ID",
          "Session Number",
          "Amount Mode",
          "Deposit Amount",
          "Fee Amount",
          "Total Charged",
          "Paid Manually",
          "Paid At",
          "Paid Via",
          "Signed At",
          "Signature Name",
        ],
      })
    : null;
  if (depositsCsv) archive.append(depositsCsv, { name: "deposits.csv" });

  const includeWaivers = sections.has("waivers");
  const waiversCsv = includeWaivers
    ? stringify({
        header: true,
        columns: [
          "Waiver ID",
          "Client ID",
          "Client Name",
          "Appointment ID",
          "Status",
          "Legal Name",
          "Date of Birth",
          "Emergency Contact Name",
          "Emergency Contact Phone",
          "Health Screening",
          "Signature Name",
          "Signed At",
          "Photo Release Accepted",
          "ID On File",
          "Verified At",
          "Verified By",
        ],
      })
    : null;
  if (waiversCsv) archive.append(waiversCsv, { name: "waivers.csv" });

  const activeStreams = [clientsCsv, inquiriesCsv, sessionsCsv, giftCardsCsv, depositsCsv, waiversCsv].filter(
    (s): s is ReturnType<typeof stringify> => s !== null,
  );

  let cursor: string | undefined;
  for (;;) {
    const batch = await fetchClientBatch(where, cursor);
    if (batch.length === 0) break;

    for (const c of batch) {
      const clientName = `${c.firstName} ${c.lastName}`;
      const contactValues = buildClientContactValues(c);
      clientsCsv.write(fields.map((key) => contactValues[key]));

      const accentColor =
        THEME_PRESET_ACCENT_COLORS[isValidThemePreset(c.studio.settings?.themePreset) ? c.studio.settings!.themePreset : DEFAULT_THEME_PRESET];

      for (const inquiry of c.inquiries) {
        if (inquiriesCsv) {
          inquiriesCsv.write([
            inquiry.id,
            c.id,
            clientName,
            inquiry.status,
            inquiry.description,
            inquiry.placement,
            inquiry.colorOrBlackGrey,
            inquiry.estimatedSize,
            inquiry.budget ?? "",
            inquiry.priceEstimateLow ?? "",
            inquiry.priceEstimateHigh ?? "",
            inquiry.timeEstimateHoursMin ?? "",
            inquiry.timeEstimateHoursMax ?? "",
            inquiry.service.name,
            inquiry.assignedArtist?.user.name ?? "",
            inquiry.channel,
            csvValue(inquiry.createdAt),
            inquiry.declineNote ?? "",
            inquiry.closedReason ?? "",
            inquiry.lostReason ?? "",
            csvValue(inquiry.lostAt),
          ]);
        }

        if (!includeDeposits) continue;
        for (const deposit of inquiry.depositForms) {
          depositsCsv!.write([
            deposit.id,
            c.id,
            clientName,
            inquiry.id,
            deposit.sessionNumber,
            deposit.amountMode,
            deposit.depositAmount,
            deposit.feeAmount,
            deposit.totalCharged,
            deposit.paidManually,
            csvValue(deposit.paidAt),
            deposit.paidVia ?? "",
            csvValue(deposit.signedAt),
            deposit.signatureName ?? "",
          ]);

          if (includePdfs && deposit.signedAt) {
            const pdf = await generateDepositFormPdf({
              studioName: c.studio.name,
              studioLogoUrl: c.studio.logoUrl,
              accentColor,
              clientName,
              inquiryTitle: `${inquiry.service.name} — ${inquiry.placement}`,
              sessionNumber: deposit.sessionNumber,
              amountMode: deposit.amountMode,
              depositAmount: deposit.depositAmount,
              feeAmount: deposit.feeAmount,
              totalCharged: deposit.totalCharged,
              terms: (deposit.termsSnapshot as unknown as { key: string; label: string }[] | null) ?? TERMS,
              signatureName: deposit.signatureName,
              signatureData: deposit.signatureData,
              signedAt: deposit.signedAt,
              locale: deposit.signedLocale,
            });
            archive.append(pdf, { name: `deposit-forms/deposit-form-${deposit.id}.pdf` });
          }
        }
      }

      if (sessionsCsv) {
        for (const appointment of c.appointments) {
          sessionsCsv.write([
            appointment.id,
            c.id,
            clientName,
            appointment.inquiryId,
            appointment.artist.user.name,
            csvValue(appointment.startTime),
            csvValue(appointment.endTime),
            appointment.status,
            appointment.appointmentType,
            appointment.depositPaid,
            appointment.finalCostCents ?? "",
            appointment.tipCents ?? "",
            appointment.notes ?? "",
            appointment.closeoutNotes ?? "",
          ]);
        }
      }

      if (giftCardsCsv) {
        for (const giftCard of c.giftCards) {
          giftCardsCsv.write([
            giftCard.id,
            c.id,
            clientName,
            giftCard.code,
            giftCard.amountCents,
            giftCard.status,
            giftCard.paymentMethod ?? "",
            csvValue(giftCard.expiresAt),
            csvValue(giftCard.paidAt),
            csvValue(giftCard.redeemedAt),
            giftCard.appointmentId ?? "",
            giftCard.exemptionReason ?? "",
          ]);
        }
      }

      if (includeWaivers) {
        for (const waiver of c.liabilityWaivers) {
          waiversCsv!.write([
            waiver.id,
            c.id,
            clientName,
            waiver.appointmentId,
            waiver.status,
            waiver.legalName ?? "",
            csvValue(waiver.dateOfBirth),
            waiver.emergencyContactName ?? "",
            waiver.emergencyContactPhone ?? "",
            formatHealthQA(waiver.healthQuestionsSnapshot, waiver.healthAnswers),
            waiver.signatureName ?? "",
            csvValue(waiver.signedAt),
            waiver.photoReleaseAccepted,
            !!waiver.idImageUrl,
            csvValue(waiver.verifiedAt),
            waiver.verifiedBy?.name ?? "",
          ]);

          if (includePdfs && waiver.signedAt) {
            const locale = resolveRequestLocale(undefined, waiver.signedLocale, null);
            const { healthQuestions, clauses, acknowledgment, photoRelease } = resolveWaiverSnapshotContent(
              waiver,
              c.studio.settings,
              locale,
            );
            const pdf = await generateWaiverPdf({
              studioName: c.studio.name,
              studioLogoUrl: c.studio.logoUrl,
              accentColor,
              clientName,
              appointmentDate: waiver.appointment.startTime,
              legalName: waiver.legalName,
              dateOfBirth: waiver.dateOfBirth,
              emergencyContactName: waiver.emergencyContactName,
              emergencyContactPhone: waiver.emergencyContactPhone,
              healthQuestions: healthQuestions as unknown as { question: string; type: string }[],
              healthAnswers: (waiver.healthAnswers ?? []) as unknown as { questionIndex: number; answer: string; explanation?: string }[],
              clauses: clauses as unknown as string[],
              clauseInitials: (waiver.clauseInitials ?? []) as unknown as { clauseIndex: number; initials: string }[],
              acknowledgment,
              signatureName: waiver.signatureName,
              signatureData: waiver.signatureData,
              signedAt: waiver.signedAt,
              photoReleaseAccepted: waiver.photoReleaseAccepted,
              photoReleaseText: photoRelease,
              photoReleaseSignatureName: waiver.photoReleaseSignatureName,
              photoReleaseSignatureData: waiver.photoReleaseSignatureData,
              idImageOnFile: !!waiver.idImageUrl,
              verifiedAt: waiver.verifiedAt,
              verifiedByName: waiver.verifiedBy?.name ?? null,
              locale,
            });
            archive.append(pdf, { name: `waivers/waiver-${waiver.id}.pdf` });
          }
        }
      }
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < BATCH_SIZE) break;
  }

  for (const stream of activeStreams) {
    stream.end();
  }
  await archive.finalize();
}

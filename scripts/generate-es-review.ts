// Multi-language public forms, pre-merge closeout (step 3): regenerates
// apps/web/src/i18n/PLATFORM_STRINGS_ES_REVIEW.md directly from the actual
// source dictionaries, rather than hand-transcribing them -- the checked-in
// doc had already drifted from es.ts (paidHeadingStripe/Manual) by the time
// this ran, which is exactly the failure mode a generated doc avoids.
//
// Scratch/dev tooling, not part of the app itself -- run with
// `npx tsx scripts/generate-es-review.ts` from the repo root. Safe to
// delete after the review doc is generated; kept for now in case the
// native-speaker pass requests changes that need a regenerate.
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
dotenv.config({ path: join(__dirname, "..", "apps/api/.env") });

import { en } from "../apps/web/src/i18n/strings/en";
import { es } from "../apps/web/src/i18n/strings/es";
import { EN as PDF_EN, ES as PDF_ES } from "../apps/api/src/lib/pdfStrings";
import { TERMS, TERMS_ES } from "../apps/api/src/routes/deposits";
import { SYSTEM_FIELD_DEFAULTS_ES } from "../apps/api/src/lib/contentTranslation";
import { SYSTEM_FIELD_DEFAULTS } from "../apps/api/src/lib/intakeFormFields";

type Dict = { [key: string]: string | Dict };

function escapeCell(value: string): string {
  const escaped = value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  // Leading/trailing whitespace is significant (e.g. withArtistSuffix's
  // " with {{artistName}}", meant to append onto a preceding sentence with
  // no extra space) but invisible in a rendered table -- wrap in quotes so
  // a reviewer sees it's intentional rather than a stray-space typo.
  return escaped !== escaped.trim() ? `"${escaped}"` : escaped;
}

function flatten(node: Dict, prefix: string[] = []): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(node)) {
    const path = [...prefix, k];
    if (typeof v === "string") {
      rows.push({ key: path.join("."), value: v });
    } else {
      rows.push(...flatten(v, path));
    }
  }
  return rows;
}

function renderSection(title: string, enRows: { key: string; value: string }[], esDict: Dict): string {
  const lines = [`### ${title}`, "", "| Key | English | Spanish (draft) |", "|---|---|---|"];
  for (const { key, value } of enRows) {
    const esValue = key.split(".").reduce<Dict | string | undefined>((acc, part) => {
      if (typeof acc !== "object" || acc === undefined) return undefined;
      return acc[part];
    }, esDict);
    lines.push(`| ${key} | ${escapeCell(value)} | ${escapeCell(typeof esValue === "string" ? esValue : "**MISSING**")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

const frontendSections = Object.entries(en as unknown as Dict)
  .map(([namespace, dict]) => renderSection(namespace, flatten(dict as Dict), (es as unknown as Dict)[namespace] as Dict))
  .join("\n");

const pdfRows = Object.entries(PDF_EN).map(([key, value]) => ({ key, value: value as string }));
const pdfSection = renderSection("PDF chrome (`apps/api/src/lib/pdfStrings.ts`)", pdfRows, PDF_ES as unknown as Dict);

const termsRows = TERMS.map((t) => ({ key: t.key, value: t.label }));
const termsSection = renderSection(
  "Deposit agreement clauses -- platform copy (`apps/api/src/routes/deposits.ts` TERMS/TERMS_ES)",
  termsRows,
  TERMS_ES as unknown as Dict,
);

const sysFieldRows = SYSTEM_FIELD_DEFAULTS.map((f) => ({ key: f.key, value: f.label }));
const sysFieldSection = renderSection(
  "SYSTEM intake field seed labels (`apps/api/src/lib/intakeFormFields.ts` / `contentTranslation.ts`)",
  sysFieldRows,
  SYSTEM_FIELD_DEFAULTS_ES as unknown as Dict,
);

const doc = `# Platform Spanish strings — review pass needed before merge

**Status: DRAFT, machine-generated from source.** Every Spanish string below (\`apps/web/src/i18n/strings/es.ts\`,
\`apps/api/src/lib/pdfStrings.ts\`'s \`ES\` dictionary, \`apps/api/src/routes/deposits.ts\`'s \`TERMS_ES\`,
\`apps/api/src/lib/contentTranslation.ts\`'s \`SYSTEM_FIELD_DEFAULTS_ES\`) was written as a professional first
draft, not machine-translated, but has **not** had a native-speaker review pass. This document is generated
directly from those four source files (\`scripts/generate-es-review.ts\`) rather than hand-copied, so it can
never drift out of sync the way a manually-maintained snapshot can. Once reviewed, corrections go back into
the four source files directly and this doc gets regenerated -- it is not itself a source of truth.

A \`**MISSING**\` cell means the key exists in the English dictionary but has no Spanish counterpart --
should never appear once the source files are consistent (the frontend dictionaries are compile-time
enforced via \`es: typeof en\`; the three backend dictionaries are not, so this doc doubles as their only
completeness check).

## Conventions used throughout (flag if any of these should change)

- **Register**: informal "tú," not formal "usted" — matches the casual, friendly tone of the English
  original (e.g. "Hi {{firstName}}," "Let's get you scheduled!").
- **Dialect**: neutral, broadly-understandable Spanish aimed at a US Hispanic audience (not Spain-specific
  vocabulary or "vosotros" conjugations) — consistent with this app's US-only scope (10-digit phone
  validation, North Carolina-specific legal text, \`es-US\` date formatting).
- **Punctuation**: inverted question/exclamation marks (¿...?, ¡...!) used per standard Spanish orthography,
  even though the English original doesn't have an opening mark.
- **Placeholders**: every \`{{var}}\` token must appear in the Spanish string in the same form, unchanged —
  these are substituted programmatically, not part of the reviewable prose itself.

## Frontend platform strings (\`apps/web/src/i18n/strings/es.ts\`)

${frontendSections}

**deposit.terms.\\*** above is a legacy leftover key space -- the actual deposit clauses shown to clients
come from the API's own \`TERMS\`/\`TERMS_ES\` (see the dedicated section below), snapshotted onto
\`DepositForm.termsSnapshot\` at sign time. **Legal text — recommend this specific block gets an actual
legal/native-speaker review, not just a fluency check** (this is the exact text a client legally agrees to).

## Backend platform strings

${termsSection}
${sysFieldSection}
${pdfSection}

## Known gaps, not covered by this document

- **SMS bodies** (\`StudioSettings.reminderTemplates\`, ad-hoc conversation text) — explicitly out of v1
  scope (see the Part 1 investigation's own finding); stay English-only regardless of a client's locale
  preference until a dedicated future part.
- **Studio-authored content** (a studio's own \`StudioSettingsTranslation\`/\`ServiceTranslation\`/etc. rows,
  entered through the Settings locale tabs) — by definition not platform copy, not reviewable here; each
  studio owns the accuracy of their own translations.
- **Deposit confirmation enrichment** (appointment card, gift-card card) — folded into \`en.ts\`/\`es.ts\` as
  part of this same pre-merge closeout pass (see \`deposit.appointmentCard.*\`/\`deposit.giftCardCard.*\`
  above), so it IS covered, but flagged here since it shipped to \`main\` after this branch's original cut
  and is the newest content in this document.
`;

const outPath = join(__dirname, "..", "apps/web/src/i18n/PLATFORM_STRINGS_ES_REVIEW.md");
writeFileSync(outPath, doc, "utf8");
console.log(`Wrote ${outPath}`);

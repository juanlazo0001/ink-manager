import type { DepositTier } from "./depositTiers";

// The fixed set of Ink Manager fields a CSV column can be mapped onto --
// offered in the mapping UI in this order. "note" is the generic
// "Historical Note" bucket: any number of columns can map here (unlike
// every other key, which at most one column may claim -- enforced by
// validateColumnMapping below), each concatenated with its original
// header as a label into one InquiryNote at execute time.
export const IMPORT_TARGET_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "address",
  // Composite-address sub-roles (follow-up revision): an alternative to
  // the single "address" column above -- staff maps up to these four
  // instead when the export has separate columns, and composeAddress
  // (below) concatenates them into the one Client.address field.
  // Mutually exclusive with "address" itself -- see validateColumnMapping.
  "address.street",
  "address.city",
  "address.state",
  "address.postalCode",
  "inquiry.description",
  "inquiry.placement",
  "inquiry.size",
  "inquiry.budget",
  "inquiry.desiredTiming",
  // Follow-up revision -- see lib/importArtistMatching.ts for how this
  // gets resolved to a real Artist once mapped.
  "inquiry.assignedArtist",
  "depositAmount",
  "note",
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

export const IMPORT_TARGET_FIELD_LABELS: Record<ImportTargetField, string> = {
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  email: "Email",
  address: "Address (single column)",
  "address.street": "Address -- Street",
  "address.city": "Address -- City",
  "address.state": "Address -- State",
  "address.postalCode": "Address -- Postal code",
  "inquiry.description": "Tattoo description",
  "inquiry.placement": "Placement",
  "inquiry.size": "Size",
  "inquiry.budget": "Budget",
  "inquiry.desiredTiming": "Desired timing",
  "inquiry.assignedArtist": "Assigned artist",
  depositAmount: "Deposit amount (gift-card source)",
  note: "Historical Note",
};

const COMPOSITE_ADDRESS_FIELDS: ImportTargetField[] = ["address.street", "address.city", "address.state", "address.postalCode"];

// Fields where at most one CSV column may be mapped -- everything except
// "note" (the whole point of that bucket is many-to-one).
const SINGLE_USE_FIELDS = IMPORT_TARGET_FIELDS.filter((f) => f !== "note");

// Keyword hints used for the auto-suggested mapping only -- staff always
// reviews and can override every suggestion before confirming, so a
// false-positive substring match here is a minor inconvenience, not a
// correctness risk. Ordered by field so a header's best match is whichever
// field's keyword list it hits, longest keyword wins ties (more specific).
const FIELD_KEYWORDS: Record<Exclude<ImportTargetField, "note">, string[]> = {
  firstName: ["first name", "firstname", "fname", "first"],
  lastName: ["last name", "lastname", "lname", "surname", "last"],
  email: ["e-mail", "email"],
  phone: ["phone", "mobile", "cell", "telephone"],
  address: ["mailing address", "street address", "address"],
  "address.street": ["address line 1", "addr1", "address1", "street"],
  "address.city": ["city", "town"],
  "address.state": ["state", "province"],
  "address.postalCode": ["postal code", "zip code", "zipcode", "postcode", "zip"],
  "inquiry.description": ["describe", "description", "tattoo idea", "design idea", "what tattoo"],
  "inquiry.placement": ["placement", "placed", "body part"],
  "inquiry.size": ["size"],
  "inquiry.budget": ["budget", "price range"],
  "inquiry.desiredTiming": ["when would you", "desired timing", "desired date", "timing"],
  "inquiry.assignedArtist": ["assigned artist", "preferred artist", "artist"],
  depositAmount: ["deposit", "amount paid", "payment"],
};

function normalizeHeaderForMatching(header: string): string {
  return header.trim().toLowerCase();
}

// Greedy, deterministic best-guess: for each CSV header (in column order),
// find the target field whose keyword list contains the longest matching
// substring; once a non-"note" field is claimed by an earlier header, later
// headers can no longer be auto-suggested for it (they're left unmapped --
// staff can still assign them manually, including to "note"). "note" is
// never auto-suggested; it's an opt-in bucket, not a catch-all default.
export function suggestColumnMapping(headers: string[]): Record<string, ImportTargetField | null> {
  const claimed = new Set<ImportTargetField>();
  const suggestions: Record<string, ImportTargetField | null> = {};

  for (const header of headers) {
    const normalized = normalizeHeaderForMatching(header);
    let bestField: ImportTargetField | null = null;
    let bestKeywordLength = 0;

    for (const field of SINGLE_USE_FIELDS) {
      if (claimed.has(field)) continue;
      for (const keyword of FIELD_KEYWORDS[field as Exclude<ImportTargetField, "note">]) {
        if (normalized.includes(keyword) && keyword.length > bestKeywordLength) {
          bestField = field;
          bestKeywordLength = keyword.length;
        }
      }
    }

    suggestions[header] = bestField;
    if (bestField) claimed.add(bestField);
  }

  return suggestions;
}

// Returns an error message if invalid, null if valid. mapping is
// Record<csvHeader, ImportTargetField> -- every value must be a real
// target field, and every field other than "note" may be claimed by at
// most one header.
export function validateColumnMapping(mapping: unknown, knownHeaders: string[]): string | null {
  if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
    return "mapping must be an object";
  }

  const entries = Object.entries(mapping as Record<string, unknown>);
  const headerSet = new Set(knownHeaders);
  const claimedSingleUse = new Map<ImportTargetField, string>();

  for (const [header, target] of entries) {
    if (!headerSet.has(header)) {
      return `"${header}" is not a column in this batch's CSV`;
    }
    if (typeof target !== "string" || !IMPORT_TARGET_FIELDS.includes(target as ImportTargetField)) {
      return `"${target}" is not a recognized target field for column "${header}"`;
    }
    if (target !== "note") {
      const field = target as ImportTargetField;
      if (claimedSingleUse.has(field)) {
        return `Only one column can be mapped to ${IMPORT_TARGET_FIELD_LABELS[field]} (both "${claimedSingleUse.get(field)}" and "${header}" are)`;
      }
      claimedSingleUse.set(field, header);
    }
  }

  const hasPlainAddress = claimedSingleUse.has("address");
  const hasCompositeAddress = COMPOSITE_ADDRESS_FIELDS.some((f) => claimedSingleUse.has(f));
  if (hasPlainAddress && hasCompositeAddress) {
    return "Map address as either a single column OR separate Street/City/State/Postal columns, not both";
  }

  return null;
}

// Case-sensitive exact lookup by design -- mapping keys are always the
// batch's own preserved CSV headers, written back verbatim by
// validateColumnMapping above.
export function getMappedRawValue(
  rawData: Record<string, unknown>,
  mapping: Record<string, ImportTargetField>,
  target: Exclude<ImportTargetField, "note">,
): string | null {
  const header = Object.keys(mapping).find((h) => mapping[h] === target);
  if (!header) return null;
  const value = rawData[header];
  return typeof value === "string" ? value.trim() || null : null;
}

export function getNoteHeaders(mapping: Record<string, ImportTargetField>): string[] {
  return Object.keys(mapping).filter((h) => mapping[h] === "note");
}

export function isMalformedRow(rawData: Record<string, unknown>, mapping: Record<string, ImportTargetField> | null): boolean {
  if (!mapping) return true;
  return !getMappedRawValue(rawData, mapping, "firstName") || !getMappedRawValue(rawData, mapping, "lastName");
}

// Defensive dollar-figure extraction from free text -- handles a bare
// "200", "$200", "1,200.50", and embedded text like "Deposit Paid Online -
// $200" (takes the first number-looking substring). Returns null (never a
// guess) when nothing number-like is found at all -- a genuinely
// unparseable cell means "no deposit for this row," not zero.
export function parseDepositAmountCents(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

// Composite-address concatenation -- the ONE seam for a future Google
// Address Validation call (explicitly deferred this session, until Google
// Cloud Console access exists): a later session inserts that call right
// here (validate `parts` or the returned string, get a verdict back,
// optionally flag the row) without touching the row-processing loop that
// calls this, or anything else in the import pipeline. Pure string
// concatenation only, no external call, no standardization/verification --
// the composed string is stored and used exactly as-is.
export interface CompositeAddressParts {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export function composeAddress(parts: CompositeAddressParts): string | null {
  const street = parts.street?.trim() || null;
  const city = parts.city?.trim() || null;
  const state = parts.state?.trim() || null;
  const postalCode = parts.postalCode?.trim() || null;

  const cityStateZip = [city, [state, postalCode].filter(Boolean).join(" ") || null].filter(Boolean).join(", ");
  const composed = [street, cityStateZip || null].filter(Boolean).join(", ");
  return composed || null;
}

// "Well outside the range the studio's own deposit tiers imply as normal":
// more than double the top (catch-all) tier's deposit amount, or
// non-positive when a value was actually present in the cell (a genuine
// $0/negative parse, not a missing column -- callers only invoke this once
// parsedDepositCents is already non-null).
export function isDepositOutlier(depositCents: number, tiers: DepositTier[]): boolean {
  if (depositCents <= 0) return true;
  const topTier = tiers.find((t) => t.maxAmountCents === null) ?? tiers[tiers.length - 1];
  return depositCents > topTier.depositAmountCents * 2;
}

// Column picker: the full set of contact-field columns any client export
// can ever emit, in canonical order. Shared by both POST /clients/export
// (plain CSV) and POST /clients/export-full (ZIP, clients.csv entry) so the
// two paths can never drift on what a given field key means or how it's
// computed -- deliberately its own leaf module (not exported from
// routes/clients.ts and imported by lib/clientFullExport.ts) since that
// direction would be a circular import: routes/clients.ts already imports
// streamClientFullExport from lib/clientFullExport.ts. This list is ALSO
// the hard security floor: health/waiver fields are never added here, so
// there is no key a caller could ever request that would leak them,
// regardless of what either export route's picker does.
export const EXPORT_FIELD_DEFS = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "primaryPhone", label: "Primary Phone" },
  { key: "otherPhones", label: "Other Phones" },
  { key: "primaryEmail", label: "Primary Email" },
  { key: "otherEmails", label: "Other Emails" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "otherContact", label: "Other Contact" },
  { key: "address", label: "Address" },
  { key: "referralCode", label: "Referral Code" },
  { key: "createdDate", label: "Created Date" },
] as const;
export type ExportFieldKey = (typeof EXPORT_FIELD_DEFS)[number]["key"];
export const EXPORT_FIELD_KEYS: readonly string[] = EXPORT_FIELD_DEFS.map((f) => f.key);
export const EXPORT_FIELD_LABELS: Record<ExportFieldKey, string> = Object.fromEntries(
  EXPORT_FIELD_DEFS.map((f) => [f.key, f.label]),
) as Record<ExportFieldKey, string>;

interface ClientContactRow {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  instagramHandle: string | null;
  facebookProfileUrl: string | null;
  otherContact: string | null;
  address: string | null;
  referralCode: string;
  createdAt: Date;
  phones: { phone: string; isPrimary: boolean }[];
  emails: { email: string; isPrimary: boolean }[];
}

// Same primaryPhone/otherPhones/primaryEmail/otherEmails dedup logic
// both export paths need -- factored out so clients.csv (inside the ZIP)
// and the plain CSV export are guaranteed byte-identical for the columns
// they share.
export function buildClientContactValues(c: ClientContactRow): Record<ExportFieldKey, string> {
  const primaryPhone = c.phones.find((p) => p.isPrimary)?.phone ?? c.phones[0]?.phone ?? c.phone ?? "";
  const otherPhones = c.phones.map((p) => p.phone).filter((p) => p !== primaryPhone);
  const primaryEmail = c.emails.find((e) => e.isPrimary)?.email ?? c.emails[0]?.email ?? c.email ?? "";
  const otherEmails = c.emails.map((e) => e.email).filter((e) => e !== primaryEmail);

  return {
    firstName: c.firstName,
    lastName: c.lastName,
    primaryPhone,
    otherPhones: otherPhones.join("; "),
    primaryEmail,
    otherEmails: otherEmails.join("; "),
    instagram: c.instagramHandle ?? "",
    facebook: c.facebookProfileUrl ?? "",
    otherContact: c.otherContact ?? "",
    address: c.address ?? "",
    referralCode: c.referralCode,
    createdDate: c.createdAt.toISOString().slice(0, 10),
  };
}

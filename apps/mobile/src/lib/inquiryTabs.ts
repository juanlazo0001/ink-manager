import { InquiryStatus, type ArtistInquiryListItem } from '@ink-manager/shared-types';

/**
 * The Inquiries / Projects toggle, mirroring apps/web exactly.
 *
 * Web splits one fetch two ways rather than calling two endpoints — the
 * artist page loads `GET /inquiries/assigned-to-me?scope=all` once and
 * filters by status, which is precisely what mobile already fetches. No
 * new API surface, and nothing to flag as missing.
 *
 * The buckets are web's own, assembled from `Inquiries.tsx`:
 *
 *   Inquiries  INQUIRY_TAB_COLUMNS.flatMap(c => c.statuses)
 *              = FLASH_REQUEST_COLUMN + CANDIDACY_REVIEW_COLUMN
 *                + PIPELINE_STEPS.slice(0, 4) + the Inactive column
 *   Projects   PROJECT_TAB_COLUMNS  = PROJECTS_TAB_STATUSES
 *              = SCHEDULING, WAITLISTED, CONFIRMED, ON_HOLD
 *
 * Two things web's comments are explicit about, and which are easy to get
 * backwards:
 *
 *   DEPOSIT_PENDING and both FLASH_* statuses live on INQUIRIES, not
 *   Projects — they are leads awaiting a payment, not converted projects.
 *
 *   ON_HOLD lives on PROJECTS. It is only ever reached from a converted
 *   project, and a pause is not a terminal state, so it does not belong
 *   with CLOSED_LOST / COLD_LEAD / TRANSFERRED in Inactive.
 *
 * Typed as a total `Record<InquiryStatus, …>` on purpose: every one of the
 * fifteen statuses is assigned, and a new value in schema.prisma becomes a
 * compile error here rather than an inquiry that silently belongs to
 * neither tab and disappears from both lists.
 */
export type InquiryTab = 'inquiries' | 'projects';

export const INQUIRY_TABS: { key: InquiryTab; label: string }[] = [
  // Web's own labels, verbatim.
  { key: 'inquiries', label: 'Inquiries' },
  { key: 'projects', label: 'Projects' },
];

const TAB_FOR_STATUS: Record<InquiryStatus, InquiryTab> = {
  [InquiryStatus.CANDIDACY_REVIEW]: 'inquiries',
  [InquiryStatus.NEW]: 'inquiries',
  [InquiryStatus.ARTIST_ASSIGNED]: 'inquiries',
  [InquiryStatus.AWAITING_CLIENT_RESPONSE]: 'inquiries',
  [InquiryStatus.BUDGET_NEGOTIATION]: 'inquiries',
  [InquiryStatus.DEPOSIT_PENDING]: 'inquiries',
  [InquiryStatus.FLASH_PENDING_APPROVAL]: 'inquiries',
  [InquiryStatus.FLASH_PAYMENT_PENDING]: 'inquiries',
  [InquiryStatus.CLOSED_LOST]: 'inquiries',
  [InquiryStatus.COLD_LEAD]: 'inquiries',
  [InquiryStatus.TRANSFERRED]: 'inquiries',

  [InquiryStatus.SCHEDULING]: 'projects',
  [InquiryStatus.WAITLISTED]: 'projects',
  [InquiryStatus.CONFIRMED]: 'projects',
  [InquiryStatus.ON_HOLD]: 'projects',
};

export function tabForStatus(status: InquiryStatus | string): InquiryTab {
  return TAB_FOR_STATUS[status as InquiryStatus] ?? 'inquiries';
}

/**
 * The next session an artist has to show up for.
 *
 * Web's `findNextSession`: the earliest not-yet-checked-out session.
 * Sessions arrive `startTime`-ascending from the backend, so the first
 * one without a `checkedOutAt` is the next one — no sorting needed, and
 * the same convention `deriveProjectStage` and `findCurrentSession` use.
 */
export function findNextSession(
  sessions: ArtistInquiryListItem['sessions'],
): { startTime: string } | null {
  return (sessions ?? []).find((session) => !session.checkedOutAt) ?? null;
}

/**
 * One tab's rows, filtered and ordered the way web orders them.
 *
 * Projects sort by soonest upcoming session — what the artist actually
 * needs to prep for next — with undated projects last but still visible
 * (nothing to prioritise by is not a reason to hide them). Inquiries keep
 * the backend's own most-recently-updated order, untouched.
 */
export function rowsForTab(items: ArtistInquiryListItem[], tab: InquiryTab): ArtistInquiryListItem[] {
  const filtered = items.filter((item) => tabForStatus(item.status) === tab);
  if (tab !== 'projects') return filtered;

  return filtered.slice().sort((a, b) => {
    const aTime = findNextSession(a.sessions)?.startTime;
    const bTime = findNextSession(b.sessions)?.startTime;
    if (!aTime && !bTime) return 0;
    if (!aTime) return 1;
    if (!bTime) return -1;
    return new Date(aTime).getTime() - new Date(bTime).getTime();
  });
}

/**
 * The row's thumbnail: the first reference image.
 *
 * Reference images are what the CLIENT sent as the idea for the piece, so
 * the first one is the closest thing the list has to "what is this
 * inquiry about". Placement photos are deliberately not a fallback —
 * a photo of an arm is not a picture of the work, and showing one where a
 * reference belongs would misrepresent the row.
 */
/**
 * The first reference image, from EITHER list projection.
 *
 * Both carry `referenceImages: string[]` — the staff select has
 * `referenceImages: true` and `StaffInquiryListItem` declares the field —
 * so this is typed on the field rather than on one of the two row types.
 * It used to be typed against the artist row alone, which quietly implied
 * the staff row had nothing to offer it.
 */
export function inquiryThumbnail(item: { referenceImages?: string[] | null }): string | null {
  return item.referenceImages?.[0] ?? null;
}

/**
 * The permission matrix's groups, labels and descriptions.
 *
 * Copied VERBATIM from apps/web/src/lib/permissions.ts, which itself
 * says it "mirrors apps/api/src/lib/permissions.ts's PERMISSION_KEYS --
 * kept in sync manually". That makes this the THIRD hand-maintained copy
 * of the same list, and the drift risk is real: shared-types exists now
 * and already derives InquiryStatus from schema.prisma for exactly this
 * reason. Logged as an API gap rather than quietly accepted.
 *
 * Copied by script rather than retyped, so no key or wording differs
 * from web's by transcription.
 *
 * OWNER is deliberately absent from every matrix: `hasPermission()`
 * returns true for that role before consulting anything, and web says so
 * on the page ("Owner always has full access, in every category below").
 */
export interface PermissionEntry {
  key: string
  label: string
  description: string
}

export interface PermissionGroup {
  label: string
  keys: PermissionEntry[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: 'Inquiries & Projects',
    keys: [
      { key: 'inquiries.view', label: 'View inquiries & projects', description: 'See the inquiries/projects list and detail pages.' },
      { key: 'inquiries.create', label: 'Log a new inquiry', description: 'Record a walk-in or phone-call inquiry on a client’s behalf.' },
      { key: 'inquiries.edit', label: 'Edit inquiries', description: 'Change an inquiry’s details, status, schedule, or deposit info.' },
      { key: 'inquiries.assignArtist', label: 'Assign an artist', description: 'Assign or reassign which artist an inquiry goes to.' },
      { key: 'inquiries.enterEstimate', label: 'Enter a price/time estimate', description: 'Fill in the estimated price or time range for a tattoo.' },
      { key: 'inquiries.sendEstimate', label: 'Send an estimate to the client', description: 'Generate and send the estimate link for the client to review.' },
      { key: 'inquiries.artistSendEstimate', label: 'Artists can send estimates directly', description: 'When approving their own assigned inquiry, an artist generates and sends the estimate link themselves instead of routing it to front desk to send.' },
      { key: 'inquiries.markLost', label: 'Mark an inquiry lost', description: 'Close out an inquiry that didn’t convert.' },
      { key: 'inquiries.notes.manage', label: 'Manage inquiry notes', description: 'Add, edit, or delete internal staff notes on an inquiry.' },
      { key: 'inquiries.shareWithArtist', label: 'Share an inquiry with an artist', description: 'Send a sanitized summary of an inquiry into an artist’s chat.' },
    ],
  },
  {
    label: 'Clients',
    keys: [
      { key: 'clients.view', label: 'View clients', description: 'See the clients list and individual client profiles.' },
      { key: 'clients.edit', label: 'Edit clients', description: 'Create clients and edit their contact info and details.' },
      { key: 'clients.merge', label: 'Merge clients', description: 'Combine two duplicate client records into one.' },
      { key: 'clients.archive', label: 'Archive clients', description: 'Hide a client from the active list without deleting them.' },
      { key: 'clients.import', label: 'Bulk-import clients', description: 'Upload a CSV to add or update many clients at once.' },
    ],
  },
  {
    label: 'Appointments & Calendar',
    keys: [
      { key: 'appointments.view', label: 'View appointments', description: 'See the calendar and appointment details.' },
      { key: 'appointments.create', label: 'Create appointments', description: 'Book a new appointment.' },
      { key: 'appointments.reschedule', label: 'Reschedule appointments', description: 'Change an appointment’s date/time or status, or archive it.' },
      { key: 'appointments.checkout', label: 'Check out an appointment', description: 'Complete an appointment and process payment/gift cards.' },
      { key: 'appointments.photos.manage', label: 'Manage appointment photos', description: 'Upload or delete photos attached to an appointment.' },
    ],
  },
  {
    label: 'Gift Cards & Deposits',
    keys: [
      { key: 'giftCards.view', label: 'View gift cards', description: 'See issued gift cards and their balances.' },
      { key: 'giftCards.issue', label: 'Issue gift cards', description: 'Issue a new gift card and manage its receipt/attachment.' },
      { key: 'giftCards.void', label: 'Void gift cards', description: 'Permanently cancel a gift card.' },
      { key: 'depositTiers.manage', label: 'Manage deposit tiers', description: 'Set the deposit amount required at each price tier.' },
      { key: 'deposits.markPaidManual', label: 'Mark a deposit paid manually', description: 'Record a deposit as paid outside the online form (cash, etc.).' },
    ],
  },
  {
    label: 'Waivers',
    keys: [
      { key: 'waivers.viewStatus', label: 'View waiver status', description: 'See whether a client’s waiver is signed/verified -- never the health answers or ID photo.' },
      { key: 'waivers.verify', label: 'Verify a signed waiver', description: 'Confirm a signed waiver in person.' },
      { key: 'waivers.generate', label: 'Send a waiver link', description: 'Generate and send a waiver link to a client.' },
    ],
  },
  {
    label: 'Conversations',
    keys: [
      { key: 'conversations.viewClientThreads', label: 'View client conversations', description: 'See message threads with clients.' },
      { key: 'conversations.sendLive', label: 'Send live messages', description: 'Actually send a text/email, not just log one for the record.' },
      { key: 'conversations.manageTemplates', label: 'Manage message templates', description: 'Add, edit, or remove canned reply templates.' },
      { key: 'conversations.viewStaffThreads', label: 'View team conversations', description: 'See internal team chat threads.' },
    ],
  },
  {
    label: 'Tasks',
    keys: [
      { key: 'tasks.viewQueue', label: 'View the shared task queue', description: 'See the studio’s system-generated to-do list.' },
      { key: 'tasks.assignToOthers', label: 'Assign tasks to others', description: 'Create a personal task and assign it to a teammate.' },
      { key: 'tasks.manageOwn', label: 'Manage your own tasks', description: 'Create, edit, complete, and delete your own personal tasks.' },
    ],
  },
  {
    label: 'Team & Locations',
    keys: [
      { key: 'team.manage', label: 'Manage team members', description: 'Add, edit, deactivate, or delete staff accounts.' },
      { key: 'locations.manage', label: 'Manage locations', description: 'Add, edit, and delete studio locations and their hours.' },
      { key: 'artists.manage', label: 'Manage artist profiles', description: 'Add and edit artist bios, specialties, and portfolio.' },
      { key: 'artists.view', label: 'View the artists list', description: 'See the studio’s roster of artists.' },
      { key: 'artistSchedules.manage', label: 'Manage artist schedules', description: 'Set an artist’s preferred working hours.' },
      { key: 'residencies.manage', label: 'Manage guest residencies', description: 'Create, edit, and cancel a guest artist’s scheduled residency stints at your studio.' },
    ],
  },
  {
    label: 'Settings',
    keys: [
      { key: 'settings.managePolicies', label: 'Manage policies', description: 'Edit refund, deposit, reschedule, and communication policy text, plus waiver questions.' },
      { key: 'settings.manageDefaults', label: 'Manage studio defaults', description: 'Edit follow-up timing, gift card expiration, timezone, and business hours.' },
      { key: 'settings.manageTheme', label: 'Manage theme', description: 'Change the studio portal’s color theme.' },
      { key: 'audit.view', label: 'View the audit log', description: 'See the history of changes made to a record.' },
      { key: 'settings.manageReferral', label: 'Manage referral program', description: 'Set the reward amount for client referrals.' },
      { key: 'settings.manageArtistVisibility', label: 'Manage artist field visibility', description: 'Choose which project detail fields (pricing/financial detail, internal notes) artists can see.' },
    ],
  },
  {
    label: 'Reports',
    keys: [
      { key: 'reports.viewDashboard', label: 'View the dashboard', description: 'See the funnel, response-time, and artist-utilization reports.' },
      { key: 'reports.viewFinancial', label: 'View financial figures', description: 'See deposit conversion and gift card liability dollar totals.' },
    ],
  },
  {
    label: 'Kanban/Views',
    keys: [
      { key: 'kanban.reorder', label: 'Reorder the Kanban board', description: 'Drag to reorder cards on the pipeline board.' },
      { key: 'bulkActions.use', label: 'Use bulk actions', description: 'Select multiple records and act on them at once.' },
    ],
  },
  {
    label: 'Flash Gallery',
    keys: [
      { key: 'flashGallery.manage', label: 'Manage flash pieces', description: 'Upload new pieces for other artists and retire existing ones -- an artist can always manage their own regardless of this setting. Editing another artist’s existing piece (image, title, price, duration) additionally requires that artist’s own delegation setting to be on (Team → artist → Guest/Home access).' },
    ],
  },
]

export const CONFIGURABLE_ROLES = ['FRONT_DESK', 'ARTIST', 'CUSTOMER'] as const

// The Permissions tab's own two toggleable columns -- OWNER is shown as a
// static "always has full access" note instead of a column (it short-
// circuits every check regardless of matrix state), and CUSTOMER isn't
// surfaced in this grouped UI at all (fixed roles only this session --
// see REPORT.md). CONFIGURABLE_ROLES above stays as the full backend-
// matching list (used by the save payload, which still needs valid role
// values), this is just what's actually rendered.
export const DISPLAYED_ROLES = ['FRONT_DESK', 'ARTIST'] as const

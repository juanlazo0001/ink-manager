import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '../components/Modal'
import RichTextEditor from '../components/RichTextEditor'
import PhoneInput from '../components/PhoneInput'
import IntakeFormsManager from '../components/IntakeFormsManager'
import ServicesManager from '../components/ServicesManager'
import { CheckIcon, ChevronDownIcon, ClockIcon, CloseIcon, CopyIcon, PencilIcon, SpinnerIcon } from '../components/icons'
import { apiFetch } from '../lib/api'
import {
  formatDateTime,
  formatPhoneInput,
  formatRelativeDateTime,
  isValidPhoneDigits,
  readFileAsDataUrl,
  MAX_IMAGE_FILE_BYTES,
} from '../lib/format'
import { navCountsQueryKey } from '../lib/queryKeys'
import { useStudio } from '../context/useStudio'
import { useUserProfile } from '../context/useUserProfile'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { THEME_PRESETS, applyThemePreset } from '../lib/themePresets'
import { dollarsToCents } from '../lib/money'
import { useThemePreset } from '../lib/useThemePreset'
import { LOCALE_LABELS, type Locale } from '../i18n/locales'
import Eyebrow from '../components/Eyebrow'

interface HealthQuestion {
  question: string
  type: 'yes_no' | 'yes_no_explain'
  explainPrompt?: string
}

interface MessageTemplate {
  id: string
  name: string
  body: string
}

// Package C1: configurable deposit-tier lookup (replaces the previously
// hardcoded breakpoints in computeDepositTier).
interface DepositTierData {
  minAmountCents: number
  maxAmountCents: number | null
  depositAmountCents: number
}

interface DepositTierDraft {
  minDollars: string
  maxDollars: string
  depositDollars: string
}

// Package C1: add-your-own policy beyond the fixed 8 HTML fields below.
interface CustomPolicyData {
  id: string
  title: string
  bodyHtml: string | null
  isPublic: boolean
  order: number
  // Multi-language public forms, Part 6: keyed by locale, absent entirely
  // for a policy that's never been translated.
  translations?: Record<string, { title: string | null; bodyHtml: string | null }>
}

// Phase 7A: Settings -> System section (job scheduler observability).
interface JobRunInfo {
  id: string
  scheduledFor: string
  startedAt: string
  finishedAt: string | null
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  details: Record<string, unknown> | null
  error: string | null
}

interface JobInfo {
  jobName: string
  description: string
  schedule: string
  lastRun: JobRunInfo | null
}

// Phase 7B: Settings -> Integrations (self-serve provider connections).
type IntegrationChannelValue = 'SMS' | 'EMAIL' | 'INSTAGRAM' | 'FACEBOOK' | 'GOOGLE_CALENDAR' | 'STRIPE' | 'BIRD_SMS'
type IntegrationStatusValue = 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR'

interface IntegrationInfo {
  channel: IntegrationChannelValue
  status: IntegrationStatusValue
  displayName: string | null
  connectedAt: string | null
  lastError: string | null
  metadata: Record<string, unknown> | null
}

const CHANNEL_LABELS: Record<IntegrationChannelValue, string> = {
  SMS: 'SMS (Twilio)',
  EMAIL: 'Email',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE_CALENDAR: 'Google Calendar',
  STRIPE: 'Stripe (payments)',
  // Coexists with SMS (Twilio) above rather than replacing it -- see
  // schema.prisma's own comment on IntegrationChannel.BIRD_SMS. Client-
  // facing sends still go through Twilio until a future session migrates
  // them; this is opt-in/test-only for now.
  BIRD_SMS: 'SMS (Bird) — new',
}

// Phase 7C: metadata shape for the STRIPE channel specifically -- stored
// as-is by POST /integrations/stripe/connect + /stripe/refresh-status,
// read here for the "Payments are live" vs "Setup incomplete" distinction.
interface StripeIntegrationMetadata {
  stripeAccountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
}

// messagingServiceSid is optional -- left blank, the studio sends from the
// bare From number exactly as before. Filled in, every send routes through
// that Messaging Service instead, which is what carries an approved A2P
// campaign, its Sender Pool and Advanced Opt-Out (see lib/twilio.ts's
// resolveTwilioSender). Blank is submitted as '' and the API treats that as
// "no service", so it also clears a previously-saved one on reconnect.
const EMPTY_SMS_CONNECT_FORM = { accountSid: '', authToken: '', fromNumber: '', messagingServiceSid: '' }

interface StudioSettingsData {
  refundPolicy: string | null
  depositPolicy: string | null
  reschedulePolicy: string | null
  communicationPolicy: string | null
  estimateTerms: string | null
  estimateFollowUpHours: number
  giftCardDefaultExpirationDays: number | null
  referralRewardAmountCents: number
  coldLeadDays: number
  timezone: string
  calendarInviteTemplate: string | null
  waiverHealthQuestions: HealthQuestion[] | null
  waiverClauses: string[] | null
  waiverAcknowledgment: string | null
  waiverPhotoRelease: string | null
  privacyPolicy: string | null
  termsAndConditions: string | null
  messageTemplates: MessageTemplate[] | null
  showSidebarBadges: boolean
  reminderTemplates: ReminderTemplatesData | null
  reminderSendTimes: ReminderSendTimesData | null
  depositTiers: DepositTierData[]
  themePreset: string
  // Settings "Defaults" tab audit (REPORT.md Part 1 proposal): previously
  // hardcoded constants, now studio-level defaults.
  schedulingBufferMinutes: number
  depositFeeCents: number
  // Prepay: studio-level default for which amount mode a fresh deposit form
  // starts on -- staff can still override it per-send (InquiryDetail.tsx's
  // DepositAmountModePicker).
  defaultDepositAmountMode: 'DEPOSIT' | 'FULL_PREPAY'
  reminderWeekBeforeDays: number
  reminderNightBeforeDays: number
  // false (default): a specific referred client can earn their referrer a
  // reward at most once, ever. true: a later, separate project from that
  // same referred client can earn another reward on its own first deposit.
  referralAllowRepeatRedemption: boolean
  // Master on/off for the whole referral program -- default true (matches
  // every studio's always-on behavior before this flag existed).
  referralProgramEnabled: boolean
  // Phase 5: which Inquiry/Project detail field groups an ARTIST-effective
  // caller can see -- both default true (current, pre-feature behavior).
  // Always materialized by the API (never actually null in a real
  // response), typed optional here only because a stale cached response
  // from before this field existed could theoretically lack it.
  artistFieldVisibility?: ArtistFieldVisibilityData
  // Multi-language public forms, Part 6: keyed by locale, each value an
  // object with whichever STUDIO_SETTINGS_TRANSLATABLE_FIELDS keys have
  // ever been saved for that locale -- absent entirely for a studio that's
  // never translated anything.
  translations?: Record<string, Partial<Record<string, unknown>>>
}

// Phase 5: see lib/artistFieldVisibility.ts (API) for the authoritative
// shape/defaults -- kept in sync by hand, same as every other
// StudioSettings JSON field's frontend mirror in this file.
interface ArtistFieldVisibilityData {
  pricingDetail: boolean
  internalNotes: boolean
}

// Phase 7B-2: the SMS reminder cadence's own editable templates/times --
// a separate StudioSettings JSON field from messageTemplates above (that
// one's the Phase 6A composer's canned replies; this is what the
// reminderTicker jobs render and send automatically).
interface ReminderTemplatesData {
  clientWeekBefore: string
  clientNightBefore: string
  clientMorningOf: string
  artistDayBefore: string
  estimateFollowUp: string
  // Twilio inbound-keyword auto-replies -- sent from the webhook on a
  // matched START/YES/UNSTOP or HELP message, not the ticker's own
  // 15-minute cadence, but same JSON field/editor.
  optInConfirmation: string
  helpResponse: string
}

interface ReminderSendTimesData {
  weekBeforeTime: string
  nightBeforeTime: string
  morningOfTime: string
  artistDayBeforeTime: string
}

const DEFAULT_REMINDER_SEND_TIMES: ReminderSendTimesData = {
  weekBeforeTime: '10:00',
  nightBeforeTime: '18:00',
  morningOfTime: '08:00',
  artistDayBeforeTime: '07:00',
}

// Each template only offers the placeholders it actually has data for --
// e.g. an artist never has a waiverLink, an estimate follow-up has no
// appointment at all. Kept as a plain array (not a Record) so display
// order matches the page, same convention as POLICY_HTML_FIELDS.
const REMINDER_TEMPLATE_FIELDS: { key: keyof ReminderTemplatesData; label: string; placeholders: string[] }[] = [
  {
    key: 'clientWeekBefore',
    label: 'Client Reminder — 1 Week Before',
    placeholders: ['clientFirstName', 'appointmentDate', 'appointmentTime', 'artistName', 'waiverLink', 'studioName'],
  },
  {
    key: 'clientNightBefore',
    label: 'Client Reminder — Night Before',
    placeholders: ['clientFirstName', 'appointmentDate', 'appointmentTime', 'artistName', 'waiverLink', 'studioName'],
  },
  {
    key: 'clientMorningOf',
    label: 'Client Reminder — Morning Of',
    placeholders: ['clientFirstName', 'appointmentDate', 'appointmentTime', 'artistName', 'waiverLink', 'studioName'],
  },
  {
    key: 'artistDayBefore',
    label: 'Artist Reminder — Day Before',
    placeholders: ['artistName', 'studioName'],
  },
  {
    key: 'estimateFollowUp',
    label: 'Estimate Follow-Up',
    placeholders: ['clientFirstName', 'estimateLink', 'studioName'],
  },
  {
    key: 'optInConfirmation',
    label: 'SMS Opt-In Confirmation',
    placeholders: ['studioName'],
  },
  {
    key: 'helpResponse',
    label: 'SMS HELP Reply',
    placeholders: ['studioName', 'studioPhone', 'studioEmail'],
  },
]

// Rough GSM-7 segment estimate (160 chars single-segment, 153/segment once
// concatenated) -- good enough for the live counter's purpose of warning
// "this got long", not a byte-exact carrier billing calculation (which
// would also need to detect accented/emoji characters forcing UCS-2's
// shorter 70/67-char limits).
function estimateSmsSegments(text: string): { length: number; segments: number } {
  const length = text.length
  if (length === 0) return { length, segments: 0 }
  if (length <= 160) return { length, segments: 1 }
  return { length, segments: Math.ceil(length / 153) }
}

// Phase UI-3: one row + edit-icon per field, each opening only its own
// WYSIWYG modal (RichTextEditor.tsx). Kept as a plain array (not a Record)
// so display order is explicit and matches the page.
const POLICY_HTML_FIELDS: { key: keyof StudioSettingsData; label: string }[] = [
  { key: 'refundPolicy', label: 'Refund Policy' },
  { key: 'depositPolicy', label: 'Deposit Policy' },
  { key: 'reschedulePolicy', label: 'Reschedule Policy' },
  { key: 'communicationPolicy', label: 'Communication Policy' },
  { key: 'estimateTerms', label: 'Estimate Terms & Conditions' },
  { key: 'waiverAcknowledgment', label: 'Waiver Acknowledgment' },
  { key: 'waiverPhotoRelease', label: 'Photo/Video Release' },
  { key: 'calendarInviteTemplate', label: 'Calendar Invite Template' },
  // A2P 10DLC compliance: public, unauthenticated pages at /privacy/:studioSlug
  // and /terms/:studioSlug -- not legal advice, seeded default text is a
  // reasonable starting point flagged for a lawyer's review.
  { key: 'privacyPolicy', label: 'Privacy Policy' },
  { key: 'termsAndConditions', label: 'Terms & Conditions' },
]

// Multi-language public forms, Part 6: the subset of POLICY_HTML_FIELDS
// (and the two waiver list fields below) that actually has a column on
// StudioSettingsTranslation -- calendarInviteTemplate is staff-only chrome,
// never shown to a client, so it deliberately has no locale tab. Matches
// apps/api/src/routes/studioSettings.ts's own STUDIO_SETTINGS_TRANSLATABLE_FIELDS
// exactly.
const STUDIO_SETTINGS_TRANSLATABLE_FIELDS = new Set<keyof StudioSettingsData>([
  'refundPolicy',
  'depositPolicy',
  'reschedulePolicy',
  'communicationPolicy',
  'estimateTerms',
  'waiverAcknowledgment',
  'waiverPhotoRelease',
  'privacyPolicy',
  'termsAndConditions',
])

// Strips tags for the compact row preview (plain text only, never rendered
// as HTML -- React text interpolation escapes it same as any other string,
// so this needs no sanitizer of its own; it's the modal editor and the
// public-facing render sites that handle real HTML and need one).
function stripHtmlPreview(html: string | null, maxLen = 140): string {
  if (!html) return 'No content yet'
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'No content yet'
  return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}…` : text
}

// i18n fix pass: TipTap's own "nothing typed" serialization is never a
// true empty string -- it's an empty paragraph tag (`<p></p>`, or
// `<p><br></p>` right after a delete) -- so a bare `.trim() || null`
// check on the raw HTML sees a non-empty string and saves that literal
// markup as the Spanish translation. withLocale (contentTranslation.ts)
// only falls back to English when a field is exactly `null`/`undefined`/
// `""`; `"<p></p>"` fails that check, so the studio's own English
// fallback rule silently breaks for exactly the fields cleared through
// this editor -- the public page renders a blank paragraph instead of
// the English text. Same tag-stripping approach as stripHtmlPreview
// above, just as a boolean gate instead of a display string.
function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim() === ''
}

// Mirrors apps/api/src/routes/studioSettings.ts's VALID_TIMEZONES -- kept
// as a literal list for the same reason other backend/frontend mirrored
// lists in this codebase are (separate compilation units, no shared
// import). Plain-language labels per the standing design mandate: a raw
// IANA identifier is exactly the kind of thing a non-technical owner
// shouldn't have to parse.
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern Time' },
  { value: 'America/Chicago', label: 'Central Time' },
  { value: 'America/Denver', label: 'Mountain Time' },
  { value: 'America/Phoenix', label: 'Mountain Time (no DST, Arizona)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
]

function timezoneLabel(value: string): string {
  return TIMEZONE_OPTIONS.find((tz) => tz.value === value)?.label ?? value
}

const EMPTY_DEFAULTS_FORM = {
  estimateFollowUpHours: '24',
  giftCardDefaultExpirationDays: '',
  referralRewardDollars: '25',
  coldLeadDays: '90',
  timezone: 'America/New_York',
  showSidebarBadges: false,
  // Settings "Defaults" tab audit (REPORT.md Part 1 proposal): previously
  // hardcoded constants -- '90' minutes = 1.5h, '10' dollars = $10, matching
  // the prior hardcoded behavior exactly.
  schedulingBufferMinutes: '90',
  depositFeeDollars: '10',
  defaultDepositAmountMode: 'DEPOSIT' as 'DEPOSIT' | 'FULL_PREPAY',
  referralAllowRepeatRedemption: false,
  referralProgramEnabled: true,
}

// Phase 7A jobs are documented here in plain language; extend this
// dictionary as later phases register more jobs (see apps/api/src/lib/jobs).
const JOB_DISPLAY: Record<string, { friendlyName: string; plainDescription: string }> = {
  giftCardExpirationSweep: {
    friendlyName: 'Gift Card Expiration',
    plainDescription: 'Automatically marks gift cards as expired once their expiration date has passed.',
  },
  coldLeadSweep: {
    friendlyName: 'Cold Lead Detection',
    plainDescription: 'Automatically flags inquiries as cold leads after a period of no activity.',
  },
  clientAppointmentReminders: {
    friendlyName: 'Appointment Reminders (Clients)',
    plainDescription:
      'Texts clients a week before, the night before, and the morning of their appointment, in the studio’s own local time.',
  },
  artistAppointmentReminders: {
    friendlyName: 'Appointment Reminders (Artists)',
    plainDescription: 'Sends each artist one consolidated text listing their appointments for the next day.',
  },
  estimateFollowUpReminder: {
    friendlyName: 'Estimate Follow-Up',
    plainDescription: 'Texts a client who opened an estimate but hasn’t responded within 24 hours.',
  },
}

const EMPTY_HEALTH_QUESTION: HealthQuestion = { question: '', type: 'yes_no', explainPrompt: '' }

// Multi-language public forms, Part 6: aligns a Spanish
// StudioSettingsTranslation.waiverHealthQuestions array to the CURRENT
// English list's length/order -- a saved translation might be shorter (an
// English question added since) or the same shape; either way this always
// returns exactly `english.length` strings, empty for any row with no
// saved Spanish text yet.
function zipEsHealthQuestions(english: HealthQuestion[], es: unknown): { question: string; explainPrompt: string }[] {
  const esList = Array.isArray(es) ? (es as Partial<HealthQuestion>[]) : []
  return english.map((_, i) => ({ question: esList[i]?.question ?? '', explainPrompt: esList[i]?.explainPrompt ?? '' }))
}

function zipEsClauses(english: string[], es: unknown): string[] {
  const esList = Array.isArray(es) ? (es as string[]) : []
  return english.map((_, i) => esList[i] ?? '')
}

const EMPTY_STUDIO_FORM = { name: '', website: '' }

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface LocationHoursDay {
  day: number
  closed: boolean
  open: string | null
  close: string | null
}

interface Location {
  id: string
  studioId: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  hours: LocationHoursDay[] | null
  createdAt: string
}

const EMPTY_LOCATION_FORM = { name: '', address: '', phone: '', email: '' }

function defaultHours(): LocationHoursDay[] {
  return Array.from({ length: 7 }, (_, day) => ({ day, closed: true, open: null, close: null }))
}

function googleMapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function formatTime12h(value: string): string {
  const [hStr, mStr] = value.split(':')
  const hour = Number(hStr)
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${mStr} ${period}`
}

function hoursSummary(hours: LocationHoursDay[] | null) {
  if (!hours) return null
  return [...hours]
    .sort((a, b) => a.day - b.day)
    .map((day) => ({
      label: DAY_LABELS[day.day],
      text: day.closed || !day.open || !day.close ? 'Closed' : `${formatTime12h(day.open)} – ${formatTime12h(day.close)}`,
    }))
}

export default function Settings() {
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  const { studio, loading, refresh } = useStudio()
  const { profile } = useUserProfile()
  const user = useEffectiveUser()
  // OWNER-only, matching PATCH /studios/:studioId's own requireRole(OWNER)
  // -- no longer a configurable permission (a real studio had this granted
  // to ARTIST via the matrix, letting any artist rename the business or
  // swap its logo). See lib/permissions.ts's own comment on why
  // "studio.manage" was retired rather than just defaulted off.
  const canManageStudio = user?.role === 'OWNER'
  const canManageLocations = profile?.permissions.includes('locations.manage') ?? false
  const canViewPolicies = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const isOwner = user?.role === 'OWNER'
  // The "Policies" tab bundles several independently-configurable
  // permissions behind one screen -- each edit control below is gated on
  // its own actual key (matching apps/api/src/routes/studioSettings.ts's
  // own presentSettingsPermissionGroups, which checks each field-group
  // separately), not one shared OWNER-only flag. Custom Policies and the
  // intake-form editor stay real isOwner checks -- those two routes
  // (customPolicies.ts's write routes, intakeForms.ts's PUT /:id/fields)
  // are hardcoded requireRole(OWNER) on the backend, not configurable
  // permissions, so there's no matrix key for them to follow.
  const canManageTheme = profile?.permissions.includes('settings.manageTheme') ?? false
  const canManagePolicies = profile?.permissions.includes('settings.managePolicies') ?? false
  const canManageDefaults = profile?.permissions.includes('settings.manageDefaults') ?? false
  const canManageReferral = profile?.permissions.includes('settings.manageReferral') ?? false
  // Phase 5: meaningless for a solo studio-of-one (there's no other artist
  // for the toggle to govern -- the owner-artist sees everything in their
  // own studio regardless, same as every other artist-facing control in
  // this codebase's established solo-UI convention), so the section is
  // hidden outright for one rather than shown disabled/no-op.
  const canManageArtistVisibility =
    (profile?.permissions.includes('settings.manageArtistVisibility') ?? false) && !profile?.isSoloStudio
  const canManageTemplates = profile?.permissions.includes('conversations.manageTemplates') ?? false
  const canManageDepositTiers = profile?.permissions.includes('depositTiers.manage') ?? false
  // OWNER only, matching GET/POST /jobs's own requireRole(Role.OWNER) --
  // stricter than canViewPolicies above, which also lets FRONT_DESK in.
  const canViewSystem = user?.role === 'OWNER'
  const queryClient = useQueryClient()

  const [jobs, setJobs] = useState<JobInfo[] | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [runningJob, setRunningJob] = useState<string | null>(null)

  useEffect(() => {
    if (!canViewSystem) return
    let ignore = false

    apiFetch<JobInfo[]>('/jobs')
      .then((data) => {
        if (!ignore) setJobs(data)
      })
      .catch((err) => {
        if (!ignore) setJobsError(err instanceof Error ? err.message : 'Failed to load jobs')
      })

    return () => {
      ignore = true
    }
  }, [canViewSystem])

  async function handleRunNow(jobName: string) {
    setRunningJob(jobName)
    setJobsError(null)
    try {
      await apiFetch(`/jobs/${jobName}/run-now`, { method: 'POST' })
      const refreshed = await apiFetch<JobInfo[]>('/jobs')
      setJobs(refreshed)
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Failed to run job')
    } finally {
      setRunningJob(null)
    }
  }

  // OWNER only, matching POST /integrations's own requireRole(Role.OWNER).
  const canViewIntegrations = user?.role === 'OWNER'

  // Settings grew long enough to need tabs (General/Policies/Integrations/
  // System) -- each tab hides entirely (not just shows empty) for a role
  // that can't see anything in it, same gating each card already had before
  // tabs existed, just applied one level up so the tab button itself never
  // appears for a role that would find nothing behind it.
  // Service lines: OWNER only, matching this feature's own explicit
  // "Services management area (OWNER only)" requirement -- same hardcoded
  // requireRole(Role.OWNER) pattern GET/POST /services and canViewSystem
  // above already use, not a configurable permission-matrix entry.
  const canViewServices = user?.role === 'OWNER'

  const SETTINGS_TABS = [
    { key: 'general' as const, label: 'General', visible: true },
    { key: 'policies' as const, label: 'Policies & Templates', visible: canViewPolicies },
    // Settings "Defaults" tab audit (REPORT.md's Part 1 proposal): the
    // numeric/operational defaults (estimate follow-up, gift card
    // expiration, referral reward, cold lead window, deposit tiers,
    // reminder cadence, scheduling buffer, deposit fee) moved here out of
    // Policies & Templates, which now holds only actual policy TEXT and
    // templates (WYSIWYG policy fields, waiver questions/clauses, message
    // templates, intake forms). Same visibility as Policies & Templates --
    // this is a relocation of already-gated content, not a new capability.
    { key: 'defaults' as const, label: 'Defaults', visible: canViewPolicies },
    { key: 'services' as const, label: 'Services', visible: canViewServices },
    { key: 'integrations' as const, label: 'Integrations', visible: canViewIntegrations },
    { key: 'system' as const, label: 'System', visible: canViewSystem },
  ]
  const [activeTab, setActiveTab] = useState<
    'general' | 'policies' | 'defaults' | 'services' | 'integrations' | 'system'
  >('general')
  const [searchParams, setSearchParams] = useSearchParams()

  const [integrations, setIntegrations] = useState<IntegrationInfo[] | null>(null)
  const [smsWebhookUrl, setSmsWebhookUrl] = useState<string | null>(null)
  const [integrationsError, setIntegrationsError] = useState<string | null>(null)
  const [integrationsRefreshIndex, setIntegrationsRefreshIndex] = useState(0)

  const [showConnectSms, setShowConnectSms] = useState(false)
  const [smsConnectForm, setSmsConnectForm] = useState(EMPTY_SMS_CONNECT_FORM)
  const [smsConnecting, setSmsConnecting] = useState(false)
  const [smsConnectError, setSmsConnectError] = useState<string | null>(null)

  // Generalized across channels (SMS/EMAIL) -- same confirm-modal shape,
  // just a different title/body/disconnect call per channel.
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState<IntegrationChannelValue | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const [testMessageTo, setTestMessageTo] = useState('')
  const [testMessageSending, setTestMessageSending] = useState(false)
  const [testMessageResult, setTestMessageResult] = useState<string | null>(null)

  const [connectingGmail, setConnectingGmail] = useState(false)
  const [gmailOAuthNotice, setGmailOAuthNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<string | null>(null)

  const [connectingStripe, setConnectingStripe] = useState(false)
  const [stripeError, setStripeError] = useState<string | null>(null)

  const [connectingBirdSms, setConnectingBirdSms] = useState(false)
  const [birdSmsError, setBirdSmsError] = useState<string | null>(null)
  const [testBirdSmsTo, setTestBirdSmsTo] = useState('')
  const [testBirdSmsSending, setTestBirdSmsSending] = useState(false)
  const [testBirdSmsResult, setTestBirdSmsResult] = useState<string | null>(null)

  // Picks up after the Gmail OAuth redirect (or Stripe's Account Link
  // return_url/refresh_url) lands back here -- reads the query params it
  // was redirected with, shows a one-time banner / re-syncs Stripe's
  // account status, refreshes the integration list, then strips the params
  // so a page refresh doesn't repeat any of this.
  useEffect(() => {
    const tab = searchParams.get('tab')
    const email = searchParams.get('email')
    const stripeReturn = searchParams.get('stripe')
    if (tab !== 'integrations' && !email && !stripeReturn) return

    if (tab === 'integrations') setActiveTab('integrations')
    if (email === 'connected') {
      setGmailOAuthNotice({ kind: 'success', message: 'Gmail connected.' })
      setIntegrationsRefreshIndex((i) => i + 1)
    } else if (email === 'error') {
      setGmailOAuthNotice({ kind: 'error', message: searchParams.get('message') || 'Failed to connect Gmail.' })
    }

    // Both return (onboarding completed) and refresh (studio left mid-way
    // and came back, or clicked out) land here needing the same thing:
    // re-read the account's live status from Stripe rather than trusting
    // the redirect alone.
    if (stripeReturn === 'return' || stripeReturn === 'refresh') {
      apiFetch('/integrations/stripe/refresh-status', { method: 'POST' })
        .catch((err) => setStripeError(err instanceof Error ? err.message : 'Failed to check Stripe account status'))
        .finally(() => setIntegrationsRefreshIndex((i) => i + 1))
    }

    setSearchParams((params) => {
      params.delete('tab')
      params.delete('email')
      params.delete('message')
      params.delete('stripe')
      return params
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleConnectStripe() {
    setConnectingStripe(true)
    setStripeError(null)
    try {
      const { url } = await apiFetch<{ url: string }>('/integrations/stripe/connect', { method: 'POST' })
      window.location.href = url
    } catch (err) {
      setStripeError(err instanceof Error ? err.message : 'Failed to start connecting Stripe')
      setConnectingStripe(false)
    }
  }

  // No credential to collect (see CHANNEL_LABELS.BIRD_SMS's own comment)
  // -- "connect" is a single opt-in POST, not a form submit, same shape as
  // handleConnectStripe's request/refresh pattern minus the redirect.
  async function handleConnectBirdSms() {
    setConnectingBirdSms(true)
    setBirdSmsError(null)
    try {
      await apiFetch('/integrations/BIRD_SMS/connect', { method: 'POST' })
      setIntegrationsRefreshIndex((i) => i + 1)
    } catch (err) {
      setBirdSmsError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setConnectingBirdSms(false)
    }
  }

  async function handleSendTestBirdSms(event: FormEvent) {
    event.preventDefault()
    setTestBirdSmsSending(true)
    setTestBirdSmsResult(null)

    try {
      await apiFetch('/integrations/BIRD_SMS/test-message', {
        method: 'POST',
        body: JSON.stringify({ to: testBirdSmsTo }),
      })
      setTestBirdSmsResult('Test message sent.')
    } catch (err) {
      setTestBirdSmsResult(err instanceof Error ? err.message : 'Failed to send the test message')
    } finally {
      setTestBirdSmsSending(false)
    }
  }

  const [copiedWebhook, setCopiedWebhook] = useState(false)

  useEffect(() => {
    if (!canViewIntegrations) return
    let ignore = false

    apiFetch<{ channels: IntegrationInfo[]; smsWebhookUrl: string }>('/integrations')
      .then((data) => {
        if (ignore) return
        setIntegrations(data.channels)
        setSmsWebhookUrl(data.smsWebhookUrl)
      })
      .catch((err) => {
        if (!ignore) setIntegrationsError(err instanceof Error ? err.message : 'Failed to load integrations')
      })

    return () => {
      ignore = true
    }
  }, [canViewIntegrations, integrationsRefreshIndex])

  async function handleConnectSms(event: FormEvent) {
    event.preventDefault()
    setSmsConnecting(true)
    setSmsConnectError(null)

    try {
      await apiFetch('/integrations/SMS/connect', {
        method: 'POST',
        body: JSON.stringify(smsConnectForm),
      })
      setShowConnectSms(false)
      setSmsConnectForm(EMPTY_SMS_CONNECT_FORM)
      setIntegrationsRefreshIndex((i) => i + 1)
    } catch (err) {
      setSmsConnectError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setSmsConnecting(false)
    }
  }

  async function handleDisconnectChannel(channel: IntegrationChannelValue) {
    setDisconnecting(true)
    try {
      await apiFetch(`/integrations/${channel}/disconnect`, { method: 'POST' })
      setShowDisconnectConfirm(null)
      setTestMessageResult(null)
      setTestEmailResult(null)
      setTestBirdSmsResult(null)
      setIntegrationsRefreshIndex((i) => i + 1)
    } catch (err) {
      setIntegrationsError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleSendTestMessage(event: FormEvent) {
    event.preventDefault()
    setTestMessageSending(true)
    setTestMessageResult(null)

    try {
      await apiFetch('/integrations/SMS/test-message', {
        method: 'POST',
        body: JSON.stringify({ to: testMessageTo }),
      })
      setTestMessageResult('Test message sent.')
    } catch (err) {
      setTestMessageResult(err instanceof Error ? err.message : 'Failed to send the test message')
    } finally {
      setTestMessageSending(false)
    }
  }

  // Full-page redirect to Google's own consent screen -- this can't be a
  // normal fetch, since only the browser holds the session that then comes
  // back through Google's own redirect to the public callback route.
  async function handleConnectGmail() {
    setConnectingGmail(true)
    setGmailOAuthNotice(null)
    try {
      const { url } = await apiFetch<{ url: string }>('/integrations/email/connect-url')
      window.location.href = url
    } catch (err) {
      setGmailOAuthNotice({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to start connecting Gmail' })
      setConnectingGmail(false)
    }
  }

  async function handleSendTestEmail(event: FormEvent) {
    event.preventDefault()
    setTestEmailSending(true)
    setTestEmailResult(null)

    try {
      await apiFetch('/integrations/EMAIL/test-message', {
        method: 'POST',
        body: JSON.stringify({ to: testEmailTo }),
      })
      setTestEmailResult('Test email sent.')
    } catch (err) {
      setTestEmailResult(err instanceof Error ? err.message : 'Failed to send the test email')
    } finally {
      setTestEmailSending(false)
    }
  }

  async function handleCopyWebhookUrl() {
    if (!smsWebhookUrl) return
    try {
      await navigator.clipboard.writeText(smsWebhookUrl)
      setCopiedWebhook(true)
      setTimeout(() => setCopiedWebhook(false), 2000)
    } catch {
      // Non-critical -- the URL is also selectable/visible as plain text.
    }
  }

  const [policies, setPolicies] = useState<StudioSettingsData | null>(null)

  // Phase UI-3: each of the HTML policy fields edits through its own
  // modal -- editingField names which POLICY_HTML_FIELDS key is open (or
  // null), fieldDraft holds that one field's in-progress HTML.
  const [editingField, setEditingField] = useState<keyof StudioSettingsData | null>(null)
  const [fieldDraft, setFieldDraft] = useState('')
  const [fieldDraftEs, setFieldDraftEs] = useState('')
  const [fieldLocale, setFieldLocale] = useState<Locale>('en')
  const [fieldSaving, setFieldSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  // The 5 non-HTML "Defaults" fields share one grouped modal instead.
  const [showDefaultsModal, setShowDefaultsModal] = useState(false)
  const [defaultsForm, setDefaultsForm] = useState(EMPTY_DEFAULTS_FORM)
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)

  // Waiver health-questions/clauses: unchanged dedicated list editor (out
  // of this phase's WYSIWYG scope), just re-homed under its own edit
  // toggle now that there's no single mega-form to nest it inside.
  const [waiverHealthQuestions, setWaiverHealthQuestions] = useState<HealthQuestion[]>([])
  const [waiverClauses, setWaiverClauses] = useState<string[]>([])
  const [editingWaiverList, setEditingWaiverList] = useState(false)
  const [waiverListSaving, setWaiverListSaving] = useState(false)
  const [waiverListError, setWaiverListError] = useState<string | null>(null)
  // Multi-language public forms, Part 6: index-aligned with
  // waiverHealthQuestions/waiverClauses above -- a Spanish translation is
  // "the text for row N," not an independently addable/removable list of
  // its own, since the two arrays must stay the same shape for
  // resolveWaiverSnapshotContent's own per-index rendering. Kept in sync by
  // the same add/remove handlers below.
  const [waiverHealthQuestionsEs, setWaiverHealthQuestionsEs] = useState<string[]>([])
  const [waiverHealthExplainEs, setWaiverHealthExplainEs] = useState<string[]>([])
  const [waiverClausesEs, setWaiverClausesEs] = useState<string[]>([])
  const [waiverListLocale, setWaiverListLocale] = useState<Locale>('en')

  // Message templates: same treatment as the waiver list above.
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([])
  const [editingTemplates, setEditingTemplates] = useState(false)
  const [templatesSaving, setTemplatesSaving] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)

  // Reminder templates: each of the 5 fixed keys edits through its own
  // modal (same edit-icon convention as POLICY_HTML_FIELDS), just a plain
  // textarea instead of RichTextEditor since these are SMS bodies.
  const [editingReminderTemplate, setEditingReminderTemplate] = useState<keyof ReminderTemplatesData | null>(null)
  const [reminderTemplateDraft, setReminderTemplateDraft] = useState('')
  const [reminderTemplateSaving, setReminderTemplateSaving] = useState(false)
  const [reminderTemplateError, setReminderTemplateError] = useState<string | null>(null)
  const reminderTemplateTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Reminder send times: same own-card, own-Edit-toggle treatment as
  // Business Hours above.
  const [reminderSendTimes, setReminderSendTimes] = useState<ReminderSendTimesData>(DEFAULT_REMINDER_SEND_TIMES)
  const [editingSendTimes, setEditingSendTimes] = useState(false)
  // Settings "Defaults" tab audit (REPORT.md Part 1 proposal): which DAY
  // each reminder fires, previously hardcoded -- edited alongside Send
  // Times (the reminder cadence's TIME of day) since they're the same
  // "when does this reminder go out" concept, just saved as their own
  // top-level StudioSettings fields rather than part of the
  // reminderSendTimes JSON blob.
  const [reminderCadenceDays, setReminderCadenceDays] = useState({ weekBeforeDays: '7', nightBeforeDays: '1' })
  const [sendTimesSaving, setSendTimesSaving] = useState(false)
  const [sendTimesError, setSendTimesError] = useState<string | null>(null)

  // Custom Policies (Package C1 §1): an open-ended list instead of the
  // fixed POLICY_HTML_FIELDS keys, but the same per-item edit-icon+modal
  // interaction. editingCustomPolicy is either a real row (editing), the
  // literal string 'new' (creating), or null (modal closed).
  const [customPolicies, setCustomPolicies] = useState<CustomPolicyData[] | null>(null)
  const [editingCustomPolicy, setEditingCustomPolicy] = useState<CustomPolicyData | 'new' | null>(null)
  const [customPolicyTitleDraft, setCustomPolicyTitleDraft] = useState('')
  const [customPolicyBodyDraft, setCustomPolicyBodyDraft] = useState('')
  const [customPolicyPublicDraft, setCustomPolicyPublicDraft] = useState(false)
  const [customPolicyTitleEsDraft, setCustomPolicyTitleEsDraft] = useState('')
  const [customPolicyBodyEsDraft, setCustomPolicyBodyEsDraft] = useState('')
  const [customPolicyLocale, setCustomPolicyLocale] = useState<Locale>('en')
  const [customPolicySaving, setCustomPolicySaving] = useState(false)
  const [customPolicyError, setCustomPolicyError] = useState<string | null>(null)
  const [deletingCustomPolicyId, setDeletingCustomPolicyId] = useState<string | null>(null)

  // Deposit Tiers (Package C1 §2): same own-card, own-Edit-toggle treatment
  // as Send Times above, but a variable-length list instead of fixed keys
  // -- drafts are kept in dollars (matching every other dollar-amount input
  // in this app) and converted to/from cents only at the API boundary.
  const [editingDepositTiers, setEditingDepositTiers] = useState(false)
  const [depositTiersDraft, setDepositTiersDraft] = useState<DepositTierDraft[]>([])
  const [depositTiersSaving, setDepositTiersSaving] = useState(false)
  const [depositTiersError, setDepositTiersError] = useState<string | null>(null)

  // Package C2: theme presets.
  const [themeSavingKey, setThemeSavingKey] = useState<string | null>(null)
  const [themeError, setThemeError] = useState<string | null>(null)

  // Phase 5: artist field visibility -- same own-card, own-Edit-toggle
  // treatment as Deposit Tiers/Reminder Send Times above.
  const [editingArtistVisibility, setEditingArtistVisibility] = useState(false)
  const [artistVisibilityDraft, setArtistVisibilityDraft] = useState<ArtistFieldVisibilityData>({
    pricingDetail: true,
    internalNotes: true,
  })
  const [artistVisibilitySaving, setArtistVisibilitySaving] = useState(false)
  const [artistVisibilityError, setArtistVisibilityError] = useState<string | null>(null)

  useEffect(() => {
    if (!canViewPolicies) return
    let ignore = false
    apiFetch<CustomPolicyData[]>('/custom-policies')
      .then((data) => {
        if (!ignore) setCustomPolicies(data)
      })
      .catch(() => {
        /* Section just stays empty if this fails; not critical page content. */
      })
    return () => {
      ignore = true
    }
  }, [canViewPolicies])

  useEffect(() => {
    if (!canViewPolicies) return

    let ignore = false

    apiFetch<StudioSettingsData>('/studio-settings')
      .then((data) => {
        if (ignore) return
        setPolicies(data)
        const englishQuestions = data.waiverHealthQuestions ?? []
        const englishClauses = data.waiverClauses ?? []
        setWaiverHealthQuestions(englishQuestions)
        setWaiverClauses(englishClauses)
        const zippedEsQuestions = zipEsHealthQuestions(englishQuestions, data.translations?.es?.waiverHealthQuestions)
        setWaiverHealthQuestionsEs(zippedEsQuestions.map((q) => q.question))
        setWaiverHealthExplainEs(zippedEsQuestions.map((q) => q.explainPrompt))
        setWaiverClausesEs(zipEsClauses(englishClauses, data.translations?.es?.waiverClauses))
        setMessageTemplates(data.messageTemplates ?? [])
        setReminderSendTimes(data.reminderSendTimes ?? DEFAULT_REMINDER_SEND_TIMES)
        setReminderCadenceDays({
          weekBeforeDays: String(data.reminderWeekBeforeDays),
          nightBeforeDays: String(data.reminderNightBeforeDays),
        })
      })
      .catch(() => {
        // Section just stays empty if this fails; not critical page content.
      })

    return () => {
      ignore = true
    }
  }, [canViewPolicies])

  function openFieldModal(key: keyof StudioSettingsData) {
    setEditingField(key)
    setFieldDraft((policies?.[key] as string | null) ?? '')
    setFieldDraftEs((policies?.translations?.es?.[key] as string | null) ?? '')
    setFieldLocale('en')
    setFieldError(null)
  }

  async function handleFieldSave() {
    if (!editingField) return
    setFieldSaving(true)
    setFieldError(null)
    try {
      const isTranslatable = STUDIO_SETTINGS_TRANSLATABLE_FIELDS.has(editingField)
      const esValue = isEmptyHtml(fieldDraftEs) ? null : fieldDraftEs
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          [editingField]: fieldDraft,
          ...(isTranslatable ? { translations: { es: { [editingField]: esValue } } } : {}),
        }),
      })
      // PATCH doesn't echo translations back (a sibling table, upserted
      // after the base row) -- merged in locally from what was just
      // submitted, same as the CustomPolicy/Service/FlashPiece editors.
      setPolicies({
        ...updated,
        translations: isTranslatable
          ? {
              ...policies?.translations,
              es: { ...policies?.translations?.es, [editingField]: esValue },
            }
          : policies?.translations,
      })
      setEditingField(null)
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setFieldSaving(false)
    }
  }

  function openCustomPolicyModal(policy: CustomPolicyData | 'new') {
    const es = policy === 'new' ? undefined : policy.translations?.es
    setEditingCustomPolicy(policy)
    setCustomPolicyTitleDraft(policy === 'new' ? '' : policy.title)
    setCustomPolicyBodyDraft(policy === 'new' ? '' : (policy.bodyHtml ?? ''))
    setCustomPolicyPublicDraft(policy === 'new' ? false : policy.isPublic)
    setCustomPolicyTitleEsDraft(es?.title ?? '')
    setCustomPolicyBodyEsDraft(es?.bodyHtml ?? '')
    setCustomPolicyLocale('en')
    setCustomPolicyError(null)
  }

  async function handleCustomPolicySave() {
    if (!editingCustomPolicy) return
    setCustomPolicySaving(true)
    setCustomPolicyError(null)
    try {
      const esTitle = customPolicyTitleEsDraft.trim()
      const esBody = customPolicyBodyEsDraft
      // Neither POST nor PATCH echoes translations back on the base entity
      // (they're a sibling table, upserted server-side after the base row
      // is written) -- merged in locally from what was just submitted
      // rather than left stale until the next full list refetch.
      //
      // Fix pass: always sent, title/bodyHtml null when empty -- never
      // gated on esTitle || esBody, which used to omit the whole
      // `translations` key (and so leave a removed translation's stale
      // row untouched) the moment a studio cleared both fields back out.
      // bodyHtml is RichTextEditor content, not plain text -- gated on
      // isEmptyHtml (see its own comment) rather than a bare `.trim() ||
      // null`, which would save TipTap's empty-paragraph markup as if it
      // were real Spanish content and defeat the English fallback.
      const translations = { es: { title: esTitle || null, bodyHtml: isEmptyHtml(esBody) ? null : esBody } }

      if (editingCustomPolicy === 'new') {
        const created = await apiFetch<CustomPolicyData>('/custom-policies', {
          method: 'POST',
          body: JSON.stringify({
            title: customPolicyTitleDraft,
            bodyHtml: customPolicyBodyDraft,
            isPublic: customPolicyPublicDraft,
            translations,
          }),
        })
        setCustomPolicies((prev) => [...(prev ?? []), { ...created, translations }])
      } else {
        const updated = await apiFetch<CustomPolicyData>(`/custom-policies/${editingCustomPolicy.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: customPolicyTitleDraft,
            bodyHtml: customPolicyBodyDraft,
            isPublic: customPolicyPublicDraft,
            translations,
          }),
        })
        setCustomPolicies((prev) => (prev ?? []).map((p) => (p.id === updated.id ? { ...updated, translations } : p)))
      }
      setEditingCustomPolicy(null)
    } catch (err) {
      setCustomPolicyError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setCustomPolicySaving(false)
    }
  }

  async function handleDeleteCustomPolicy(id: string) {
    setCustomPolicyError(null)
    try {
      await apiFetch(`/custom-policies/${id}`, { method: 'DELETE' })
      setCustomPolicies((prev) => (prev ?? []).filter((p) => p.id !== id))
      setDeletingCustomPolicyId(null)
    } catch (err) {
      setCustomPolicyError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  async function moveCustomPolicy(index: number, direction: -1 | 1) {
    if (!customPolicies) return
    const target = index + direction
    if (target < 0 || target >= customPolicies.length) return

    const reordered = [...customPolicies]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    setCustomPolicies(reordered)
    setCustomPolicyError(null)

    try {
      const saved = await apiFetch<CustomPolicyData[]>('/custom-policies/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds: reordered.map((p) => p.id) }),
      })
      setCustomPolicies(saved)
    } catch (err) {
      setCustomPolicyError(err instanceof Error ? err.message : 'Failed to reorder')
    }
  }

  function centsToDollarsInput(cents: number): string {
    return (cents / 100).toString()
  }

  function startEditingDepositTiers() {
    setDepositTiersDraft(
      (policies?.depositTiers ?? []).map((tier) => ({
        minDollars: centsToDollarsInput(tier.minAmountCents),
        maxDollars: tier.maxAmountCents === null ? '' : centsToDollarsInput(tier.maxAmountCents),
        depositDollars: centsToDollarsInput(tier.depositAmountCents),
      })),
    )
    setDepositTiersError(null)
    setEditingDepositTiers(true)
  }

  function addDepositTier() {
    setDepositTiersDraft((prev) => [...prev, { minDollars: '', maxDollars: '', depositDollars: '' }])
  }

  function removeDepositTier(index: number) {
    setDepositTiersDraft((prev) => prev.filter((_, i) => i !== index))
  }

  function updateDepositTier(index: number, patch: Partial<DepositTierDraft>) {
    setDepositTiersDraft((prev) => prev.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)))
  }

  async function handleDepositTiersSave() {
    setDepositTiersSaving(true)
    setDepositTiersError(null)
    try {
      const payload = depositTiersDraft.map((tier) => ({
        minAmountCents: Math.round(Number(tier.minDollars) * 100),
        maxAmountCents: tier.maxDollars.trim() === '' ? null : Math.round(Number(tier.maxDollars) * 100),
        depositAmountCents: Math.round(Number(tier.depositDollars) * 100),
      }))
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ depositTiers: payload }),
      })
      setPolicies(updated)
      setEditingDepositTiers(false)
    } catch (err) {
      setDepositTiersError(err instanceof Error ? err.message : 'Failed to save deposit tiers')
    } finally {
      setDepositTiersSaving(false)
    }
  }

  function startEditingArtistVisibility() {
    setArtistVisibilityDraft({
      pricingDetail: policies?.artistFieldVisibility?.pricingDetail ?? true,
      internalNotes: policies?.artistFieldVisibility?.internalNotes ?? true,
    })
    setArtistVisibilityError(null)
    setEditingArtistVisibility(true)
  }

  async function handleArtistVisibilitySave() {
    setArtistVisibilitySaving(true)
    setArtistVisibilityError(null)
    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ artistFieldVisibility: artistVisibilityDraft }),
      })
      setPolicies(updated)
      setEditingArtistVisibility(false)
    } catch (err) {
      setArtistVisibilityError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setArtistVisibilitySaving(false)
    }
  }

  async function handleSelectTheme(key: string) {
    if (!policies || policies.themePreset === key) return
    setThemeSavingKey(key)
    setThemeError(null)
    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ themePreset: key }),
      })
      setPolicies(updated)
      applyThemePreset(updated.themePreset)
    } catch (err) {
      setThemeError(err instanceof Error ? err.message : 'Failed to save theme')
    } finally {
      setThemeSavingKey(null)
    }
  }

  function openDefaultsModal() {
    if (!policies) return
    setDefaultsForm({
      estimateFollowUpHours: String(policies.estimateFollowUpHours),
      giftCardDefaultExpirationDays: policies.giftCardDefaultExpirationDays?.toString() ?? '',
      referralRewardDollars: centsToDollarsInput(policies.referralRewardAmountCents),
      coldLeadDays: String(policies.coldLeadDays),
      timezone: policies.timezone,
      showSidebarBadges: policies.showSidebarBadges,
      schedulingBufferMinutes: String(policies.schedulingBufferMinutes),
      depositFeeDollars: centsToDollarsInput(policies.depositFeeCents),
      defaultDepositAmountMode: policies.defaultDepositAmountMode,
      referralAllowRepeatRedemption: policies.referralAllowRepeatRedemption,
      referralProgramEnabled: policies.referralProgramEnabled,
    })
    setDefaultsError(null)
    setShowDefaultsModal(true)
  }

  async function handleDefaultsSave() {
    setDefaultsSaving(true)
    setDefaultsError(null)
    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        // referralRewardAmountCents is its own permission group
        // (settings.manageReferral) on the API, separate from the rest of
        // this form (settings.manageDefaults) -- only sent when the actor
        // actually has that permission, so someone granted just
        // "Manage studio defaults" (without "Manage referral program")
        // isn't 403'd on a field they never got to edit in this modal.
        body: JSON.stringify({
          estimateFollowUpHours: Number(defaultsForm.estimateFollowUpHours) || 0,
          giftCardDefaultExpirationDays: defaultsForm.giftCardDefaultExpirationDays
            ? Number(defaultsForm.giftCardDefaultExpirationDays)
            : null,
          ...(canManageReferral
            ? {
                referralRewardAmountCents: dollarsToCents(Number(defaultsForm.referralRewardDollars) || 0),
                referralAllowRepeatRedemption: defaultsForm.referralAllowRepeatRedemption,
                referralProgramEnabled: defaultsForm.referralProgramEnabled,
              }
            : {}),
          coldLeadDays: Number(defaultsForm.coldLeadDays) || 90,
          timezone: defaultsForm.timezone,
          showSidebarBadges: defaultsForm.showSidebarBadges,
          schedulingBufferMinutes: Number(defaultsForm.schedulingBufferMinutes) || 0,
          depositFeeCents: dollarsToCents(Number(defaultsForm.depositFeeDollars) || 0),
          defaultDepositAmountMode: defaultsForm.defaultDepositAmountMode,
        }),
      })
      setPolicies(updated)
      setShowDefaultsModal(false)
      // The sidebar/badge behavior everywhere reads this off /nav-counts
      // (see useNavCounts) -- invalidate so it picks up the new value
      // immediately instead of waiting for the next poll.
      if (user) queryClient.invalidateQueries({ queryKey: navCountsQueryKey(user.userId) })
    } catch (err) {
      setDefaultsError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setDefaultsSaving(false)
    }
  }

  async function handleWaiverListSave() {
    setWaiverListSaving(true)
    setWaiverListError(null)

    // Zipped against the ORIGINAL (pre-filter) index so a dropped empty
    // English row drops its Spanish counterpart too -- cleanedQuestions/
    // cleanedClauses below can end up shorter than waiverHealthQuestions/
    // waiverClauses, and the Spanish arrays must stay aligned to whichever
    // rows actually survive.
    const keptQuestionIndices = waiverHealthQuestions
      .map((q, i) => (q.question.trim().length > 0 ? i : -1))
      .filter((i) => i !== -1)
    const cleanedQuestions = keptQuestionIndices.map((i) => {
      const q = waiverHealthQuestions[i]
      return {
        question: q.question.trim(),
        type: q.type,
        ...(q.type === 'yes_no_explain' ? { explainPrompt: q.explainPrompt?.trim() || undefined } : {}),
      }
    })
    const cleanedQuestionsEs = keptQuestionIndices.map((i) => ({
      question: waiverHealthQuestionsEs[i]?.trim() || null,
      type: waiverHealthQuestions[i].type,
      explainPrompt: waiverHealthExplainEs[i]?.trim() || undefined,
    }))

    const keptClauseIndices = waiverClauses.map((c, i) => (c.trim().length > 0 ? i : -1)).filter((i) => i !== -1)
    const cleanedClauses = keptClauseIndices.map((i) => waiverClauses[i].trim())
    const cleanedClausesEs = keptClauseIndices.map((i) => waiverClausesEs[i]?.trim() || null)

    if (cleanedClauses.length === 0) {
      setWaiverListError('At least one waiver clause is required.')
      setWaiverListSaving(false)
      return
    }

    const hasEsQuestions = cleanedQuestionsEs.some((q) => q.question)
    const hasEsClauses = cleanedClausesEs.some((c) => c)

    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          waiverHealthQuestions: cleanedQuestions,
          waiverClauses: cleanedClauses,
          // Fix pass: always send translations.es (null when nothing's
          // translated), never gated on hasEsQuestions/hasEsClauses -- an
          // emptied Spanish tab must actually clear the stale
          // StudioSettingsTranslation row, not silently leave it in place
          // (PATCH /studio-settings already treats an explicit null as
          // "clear it"; the bug was this payload omitting the key
          // entirely instead of sending that null).
          translations: {
            es: {
              waiverHealthQuestions: hasEsQuestions ? cleanedQuestionsEs : null,
              waiverClauses: hasEsClauses ? cleanedClausesEs : null,
            },
          },
        }),
      })
      setWaiverHealthQuestions(updated.waiverHealthQuestions ?? [])
      setWaiverClauses(updated.waiverClauses ?? [])
      setWaiverHealthQuestionsEs(cleanedQuestionsEs.map((q) => q.question ?? ''))
      setWaiverHealthExplainEs(cleanedQuestionsEs.map((q) => q.explainPrompt ?? ''))
      setWaiverClausesEs(cleanedClausesEs.map((c) => c ?? ''))
      // PATCH doesn't echo translations back -- merged in locally, same
      // convention as every other translatable field in this file.
      setPolicies({
        ...updated,
        translations: {
          ...policies?.translations,
          es: {
            ...policies?.translations?.es,
            waiverHealthQuestions: hasEsQuestions ? cleanedQuestionsEs : null,
            waiverClauses: hasEsClauses ? cleanedClausesEs : null,
          },
        },
      })
      setEditingWaiverList(false)
    } catch (err) {
      setWaiverListError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setWaiverListSaving(false)
    }
  }

  async function handleTemplatesSave() {
    setTemplatesSaving(true)
    setTemplatesError(null)

    const cleanedTemplates = messageTemplates
      .map((t) => ({ id: t.id, name: t.name.trim(), body: t.body.trim() }))
      .filter((t) => t.name.length > 0 && t.body.length > 0)

    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ messageTemplates: cleanedTemplates }),
      })
      setPolicies(updated)
      setMessageTemplates(updated.messageTemplates ?? [])
      setEditingTemplates(false)
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setTemplatesSaving(false)
    }
  }

  function openReminderTemplateModal(key: keyof ReminderTemplatesData) {
    setEditingReminderTemplate(key)
    setReminderTemplateDraft(policies?.reminderTemplates?.[key] ?? '')
    setReminderTemplateError(null)
  }

  // Inserts at the textarea's current cursor position (falling back to
  // appending at the end if the ref isn't mounted yet), then restores
  // focus and moves the cursor past what was just inserted -- so clicking
  // several chips in a row builds the message left-to-right as expected.
  function insertReminderPlaceholder(token: string) {
    const insertText = `{{${token}}}`
    const textarea = reminderTemplateTextareaRef.current
    if (!textarea) {
      setReminderTemplateDraft((current) => current + insertText)
      return
    }
    const start = textarea.selectionStart ?? reminderTemplateDraft.length
    const end = textarea.selectionEnd ?? reminderTemplateDraft.length
    const next = reminderTemplateDraft.slice(0, start) + insertText + reminderTemplateDraft.slice(end)
    setReminderTemplateDraft(next)
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + insertText.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  async function handleReminderTemplateSave() {
    if (!editingReminderTemplate || !policies) return
    setReminderTemplateSaving(true)
    setReminderTemplateError(null)
    try {
      const nextTemplates = { ...(policies.reminderTemplates as ReminderTemplatesData), [editingReminderTemplate]: reminderTemplateDraft }
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({ reminderTemplates: nextTemplates }),
      })
      setPolicies(updated)
      setEditingReminderTemplate(null)
    } catch (err) {
      setReminderTemplateError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setReminderTemplateSaving(false)
    }
  }

  function updateSendTime(field: keyof ReminderSendTimesData, value: string) {
    setReminderSendTimes((current) => ({ ...current, [field]: value }))
  }

  async function handleSendTimesSave() {
    setSendTimesSaving(true)
    setSendTimesError(null)
    try {
      const updated = await apiFetch<StudioSettingsData>('/studio-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          reminderSendTimes,
          reminderWeekBeforeDays: Number(reminderCadenceDays.weekBeforeDays) || 7,
          reminderNightBeforeDays: Number(reminderCadenceDays.nightBeforeDays) || 1,
        }),
      })
      setPolicies(updated)
      setReminderSendTimes(updated.reminderSendTimes ?? DEFAULT_REMINDER_SEND_TIMES)
      setReminderCadenceDays({
        weekBeforeDays: String(updated.reminderWeekBeforeDays),
        nightBeforeDays: String(updated.reminderNightBeforeDays),
      })
      setEditingSendTimes(false)
    } catch (err) {
      setSendTimesError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSendTimesSaving(false)
    }
  }

  function updateHealthQuestion(index: number, patch: Partial<HealthQuestion>) {
    setWaiverHealthQuestions((current) => current.map((q, i) => (i === index ? { ...q, ...patch } : q)))
  }

  function addHealthQuestion() {
    setWaiverHealthQuestions((current) => [...current, { ...EMPTY_HEALTH_QUESTION }])
    setWaiverHealthQuestionsEs((current) => [...current, ''])
    setWaiverHealthExplainEs((current) => [...current, ''])
  }

  function removeHealthQuestion(index: number) {
    setWaiverHealthQuestions((current) => current.filter((_, i) => i !== index))
    setWaiverHealthQuestionsEs((current) => current.filter((_, i) => i !== index))
    setWaiverHealthExplainEs((current) => current.filter((_, i) => i !== index))
  }

  function updateClause(index: number, value: string) {
    setWaiverClauses((current) => current.map((c, i) => (i === index ? value : c)))
  }

  function addClause() {
    setWaiverClauses((current) => [...current, ''])
    setWaiverClausesEs((current) => [...current, ''])
  }

  function removeClause(index: number) {
    setWaiverClauses((current) => current.filter((_, i) => i !== index))
    setWaiverClausesEs((current) => current.filter((_, i) => i !== index))
  }

  function updateTemplate(index: number, patch: Partial<MessageTemplate>) {
    setMessageTemplates((current) => current.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  function addTemplate() {
    setMessageTemplates((current) => [...current, { id: crypto.randomUUID(), name: '', body: '' }])
  }

  function removeTemplate(index: number) {
    setMessageTemplates((current) => current.filter((_, i) => i !== index))
  }

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_STUDIO_FORM)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [iconLogo, setIconLogo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [locations, setLocations] = useState<Location[] | null>(null)
  const [locationsError, setLocationsError] = useState<string | null>(null)
  const [editingLocationId, setEditingLocationId] = useState<string | 'new' | null>(null)
  const [locationForm, setLocationForm] = useState({ ...EMPTY_LOCATION_FORM, hours: defaultHours() })
  const [locationError, setLocationError] = useState<string | null>(null)
  const [locationSubmitting, setLocationSubmitting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // UI simplification pass: a solo studio has no Team page to invite from
  // (removed entirely -- see Sidebar/Team.tsx's own comments), but still
  // needs exactly one way to grow past one person. A minimal, deliberately
  // narrow entry point here, not a rebuild of Team's own invite UI --
  // hits the same POST /studios/:studioId/invites every other invite path
  // already uses. Once accepted, the studio stops being solo and Team
  // reappears on its own with full pending-invite management, resend,
  // cancel, etc. -- this form never needs any of that.
  const [growForm, setGrowForm] = useState({ name: '', email: '', role: 'ARTIST', membershipType: 'HOME' })
  const [growError, setGrowError] = useState<string | null>(null)
  const [growSuccess, setGrowSuccess] = useState(false)
  const [growSubmitting, setGrowSubmitting] = useState(false)

  async function handleGrowSubmit(event: FormEvent) {
    event.preventDefault()
    if (!studio) return

    setGrowError(null)
    setGrowSubmitting(true)

    try {
      await apiFetch(`/studios/${studio.id}/invites`, {
        method: 'POST',
        body: JSON.stringify(growForm),
      })
      setGrowForm({ name: '', email: '', role: 'ARTIST', membershipType: 'HOME' })
      setGrowSuccess(true)
    } catch (err) {
      setGrowError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setGrowSubmitting(false)
    }
  }

  useEffect(() => {
    if (studio) {
      setForm({ name: studio.name, website: studio.website ?? '' })
      setLogoUrl(studio.logoUrl)
      setIconLogo(studio.iconLogo)
    }
  }, [studio])

  useEffect(() => {
    if (!studio) return
    let ignore = false

    async function loadLocations() {
      setLocationsError(null)

      try {
        const data = await apiFetch<Location[]>(`/studios/${studio!.id}/locations`)
        if (!ignore) setLocations(data)
      } catch (err) {
        if (!ignore) setLocationsError(err instanceof Error ? err.message : 'Failed to load locations')
      }
    }

    loadLocations()

    return () => {
      ignore = true
    }
  }, [studio])

  async function refreshLocations() {
    if (!studio) return
    const data = await apiFetch<Location[]>(`/studios/${studio.id}/locations`)
    setLocations(data)
  }

  function updateField(field: keyof typeof EMPTY_STUDIO_FORM) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }
  }

  function handleEdit() {
    setError(null)
    setSuccess(false)
    setEditing(true)
  }

  function handleCancel() {
    if (studio) {
      setForm({ name: studio.name, website: studio.website ?? '' })
      setLogoUrl(studio.logoUrl)
      setIconLogo(studio.iconLogo)
    }
    setError(null)
    setEditing(false)
  }

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setSuccess(false)

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setError('Logo image must be under 5MB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setLogoUrl(dataUrl)
    } catch {
      setError('Could not read that image. Please try a different file.')
    }
  }

  // Artist public page v2: identical validation to handleLogoChange above,
  // just targeting the separate iconLogo field -- see Studio.iconLogo's
  // own schema comment for why this is a second upload, not a resize of
  // the existing logo.
  async function handleIconLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setSuccess(false)

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setError('Icon logo image must be under 5MB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setIconLogo(dataUrl)
    } catch {
      setError('Could not read that image. Please try a different file.')
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!studio) return

    setError(null)
    setSuccess(false)
    setSubmitting(true)

    try {
      await apiFetch(`/studios/${studio.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: form.name, website: form.website, logoUrl, iconLogo }),
      })
      await refresh()
      setSuccess(true)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update studio')
    } finally {
      setSubmitting(false)
    }
  }

  function handleAddLocation() {
    setLocationError(null)
    setLocationForm({ ...EMPTY_LOCATION_FORM, hours: defaultHours() })
    setEditingLocationId('new')
  }

  function handleEditLocation(location: Location) {
    setLocationError(null)
    setLocationForm({
      name: location.name,
      address: location.address ?? '',
      phone: location.phone ?? '',
      email: location.email ?? '',
      hours: location.hours ?? defaultHours(),
    })
    setEditingLocationId(location.id)
  }

  function handleCancelLocationEdit() {
    setLocationError(null)
    setEditingLocationId(null)
  }

  function updateLocationField(field: 'name' | 'address' | 'phone' | 'email') {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setLocationForm((current) => ({ ...current, [field]: event.target.value }))
    }
  }

  function updateLocationHoursDay(day: number, patch: Partial<LocationHoursDay>) {
    setLocationForm((current) => ({
      ...current,
      hours: current.hours.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)),
    }))
  }

  async function handleLocationSubmit(event: FormEvent) {
    event.preventDefault()
    if (!studio || !editingLocationId) return

    if (locationForm.name.trim().length === 0) {
      setLocationError('Location name is required.')
      return
    }

    const incompleteDay = locationForm.hours.find((day) => !day.closed && (!day.open || !day.close))
    if (incompleteDay) {
      setLocationError(`Set both open and close times for ${DAY_LABELS[incompleteDay.day]}, or mark it closed.`)
      return
    }

    if (!isValidPhoneDigits(locationForm.phone)) {
      setLocationError('Enter a complete 10-digit phone number.')
      return
    }

    setLocationError(null)
    setLocationSubmitting(true)

    const payload = {
      name: locationForm.name,
      address: locationForm.address,
      phone: locationForm.phone,
      email: locationForm.email,
      hours: locationForm.hours,
    }

    try {
      if (editingLocationId === 'new') {
        await apiFetch(`/studios/${studio.id}/locations`, { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await apiFetch(`/studios/${studio.id}/locations/${editingLocationId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      await refreshLocations()
      setEditingLocationId(null)
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Failed to save location')
    } finally {
      setLocationSubmitting(false)
    }
  }

  async function handleDeleteLocation(locationId: string) {
    if (!studio) return

    try {
      await apiFetch(`/studios/${studio.id}/locations/${locationId}`, { method: 'DELETE' })
      await refreshLocations()
    } catch (err) {
      setLocationsError(err instanceof Error ? err.message : 'Failed to delete location')
    } finally {
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
          {isEditorial && <Eyebrow>Manage your studio, its policies, and how it connects.</Eyebrow>}
          <h1
            className={
              isEditorial
                ? 'mt-1 font-display text-[clamp(28px,3.4vw,38px)] font-normal tracking-[-0.015em] text-fg'
                : 'text-2xl font-bold text-fg sm:text-3xl'
            }
          >
            Settings
          </h1>
          {!isEditorial && (
            <p className="mt-1 text-sm text-fg-secondary">Manage your studio, its policies, and how it connects.</p>
          )}

          {/* Tabs already read correctly under every preset via plain
              CSS-variable-driven tokens (border-accent/text-fg/
              text-fg-secondary) -- same underline shape already reused
              verbatim elsewhere (Conversations' Clients/Team toggle,
              Team.tsx's own Staff/Artists/Permissions tabs), no
              isEditorial branch needed. */}
          <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border">
            {SETTINGS_TABS.filter((tab) => tab.visible).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={[
                  'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition',
                  activeTab === tab.key
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-secondary hover:text-fg',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'general' && (
          <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
            {/* UI simplification pass: this still edits real Studio-model
                fields (name/logo/website) a solo artist genuinely needs to
                set -- not removed, just relabeled so it reads as their own
                profile rather than a separate "studio" entity they and the
                business both happen to be. */}
            <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>
              {profile?.isSoloStudio ? 'Profile' : 'Studio Profile'}
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              {profile?.isSoloStudio
                ? 'Manage your name, logo, and branding.'
                : canManageStudio
                  ? 'Manage your studio profile and branding.'
                  : 'Your studio profile.'}
            </p>
            <div className="mt-4">
            {loading && !studio && <p className="text-sm text-fg-secondary">Loading studio…</p>}

            {!loading && !studio && <p className="text-sm text-danger">Could not load studio information.</p>}

            {success && (
              <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                Studio profile updated.
              </div>
            )}

            {studio && !editing && (
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  {studio.logoUrl ? (
                    <img src={studio.logoUrl} alt={studio.name} className="h-14 w-auto rounded-lg" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border text-xs text-fg-muted">
                      No logo
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-fg">{studio.name}</p>
                    {studio.website && <p className="mt-1 text-xs text-fg-secondary">{studio.website}</p>}
                    {!canManageStudio && (
                      <p className="mt-2 text-xs text-fg-muted">You don't have permission to edit this.</p>
                    )}
                  </div>
                </div>

                {canManageStudio && (
                  <button
                    type="button"
                    onClick={handleEdit}
                    className={
                      isEditorial
                        ? 'editorial-btn-secondary shrink-0 rounded-full border px-4 py-2 transition'
                        : 'shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                    }
                  >
                    Edit
                  </button>
                )}
              </div>
            )}

            {studio && canManageStudio && editing && (
              <form onSubmit={handleSubmit}>
                {error && (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </div>
                )}

                <div className="mb-5">
                  <label htmlFor="studioName" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Studio name
                  </label>
                  <input
                    id="studioName"
                    type="text"
                    required
                    value={form.name}
                    onChange={updateField('name')}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-5">
                  <label htmlFor="studioWebsite" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Website
                  </label>
                  <input
                    id="studioWebsite"
                    type="text"
                    placeholder="https://yourstudio.com"
                    value={form.website}
                    onChange={updateField('website')}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-5">
                  <span className="mb-1 block text-sm font-medium text-fg-secondary">Logo</span>
                  <p className="mb-3 text-xs text-fg-muted">
                    Shown at the top of your studio's portal in place of the Ink Manager logo.
                  </p>

                  <div className="flex items-center gap-4">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Studio logo preview" className="h-14 w-auto rounded-lg" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border text-xs text-fg-muted">
                        No logo
                      </div>
                    )}

                    <label
                      className={
                        isEditorial
                          ? 'editorial-btn-secondary cursor-pointer rounded-full border px-4 py-2 transition'
                          : 'cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                      }
                    >
                      {logoUrl ? 'Change logo' : 'Upload logo'}
                      <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                    </label>

                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl(null)}
                        className="text-sm font-medium text-fg-secondary transition hover:text-fg"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="mb-5">
                  <span className="mb-1 block text-sm font-medium text-fg-secondary">Icon logo</span>
                  <p className="mb-3 text-xs text-fg-muted">
                    A small circular mark, separate from your logo above -- shown on your artists' own public
                    pages next to your studio's name. Falls back to your studio's first initial if not set.
                  </p>

                  <div className="flex items-center gap-4">
                    {iconLogo ? (
                      <img src={iconLogo} alt="Icon logo preview" className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-xs text-fg-muted">
                        None
                      </div>
                    )}

                    <label
                      className={
                        isEditorial
                          ? 'editorial-btn-secondary cursor-pointer rounded-full border px-4 py-2 transition'
                          : 'cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                      }
                    >
                      {iconLogo ? 'Change icon' : 'Upload icon'}
                      <input type="file" accept="image/*" onChange={handleIconLogoChange} className="hidden" />
                    </label>

                    {iconLogo && (
                      <button
                        type="button"
                        onClick={() => setIconLogo(null)}
                        className="text-sm font-medium text-fg-secondary transition hover:text-fg"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className={
                      isEditorial
                        ? 'editorial-btn-primary flex-1 rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                        : 'flex-1 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60'
                    }
                  >
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={submitting}
                    className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            </div>
          </div>
          )}

          {/* Relaunch link -- /setup is always directly reachable
              regardless of Studio.setupCompletedAt (ProtectedRoute's own
              redirect only ever sends someone TO /setup when eligible, it
              never blocks a direct visit), so this is just a plain link,
              no reset-the-flag step needed. OWNER-only, same as the wizard
              itself. */}
          {activeTab === 'general' && isOwner && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Setup guide</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Revisit the studio setup wizard -- deposit tiers, defaults, payments, and (for a multi-person
                    studio) team invites.
                  </p>
                </div>
                <Link
                  to="/setup"
                  className={
                    isEditorial
                      ? 'editorial-btn-secondary shrink-0 rounded-full border px-4 py-2 transition'
                      : 'shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                  }
                >
                  Relaunch
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'general' && canManageTheme && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Theme</h2>
              <p className="mt-1 text-sm text-fg-secondary">
                Applies everywhere — the app, public forms and links, everything your clients see.
              </p>

              {themeError && <p className="mt-3 text-sm text-danger">{themeError}</p>}

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {THEME_PRESETS.map((preset) => {
                  const isSelected = policies.themePreset === preset.key
                  const isSaving = themeSavingKey === preset.key
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => handleSelectTheme(preset.key)}
                      disabled={themeSavingKey !== null}
                      className={[
                        'rounded-xl border p-3 text-left transition disabled:opacity-60',
                        isSelected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-strong',
                      ].join(' ')}
                    >
                      <div
                        className="flex h-14 items-center justify-center gap-1.5 rounded-lg"
                        style={{ backgroundColor: preset.swatchBg }}
                      >
                        <span
                          className="h-6 w-6 rounded-full"
                          style={{ backgroundColor: preset.swatchSurface, border: `1px solid ${preset.swatchAccent}33` }}
                        />
                        <span className="h-6 w-6 rounded-full" style={{ backgroundColor: preset.swatchAccent }} />
                      </div>
                      <p className="mt-2 text-sm font-medium text-fg">
                        {preset.name}
                        {isSelected && <span className="ml-1.5 text-xs font-normal text-accent">(current)</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">{isSaving ? 'Saving…' : preset.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {activeTab === 'general' && studio && profile?.isSoloStudio && isOwner && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Grow your team</h2>
              <p className="mt-1 text-sm text-fg-secondary">
                Invite someone to join you. Once they accept, your Team page appears automatically with full staff
                and permissions management.
              </p>

              {growSuccess && !growError && (
                <div className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                  Invite sent.
                </div>
              )}

              <form onSubmit={handleGrowSubmit} className="mt-4">
                {growError && (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {growError}
                  </div>
                )}

                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="growName" className="mb-1 block text-sm font-medium text-fg-secondary">
                      Name
                    </label>
                    <input
                      id="growName"
                      type="text"
                      value={growForm.name}
                      onChange={(event) => setGrowForm({ ...growForm, name: event.target.value })}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label htmlFor="growEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
                      Email
                    </label>
                    <input
                      id="growEmail"
                      type="email"
                      required
                      value={growForm.email}
                      onChange={(event) => setGrowForm({ ...growForm, email: event.target.value })}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>

                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="growRole" className="mb-1 block text-sm font-medium text-fg-secondary">
                      Role
                    </label>
                    <select
                      id="growRole"
                      value={growForm.role}
                      onChange={(event) => setGrowForm({ ...growForm, role: event.target.value })}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="ARTIST">Artist</option>
                      <option value="FRONT_DESK">Front Desk</option>
                      <option value="OWNER">Owner</option>
                    </select>
                  </div>
                  {growForm.role === 'ARTIST' && (
                    <div>
                      <label htmlFor="growMembershipType" className="mb-1 block text-sm font-medium text-fg-secondary">
                        Membership
                      </label>
                      <select
                        id="growMembershipType"
                        value={growForm.membershipType}
                        onChange={(event) => setGrowForm({ ...growForm, membershipType: event.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="HOME">Home</option>
                        <option value="GUEST">Guest</option>
                      </select>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={growSubmitting}
                  className={
                    isEditorial
                      ? 'editorial-btn-primary flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      : 'flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                  }
                >
                  {growSubmitting ? 'Sending…' : 'Send invite'}
                </button>
              </form>
            </div>
          )}

          {/* UI simplification pass: multi-location management is
              meaningless for a literal team of one -- hidden entirely,
              not shown empty. */}
          {activeTab === 'general' && studio && !profile?.isSoloStudio && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Locations</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    {canManageLocations ? 'Every shop location, its hours, and how to reach it.' : 'Where to find us.'}
                  </p>
                </div>

                {canManageLocations && editingLocationId === null && (
                  <button
                    type="button"
                    onClick={handleAddLocation}
                    className={
                      isEditorial
                        ? 'editorial-btn-secondary shrink-0 rounded-full border px-4 py-2 transition'
                        : 'shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface'
                    }
                  >
                    Add location
                  </button>
                )}
              </div>

              {locationsError && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {locationsError}
                </div>
              )}

              {locations === null && !locationsError && (
                <p className="mt-4 text-sm text-fg-secondary">Loading locations…</p>
              )}

              {locations !== null && locations.length === 0 && editingLocationId !== 'new' && (
                <p className="mt-4 text-sm text-fg-secondary">
                  {canManageLocations ? 'No locations yet. Add your first one.' : 'No locations yet.'}
                </p>
              )}

              <div className="mt-4 space-y-4">
                {locations?.map((location) =>
                  editingLocationId === location.id ? (
                    <LocationForm
                      key={location.id}
                      form={locationForm}
                      error={locationError}
                      submitting={locationSubmitting}
                      onFieldChange={updateLocationField}
                      onPhoneChange={(digits) => setLocationForm((current) => ({ ...current, phone: digits }))}
                      onHoursChange={updateLocationHoursDay}
                      onSubmit={handleLocationSubmit}
                      onCancel={handleCancelLocationEdit}
                    />
                  ) : (
                    <LocationCard
                      key={location.id}
                      location={location}
                      canManage={canManageLocations}
                      confirmingDelete={confirmDeleteId === location.id}
                      onEdit={() => handleEditLocation(location)}
                      onDeleteClick={() => setConfirmDeleteId(location.id)}
                      onDeleteCancel={() => setConfirmDeleteId(null)}
                      onDeleteConfirm={() => handleDeleteLocation(location.id)}
                    />
                  ),
                )}

                {editingLocationId === 'new' && (
                  <LocationForm
                    form={locationForm}
                    error={locationError}
                    submitting={locationSubmitting}
                    onFieldChange={updateLocationField}
                    onPhoneChange={(digits) => setLocationForm((current) => ({ ...current, phone: digits }))}
                    onHoursChange={updateLocationHoursDay}
                    onSubmit={handleLocationSubmit}
                    onCancel={handleCancelLocationEdit}
                  />
                )}
              </div>
            </div>
          )}

          {activeTab === 'policies' && canViewPolicies && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div>
                <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Policies</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  Wording used across estimates, deposits, gift cards, and waivers.
                </p>
              </div>

              <div className="mt-4 divide-y divide-border">
                {POLICY_HTML_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{label}</p>
                      <p className="mt-0.5 truncate text-xs text-fg-secondary">
                        {stripHtmlPreview(policies[key] as string | null)}
                      </p>
                    </div>
                    {canManagePolicies && (
                      <button
                        type="button"
                        onClick={() => openFieldModal(key)}
                        aria-label={`Edit ${label}`}
                        title={`Edit ${label}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'defaults' && canViewPolicies && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Defaults</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Studio-wide defaults for estimates, gift cards, referrals, lead handling, and scheduling.
                  </p>
                </div>
                {(canManageDefaults || canManageReferral) && (
                  <button
                    type="button"
                    onClick={openDefaultsModal}
                    aria-label="Edit defaults"
                    title="Edit defaults"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Estimate follow-up</p>
                  <p className="mt-1 text-sm text-fg-secondary">{policies.estimateFollowUpHours} hours</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Gift card expiration</p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    {policies.giftCardDefaultExpirationDays
                      ? `${policies.giftCardDefaultExpirationDays} days`
                      : 'Never expires'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Referral program</p>
                  <p className="mt-1 text-sm text-fg-secondary">{policies.referralProgramEnabled ? 'On' : 'Off'}</p>
                </div>
                {policies.referralProgramEnabled && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Referral reward</p>
                    <p className="mt-1 text-sm text-fg-secondary">
                      ${(policies.referralRewardAmountCents / 100).toFixed(2)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Cold lead after</p>
                  <p className="mt-1 text-sm text-fg-secondary">{policies.coldLeadDays} days of no activity</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Timezone</p>
                  <p className="mt-1 text-sm text-fg-secondary">{timezoneLabel(policies.timezone)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Sidebar badges</p>
                  <p className="mt-1 text-sm text-fg-secondary">{policies.showSidebarBadges ? 'On' : 'Off'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Scheduling buffer</p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    {policies.schedulingBufferMinutes} minutes between appointments
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Deposit processing fee</p>
                  <p className="mt-1 text-sm text-fg-secondary">${(policies.depositFeeCents / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Default deposit form amount</p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    {policies.defaultDepositAmountMode === 'FULL_PREPAY' ? 'Full prepayment' : 'Deposit (tier-based)'}
                  </p>
                </div>
                {policies.referralProgramEnabled && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Referral code reuse</p>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {policies.referralAllowRepeatRedemption ? 'Same client can earn repeat rewards' : 'One reward per referred client'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'policies' && canViewPolicies && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Waiver Questions &amp; Clauses</h2>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {waiverHealthQuestions.length} health question{waiverHealthQuestions.length === 1 ? '' : 's'},{' '}
                      {waiverClauses.length} clause{waiverClauses.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {canManagePolicies && !editingWaiverList && (
                    <button
                      type="button"
                      onClick={() => setEditingWaiverList(true)}
                      className={
                        isEditorial
                          ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                          : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
                      }
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingWaiverList && (
                  <div className="mt-4 space-y-4">
                    <div className="flex gap-1 border-b border-border">
                      {(Object.keys(LOCALE_LABELS) as Locale[]).map((locale) => (
                        <button
                          key={locale}
                          type="button"
                          onClick={() => setWaiverListLocale(locale)}
                          className={[
                            'shrink-0 border-b-2 px-3 py-1.5 text-xs font-medium transition',
                            waiverListLocale === locale ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
                          ].join(' ')}
                        >
                          {LOCALE_LABELS[locale]}
                        </button>
                      ))}
                    </div>

                    {waiverListLocale === 'es' && (
                      <p className="text-xs text-fg-muted">
                        Add/remove/reorder questions and clauses on the English tab -- the Spanish rows below always
                        mirror that list, one translation per row. Falls back to English until filled in.
                      </p>
                    )}

                    {waiverListLocale === 'en' ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-fg-secondary">Health screening questions</label>
                        <button
                          type="button"
                          onClick={addHealthQuestion}
                          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                        >
                          Add question
                        </button>
                      </div>

                      <div className="mt-3 space-y-3">
                        {waiverHealthQuestions.map((q, i) => (
                          <div key={i} className="rounded-lg border border-border p-3">
                            <div className="flex items-start gap-2">
                              <textarea
                                rows={2}
                                value={q.question}
                                onChange={(e) => updateHealthQuestion(i, { question: e.target.value })}
                                placeholder="Question text"
                                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                              <button
                                type="button"
                                onClick={() => removeHealthQuestion(i)}
                                className="shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface hover:text-fg"
                              >
                                Remove
                              </button>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <select
                                value={q.type}
                                onChange={(e) =>
                                  updateHealthQuestion(i, { type: e.target.value as HealthQuestion['type'] })
                                }
                                className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                              >
                                <option value="yes_no">Yes/No</option>
                                <option value="yes_no_explain">Yes/No + explain if yes</option>
                              </select>
                              {q.type === 'yes_no_explain' && (
                                <input
                                  type="text"
                                  placeholder="Explain prompt (e.g. 'If yes, please explain')"
                                  value={q.explainPrompt ?? ''}
                                  onChange={(e) => updateHealthQuestion(i, { explainPrompt: e.target.value })}
                                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                              )}
                            </div>
                          </div>
                        ))}
                        {waiverHealthQuestions.length === 0 && (
                          <p className="text-sm text-fg-secondary">No health questions yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-border pt-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-fg-secondary">
                          Clauses (initialed individually)
                        </label>
                        <button
                          type="button"
                          onClick={addClause}
                          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                        >
                          Add clause
                        </button>
                      </div>

                      <div className="mt-3 space-y-3">
                        {waiverClauses.map((clause, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="mt-2 text-xs text-fg-muted">{i + 1}.</span>
                            <textarea
                              rows={2}
                              value={clause}
                              onChange={(e) => updateClause(i, e.target.value)}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <button
                              type="button"
                              onClick={() => removeClause(i)}
                              className="mt-1 shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface hover:text-fg"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        {waiverClauses.length === 0 && <p className="text-sm text-fg-secondary">No clauses yet.</p>}
                      </div>
                    </div>
                  </>
                    ) : (
                  <>
                    <div>
                      <label className="text-sm font-medium text-fg-secondary">Health screening questions (Español)</label>
                      <div className="mt-3 space-y-3">
                        {waiverHealthQuestions.map((q, i) => (
                          <div key={i} className="rounded-lg border border-border p-3">
                            <p className="mb-1 text-xs text-fg-muted">{q.question || `Question ${i + 1}`}</p>
                            <textarea
                              rows={2}
                              value={waiverHealthQuestionsEs[i] ?? ''}
                              onChange={(e) =>
                                setWaiverHealthQuestionsEs((current) => current.map((v, idx) => (idx === i ? e.target.value : v)))
                              }
                              placeholder={q.question}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            {q.type === 'yes_no_explain' && (
                              <input
                                type="text"
                                placeholder={q.explainPrompt || 'Explain prompt (Español)'}
                                value={waiverHealthExplainEs[i] ?? ''}
                                onChange={(e) =>
                                  setWaiverHealthExplainEs((current) => current.map((v, idx) => (idx === i ? e.target.value : v)))
                                }
                                className="mt-2 w-full rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            )}
                          </div>
                        ))}
                        {waiverHealthQuestions.length === 0 && (
                          <p className="text-sm text-fg-secondary">No health questions yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-border pt-4">
                      <label className="text-sm font-medium text-fg-secondary">Clauses (Español)</label>
                      <div className="mt-3 space-y-3">
                        {waiverClauses.map((clause, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="mt-2 text-xs text-fg-muted">{i + 1}.</span>
                            <div className="w-full">
                              <p className="mb-1 text-xs text-fg-muted">{clause || `Clause ${i + 1}`}</p>
                              <textarea
                                rows={2}
                                value={waiverClausesEs[i] ?? ''}
                                onChange={(e) =>
                                  setWaiverClausesEs((current) => current.map((v, idx) => (idx === i ? e.target.value : v)))
                                }
                                placeholder={clause}
                                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            </div>
                          </div>
                        ))}
                        {waiverClauses.length === 0 && <p className="text-sm text-fg-secondary">No clauses yet.</p>}
                      </div>
                    </div>
                  </>
                    )}

                    {waiverListError && <p className="text-sm text-danger">{waiverListError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleWaiverListSave}
                        disabled={waiverListSaving}
                        className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                      >
                        {waiverListSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWaiverList(false)
                          const englishQuestions = policies.waiverHealthQuestions ?? []
                          const englishClauses = policies.waiverClauses ?? []
                          setWaiverHealthQuestions(englishQuestions)
                          setWaiverClauses(englishClauses)
                          const zipped = zipEsHealthQuestions(englishQuestions, policies.translations?.es?.waiverHealthQuestions)
                          setWaiverHealthQuestionsEs(zipped.map((q) => q.question))
                          setWaiverHealthExplainEs(zipped.map((q) => q.explainPrompt))
                          setWaiverClausesEs(zipEsClauses(englishClauses, policies.translations?.es?.waiverClauses))
                          setWaiverListError(null)
                        }}
                        disabled={waiverListSaving}
                        className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
          )}

          {activeTab === 'policies' && canViewPolicies && policies && (
            <IntakeFormsManager canEdit={isOwner} />
          )}

          {activeTab === 'services' && canViewServices && <ServicesManager canEdit={canViewServices} />}

          {activeTab === 'policies' && canViewPolicies && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Message Templates</h2>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {messageTemplates.length} template{messageTemplates.length === 1 ? '' : 's'} &middot; available
                      in the conversation composer
                    </p>
                  </div>
                  {canManageTemplates && !editingTemplates && (
                    <button
                      type="button"
                      onClick={() => setEditingTemplates(true)}
                      className={
                        isEditorial
                          ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                          : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
                      }
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingTemplates && (
                  <div className="mt-4 space-y-4">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={addTemplate}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        Add template
                      </button>
                    </div>

                    <div className="space-y-3">
                      {messageTemplates.map((template, i) => (
                        <div key={template.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-start gap-2">
                            <input
                              type="text"
                              placeholder="Template name (e.g. 'Booking confirmation')"
                              value={template.name}
                              onChange={(e) => updateTemplate(i, { name: e.target.value })}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <button
                              type="button"
                              onClick={() => removeTemplate(i)}
                              className="shrink-0 rounded-full border border-border px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface hover:text-fg"
                            >
                              Remove
                            </button>
                          </div>
                          <textarea
                            rows={3}
                            placeholder="Template body"
                            value={template.body}
                            onChange={(e) => updateTemplate(i, { body: e.target.value })}
                            className="mt-2 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      ))}
                      {messageTemplates.length === 0 && (
                        <p className="text-sm text-fg-secondary">No templates yet.</p>
                      )}
                    </div>

                    {templatesError && <p className="text-sm text-danger">{templatesError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleTemplatesSave}
                        disabled={templatesSaving}
                        className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                      >
                        {templatesSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTemplates(false)
                          setMessageTemplates(policies.messageTemplates ?? [])
                          setTemplatesError(null)
                        }}
                        disabled={templatesSaving}
                        className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
          )}

          {activeTab === 'defaults' && canViewPolicies && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div>
                <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Reminder Templates &amp; Send Times</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  Wording and local send times for the automatic client/artist appointment reminders and the estimate
                  follow-up text.
                </p>
              </div>

              <div className="mt-4 divide-y divide-border">
                {REMINDER_TEMPLATE_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{label}</p>
                      <p className="mt-0.5 truncate text-xs text-fg-secondary">
                        {policies.reminderTemplates?.[key] || 'Not set'}
                      </p>
                    </div>
                    {canManageDefaults && (
                      <button
                        type="button"
                        onClick={() => openReminderTemplateModal(key)}
                        aria-label={`Edit ${label}`}
                        title={`Edit ${label}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-fg">Send Times</p>
                  {canManageDefaults && !editingSendTimes && (
                    <button
                      type="button"
                      onClick={() => setEditingSendTimes(true)}
                      className={
                        isEditorial
                          ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                          : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
                      }
                    >
                      Edit
                    </button>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  {(
                    [
                      { field: 'weekBeforeTime', label: '1 week before' },
                      { field: 'nightBeforeTime', label: 'Night before' },
                      { field: 'morningOfTime', label: 'Morning of' },
                      { field: 'artistDayBeforeTime', label: 'Artist day-before' },
                    ] as { field: keyof ReminderSendTimesData; label: string }[]
                  ).map(({ field, label }) => (
                    <div key={field}>
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</p>
                      {editingSendTimes ? (
                        <input
                          type="time"
                          value={reminderSendTimes[field]}
                          onChange={(e) => updateSendTime(field, e.target.value)}
                          className="mt-1 rounded-lg border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      ) : (
                        <p className="mt-1 text-sm text-fg-secondary">{reminderSendTimes[field]}</p>
                      )}
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-xs text-fg-muted">
                  Times are in the studio's own timezone ({timezoneLabel(policies.timezone)}), checked every 15
                  minutes.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:w-1/2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      "1 week before" is actually
                    </p>
                    {editingSendTimes ? (
                      <input
                        type="number"
                        min="1"
                        value={reminderCadenceDays.weekBeforeDays}
                        onChange={(e) =>
                          setReminderCadenceDays((current) => ({ ...current, weekBeforeDays: e.target.value }))
                        }
                        className="mt-1 w-20 rounded-lg border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-fg-secondary">{policies.reminderWeekBeforeDays} days before</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                      "Night before" is actually
                    </p>
                    {editingSendTimes ? (
                      <input
                        type="number"
                        min="1"
                        value={reminderCadenceDays.nightBeforeDays}
                        onChange={(e) =>
                          setReminderCadenceDays((current) => ({ ...current, nightBeforeDays: e.target.value }))
                        }
                        className="mt-1 w-20 rounded-lg border border-border bg-surface-inset px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-fg-secondary">{policies.reminderNightBeforeDays} days before</p>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-fg-muted">
                  "Morning of" always fires the same day -- not editable, since changing it would stop meaning
                  "morning of."
                </p>

                {sendTimesError && <p className="mt-3 text-sm text-danger">{sendTimesError}</p>}

                {editingSendTimes && (
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSendTimesSave}
                      disabled={sendTimesSaving}
                      className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                    >
                      {sendTimesSaving ? 'Saving…' : 'Save times'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSendTimes(false)
                        setSendTimesError(null)
                        setReminderSendTimes(policies.reminderSendTimes ?? DEFAULT_REMINDER_SEND_TIMES)
                        setReminderCadenceDays({
                          weekBeforeDays: String(policies.reminderWeekBeforeDays),
                          nightBeforeDays: String(policies.reminderNightBeforeDays),
                        })
                      }}
                      disabled={sendTimesSaving}
                      className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'policies' && canViewPolicies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Custom Policies</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Add your own policy sections beyond the fixed set above. Public ones appear on your studio's
                    /policies page.
                  </p>
                </div>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => openCustomPolicyModal('new')}
                    className={
                        isEditorial
                          ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                          : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
                      }
                  >
                    + Add Policy
                  </button>
                )}
              </div>

              {customPolicyError && <p className="mt-3 text-sm text-danger">{customPolicyError}</p>}

              {customPolicies && customPolicies.length === 0 && (
                <p className="mt-4 text-sm text-fg-secondary">No custom policies yet.</p>
              )}

              {customPolicies && customPolicies.length > 0 && (
                <div className="mt-4 divide-y divide-border">
                  {customPolicies.map((policy, index) => (
                    <div key={policy.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-fg">{policy.title}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              policy.isPublic ? 'bg-success/10 text-success' : 'bg-surface-inset text-fg-muted'
                            }`}
                          >
                            {policy.isPublic ? 'Public' : 'Private'}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-fg-secondary">
                          {stripHtmlPreview(policy.bodyHtml)}
                        </p>
                      </div>
                      {isOwner && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveCustomPolicy(index, -1)}
                            disabled={index === 0}
                            aria-label="Move up"
                            title="Move up"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg disabled:opacity-30"
                          >
                            <ChevronDownIcon className="h-4 w-4 rotate-180" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveCustomPolicy(index, 1)}
                            disabled={index === customPolicies.length - 1}
                            aria-label="Move down"
                            title="Move down"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg disabled:opacity-30"
                          >
                            <ChevronDownIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openCustomPolicyModal(policy)}
                            aria-label={`Edit ${policy.title}`}
                            title={`Edit ${policy.title}`}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          {deletingCustomPolicyId === policy.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomPolicy(policy.id)}
                                className="rounded-full border border-danger/40 px-2 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingCustomPolicyId(null)}
                                className="rounded-full border border-border px-2 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeletingCustomPolicyId(policy.id)}
                              className="rounded-full border border-border px-2 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface hover:text-danger"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'defaults' && canViewPolicies && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Deposit Tiers</h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    The deposit amount charged depends on which tier the average price estimate falls into.
                  </p>
                </div>
                {canManageDepositTiers && !editingDepositTiers && (
                  <button
                    type="button"
                    onClick={startEditingDepositTiers}
                    className={
                        isEditorial
                          ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                          : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
                      }
                  >
                    Edit
                  </button>
                )}
              </div>

              {!editingDepositTiers && (
                <div className="mt-4 divide-y divide-border">
                  {policies.depositTiers.map((tier, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="text-fg">
                        ${(tier.minAmountCents / 100).toFixed(2)} –{' '}
                        {tier.maxAmountCents === null ? 'and above' : `$${(tier.maxAmountCents / 100).toFixed(2)}`}
                      </span>
                      <span className="font-medium text-fg">${(tier.depositAmountCents / 100).toFixed(2)} deposit</span>
                    </div>
                  ))}
                </div>
              )}

              {editingDepositTiers && (
                <div className="mt-4 space-y-3">
                  {depositTiersDraft.map((tier, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Min ($)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tier.minDollars}
                          onChange={(e) => updateDepositTier(i, { minDollars: e.target.value })}
                          className="w-28 rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">
                          Max ($, blank = and above)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tier.maxDollars}
                          onChange={(e) => updateDepositTier(i, { maxDollars: e.target.value })}
                          placeholder="and above"
                          className="w-36 rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Deposit ($)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tier.depositDollars}
                          onChange={(e) => updateDepositTier(i, { depositDollars: e.target.value })}
                          className="w-28 rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDepositTier(i)}
                        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addDepositTier}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                  >
                    + Add tier
                  </button>

                  {depositTiersError && <p className="text-sm text-danger">{depositTiersError}</p>}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleDepositTiersSave}
                      disabled={depositTiersSaving}
                      className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                    >
                      {depositTiersSaving ? 'Saving…' : 'Save tiers'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDepositTiers(false)
                        setDepositTiersError(null)
                      }}
                      disabled={depositTiersSaving}
                      className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phase 5: which Inquiry/Project detail fields an ARTIST-effective
              caller can see -- hidden entirely for a solo studio (see
              canManageArtistVisibility's own comment), never shown
              disabled/no-op, matching this codebase's established solo-UI
              convention. */}
          {activeTab === 'defaults' && canManageArtistVisibility && policies && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>
                    Artist Field Visibility
                  </h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Choose which project detail groups your artists can see on their own assigned
                    inquiries/projects. A guest artist's visibility here is set by whichever studio
                    they're viewing the project at -- their home studio's choice never follows them
                    to a studio they're only guesting at.
                  </p>
                </div>
                {!editingArtistVisibility && (
                  <button
                    type="button"
                    onClick={startEditingArtistVisibility}
                    className={
                      isEditorial
                        ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition'
                        : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface'
                    }
                  >
                    Edit
                  </button>
                )}
              </div>

              {!editingArtistVisibility && (
                <div className="mt-4 divide-y divide-border">
                  <div className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="text-fg">Pricing &amp; financial detail</span>
                    <span className="font-medium text-fg">
                      {(policies.artistFieldVisibility?.pricingDetail ?? true) ? 'Visible' : 'Hidden'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="text-fg">Internal notes</span>
                    <span className="font-medium text-fg">
                      {(policies.artistFieldVisibility?.internalNotes ?? true) ? 'Visible' : 'Hidden'}
                    </span>
                  </div>
                </div>
              )}

              {editingArtistVisibility && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="flex items-start gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={artistVisibilityDraft.pricingDetail}
                        onChange={(e) =>
                          setArtistVisibilityDraft((prev) => ({ ...prev, pricingDetail: e.target.checked }))
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-inset accent-accent"
                      />
                      <span>
                        Pricing &amp; financial detail
                        <span className="block text-xs text-fg-muted">
                          Price/time estimate range, client-stated budget, planned-session estimates,
                          and deposit signed/paid status. Off: an artist entering their own estimate
                          (if your studio lets them) won't see the range they're quoting against --
                          only turn this off if you're comfortable with that trade-off.
                        </span>
                      </span>
                    </label>
                  </div>
                  <div>
                    <label className="flex items-start gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={artistVisibilityDraft.internalNotes}
                        onChange={(e) =>
                          setArtistVisibilityDraft((prev) => ({ ...prev, internalNotes: e.target.checked }))
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-inset accent-accent"
                      />
                      <span>
                        Internal notes
                        <span className="block text-xs text-fg-muted">
                          On top of each note's own "share with artist" toggle -- a note must be
                          BOTH marked shareable AND this switched on to ever reach an artist.
                        </span>
                      </span>
                    </label>
                  </div>

                  {artistVisibilityError && <p className="text-sm text-danger">{artistVisibilityError}</p>}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleArtistVisibilitySave}
                      disabled={artistVisibilitySaving}
                      className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                    >
                      {artistVisibilitySaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingArtistVisibility(false)
                        setArtistVisibilityError(null)
                      }}
                      disabled={artistVisibilitySaving}
                      className={
                        isEditorial
                          ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                          : 'rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60'
                      }
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {editingField && (
            <Modal
              title={`Edit ${POLICY_HTML_FIELDS.find((f) => f.key === editingField)?.label ?? ''}`}
              onClose={() => setEditingField(null)}
              size="large"
            >
              {STUDIO_SETTINGS_TRANSLATABLE_FIELDS.has(editingField) && (
                <div className="mb-3 flex shrink-0 gap-1 border-b border-border">
                  {(Object.keys(LOCALE_LABELS) as Locale[]).map((locale) => (
                    <button
                      key={locale}
                      type="button"
                      onClick={() => setFieldLocale(locale)}
                      className={[
                        'shrink-0 border-b-2 px-3 py-1.5 text-xs font-medium transition',
                        fieldLocale === locale ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
                      ].join(' ')}
                    >
                      {LOCALE_LABELS[locale]}
                    </button>
                  ))}
                </div>
              )}
              {fieldLocale === 'en' || !STUDIO_SETTINGS_TRANSLATABLE_FIELDS.has(editingField) ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <RichTextEditor value={fieldDraft} onChange={setFieldDraft} fill />
                </div>
              ) : (
                <>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <RichTextEditor value={fieldDraftEs} onChange={setFieldDraftEs} fill />
                  </div>
                  <p className="mt-1 shrink-0 text-xs text-fg-muted">Falls back to the English version above until filled in.</p>
                </>
              )}
              {fieldError && <p className="mt-3 shrink-0 text-sm text-danger">{fieldError}</p>}
              <div className="mt-4 flex shrink-0 gap-3">
                <button
                  type="button"
                  onClick={handleFieldSave}
                  disabled={fieldSaving}
                  className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                >
                  {fieldSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingField(null)}
                  disabled={fieldSaving}
                  className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                >
                  Cancel
                </button>
              </div>
            </Modal>
          )}

          {editingCustomPolicy && (
            <Modal
              title={editingCustomPolicy === 'new' ? 'Add Custom Policy' : `Edit ${editingCustomPolicy.title}`}
              onClose={() => setEditingCustomPolicy(null)}
              size="large"
            >
              <div className="mb-3 flex shrink-0 gap-1 border-b border-border">
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    onClick={() => setCustomPolicyLocale(locale)}
                    className={[
                      'shrink-0 border-b-2 px-3 py-1.5 text-xs font-medium transition',
                      customPolicyLocale === locale ? 'border-accent text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
                    ].join(' ')}
                  >
                    {LOCALE_LABELS[locale]}
                  </button>
                ))}
              </div>

              {customPolicyLocale === 'en' ? (
                <>
                  <label className="mb-1 block shrink-0 text-sm font-medium text-fg-secondary">Title</label>
                  <input
                    type="text"
                    value={customPolicyTitleDraft}
                    onChange={(e) => setCustomPolicyTitleDraft(e.target.value)}
                    className="w-full shrink-0 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />

                  <label className="mb-1 mt-4 block shrink-0 text-sm font-medium text-fg-secondary">Body</label>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <RichTextEditor value={customPolicyBodyDraft} onChange={setCustomPolicyBodyDraft} fill />
                  </div>
                </>
              ) : (
                <>
                  <label className="mb-1 block shrink-0 text-sm font-medium text-fg-secondary">Title (Español)</label>
                  <input
                    type="text"
                    value={customPolicyTitleEsDraft}
                    onChange={(e) => setCustomPolicyTitleEsDraft(e.target.value)}
                    placeholder={customPolicyTitleDraft}
                    className="w-full shrink-0 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />

                  <label className="mb-1 mt-4 block shrink-0 text-sm font-medium text-fg-secondary">Body (Español)</label>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <RichTextEditor value={customPolicyBodyEsDraft} onChange={setCustomPolicyBodyEsDraft} fill />
                  </div>
                  <p className="mt-1 shrink-0 text-xs text-fg-muted">Falls back to the English title/body until filled in.</p>
                </>
              )}

              <label className="mt-4 flex shrink-0 items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={customPolicyPublicDraft}
                  onChange={(e) => setCustomPolicyPublicDraft(e.target.checked)}
                />
                Public (visible on the studio's /policies page)
              </label>

              {customPolicyError && <p className="mt-3 shrink-0 text-sm text-danger">{customPolicyError}</p>}

              <div className="mt-4 flex shrink-0 gap-3">
                <button
                  type="button"
                  onClick={handleCustomPolicySave}
                  disabled={customPolicySaving || !customPolicyTitleDraft.trim()}
                  className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                >
                  {customPolicySaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCustomPolicy(null)}
                  disabled={customPolicySaving}
                  className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                >
                  Cancel
                </button>
              </div>
            </Modal>
          )}

          {editingReminderTemplate && (
            <Modal
              title={`Edit ${REMINDER_TEMPLATE_FIELDS.find((f) => f.key === editingReminderTemplate)?.label ?? ''}`}
              onClose={() => setEditingReminderTemplate(null)}
            >
              <div className="flex flex-wrap gap-2">
                {REMINDER_TEMPLATE_FIELDS.find((f) => f.key === editingReminderTemplate)?.placeholders.map(
                  (token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertReminderPlaceholder(token)}
                      className="rounded-full border border-border bg-surface-inset px-2.5 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface hover:text-fg"
                    >
                      {`{{${token}}}`}
                    </button>
                  ),
                )}
              </div>

              <textarea
                ref={reminderTemplateTextareaRef}
                rows={5}
                value={reminderTemplateDraft}
                onChange={(e) => setReminderTemplateDraft(e.target.value)}
                className="mt-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />

              {(() => {
                const { length, segments } = estimateSmsSegments(reminderTemplateDraft)
                return (
                  <p className="mt-2 text-xs text-fg-muted">
                    {length}/160 characters &middot; {segments} SMS segment{segments === 1 ? '' : 's'}
                  </p>
                )
              })()}

              {reminderTemplateError && <p className="mt-3 text-sm text-danger">{reminderTemplateError}</p>}

              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={handleReminderTemplateSave}
                  disabled={reminderTemplateSaving}
                  className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                >
                  {reminderTemplateSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingReminderTemplate(null)}
                  disabled={reminderTemplateSaving}
                  className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                >
                  Cancel
                </button>
              </div>
            </Modal>
          )}

          {showDefaultsModal && (
            <Modal title="Edit Defaults" onClose={() => setShowDefaultsModal(false)}>
              <div className="space-y-4">
                {canManageDefaults && (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Estimate follow-up (hours)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={defaultsForm.estimateFollowUpHours}
                        onChange={(e) => setDefaultsForm({ ...defaultsForm, estimateFollowUpHours: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Gift card expiration (days, blank = never)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={defaultsForm.giftCardDefaultExpirationDays}
                        onChange={(e) =>
                          setDefaultsForm({ ...defaultsForm, giftCardDefaultExpirationDays: e.target.value })
                        }
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </>
                )}
                {canManageReferral && (
                  <>
                    <div>
                      <label className="flex items-start gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          checked={defaultsForm.referralProgramEnabled}
                          onChange={(e) => setDefaultsForm({ ...defaultsForm, referralProgramEnabled: e.target.checked })}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-inset accent-accent"
                        />
                        <span>
                          Run a referral program for this studio
                          <span className="block text-xs text-fg-muted">
                            On (default): "A friend referred them" stays available as an intake option, and clients see
                            their own code after paying a deposit or finishing a session. Off: that option disappears,
                            no new rewards are issued, and the two settings below stop applying.
                          </span>
                        </span>
                      </label>
                    </div>
                    {defaultsForm.referralProgramEnabled && (
                      <>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-fg-secondary">Referral reward ($)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={defaultsForm.referralRewardDollars}
                            onChange={(e) => setDefaultsForm({ ...defaultsForm, referralRewardDollars: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div>
                          <label className="flex items-start gap-2 text-sm text-fg">
                            <input
                              type="checkbox"
                              checked={defaultsForm.referralAllowRepeatRedemption}
                              onChange={(e) =>
                                setDefaultsForm({ ...defaultsForm, referralAllowRepeatRedemption: e.target.checked })
                              }
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-inset accent-accent"
                            />
                            <span>
                              Let the same referred client earn their referrer another reward on a later, separate visit
                              <span className="block text-xs text-fg-muted">
                                Off (default): a specific referred client can earn their referrer a reward at most once,
                                ever. This never limits how many different people can use the same code.
                              </span>
                            </span>
                          </label>
                        </div>
                      </>
                    )}
                  </>
                )}
                {canManageDefaults && (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Cold lead after (days of no activity)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={defaultsForm.coldLeadDays}
                        onChange={(e) => setDefaultsForm({ ...defaultsForm, coldLeadDays: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Timezone</label>
                      <select
                        value={defaultsForm.timezone}
                        onChange={(e) => setDefaultsForm({ ...defaultsForm, timezone: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <option key={tz.value} value={tz.value}>
                            {tz.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="flex items-center gap-2 text-sm text-fg-secondary">
                        <input
                          type="checkbox"
                          checked={defaultsForm.showSidebarBadges}
                          onChange={(e) => setDefaultsForm({ ...defaultsForm, showSidebarBadges: e.target.checked })}
                          className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                        />
                        Show new-item count badges on sidebar navigation
                      </label>
                      <p className="mt-1 text-xs text-fg-muted">
                        Off by default. Doesn't affect the conversations unread badge or the Tasks icon's count, both
                        of which always show.
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Scheduling buffer (minutes)
                      </label>
                      <p className="mb-1 text-xs text-fg-muted">
                        Appointments for the same artist within this window of each other are flagged as a possible
                        conflict (a heads-up, not a hard block).
                      </p>
                      <input
                        type="number"
                        min="0"
                        value={defaultsForm.schedulingBufferMinutes}
                        onChange={(e) => setDefaultsForm({ ...defaultsForm, schedulingBufferMinutes: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Deposit processing fee ($)
                      </label>
                      <p className="mb-1 text-xs text-fg-muted">
                        Flat fee added on top of the deposit amount from the tiers below.
                      </p>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={defaultsForm.depositFeeDollars}
                        onChange={(e) => setDefaultsForm({ ...defaultsForm, depositFeeDollars: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Default deposit form amount</label>
                      <p className="mb-1 text-xs text-fg-muted">
                        What a fresh deposit form starts as when staff sends one -- they can still switch it per-send.
                      </p>
                      <select
                        value={defaultsForm.defaultDepositAmountMode}
                        onChange={(e) =>
                          setDefaultsForm({
                            ...defaultsForm,
                            defaultDepositAmountMode: e.target.value as 'DEPOSIT' | 'FULL_PREPAY',
                          })
                        }
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="DEPOSIT">Deposit (tier-based)</option>
                        <option value="FULL_PREPAY">Full prepayment</option>
                      </select>
                    </div>
                  </>
                )}

                {defaultsError && <p className="text-sm text-danger">{defaultsError}</p>}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleDefaultsSave}
                    disabled={defaultsSaving}
                    className={
                        isEditorial
                          ? 'editorial-btn-primary rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                          : 'rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      }
                  >
                    {defaultsSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDefaultsModal(false)}
                    disabled={defaultsSaving}
                    className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {activeTab === 'integrations' && canViewIntegrations && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>Integrations</h2>
              <p className="mt-1 text-sm text-fg-secondary">
                Connect your own provider accounts -- your credentials, encrypted, never shared across studios.
              </p>

              {integrationsError && <p className="mt-4 text-sm text-danger">{integrationsError}</p>}
              {gmailOAuthNotice && (
                <p className={`mt-4 text-sm ${gmailOAuthNotice.kind === 'success' ? 'text-success' : 'text-danger'}`}>
                  {gmailOAuthNotice.message}
                </p>
              )}

              <div className="mt-4 space-y-4">
                {integrations?.map((integration) => {
                  if (integration.channel === 'EMAIL') {
                    const metadataEmail = (integration.metadata as { emailAddress?: string } | null)?.emailAddress ?? null

                    return (
                      <div key="EMAIL" className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-fg">{CHANNEL_LABELS.EMAIL}</p>
                            {integration.status === 'CONNECTED' && integration.displayName && (
                              <p className="mt-0.5 text-xs text-fg-secondary">{integration.displayName}</p>
                            )}
                            {integration.status === 'ERROR' && integration.lastError && (
                              <p className="mt-0.5 text-xs text-danger">Last attempt failed: {integration.lastError}</p>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {integration.status === 'CONNECTED' ? (
                              <>
                                <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
                                  Connected
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setShowDisconnectConfirm('EMAIL')}
                                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                                >
                                  Disconnect
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={handleConnectGmail}
                                disabled={connectingGmail}
                                className={
                                  isEditorial
                                    ? 'editorial-btn-primary rounded-full bg-accent px-3 py-1.5 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                    : 'rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                }
                              >
                                {connectingGmail ? 'Redirecting…' : integration.status === 'ERROR' ? 'Try again' : 'Connect Gmail'}
                              </button>
                            )}
                          </div>
                        </div>

                        {integration.status === 'CONNECTED' && (
                          <div className="mt-4 space-y-4 border-t border-border pt-4">
                            {integration.connectedAt && (
                              <p className="text-xs text-fg-muted">Connected {formatDateTime(integration.connectedAt)}</p>
                            )}

                            <form onSubmit={handleSendTestEmail} className="flex flex-wrap items-end gap-2">
                              <div className="min-w-[200px] flex-1">
                                <label className="mb-1 block text-xs font-medium text-fg-secondary">
                                  Send test email to
                                </label>
                                <input
                                  type="email"
                                  required
                                  value={testEmailTo}
                                  onChange={(e) => setTestEmailTo(e.target.value)}
                                  placeholder="you@example.com"
                                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={testEmailSending || !testEmailTo.trim()}
                                className="rounded-full border border-border px-3 py-2 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                              >
                                {testEmailSending ? 'Sending…' : 'Send test email'}
                              </button>
                            </form>
                            {testEmailResult && <p className="text-xs text-fg-secondary">{testEmailResult}</p>}

                            {metadataEmail && <p className="text-xs text-fg-muted">Connected address: {metadataEmail}</p>}
                          </div>
                        )}
                      </div>
                    )
                  }

                  if (integration.channel === 'STRIPE') {
                    const stripeMeta = integration.metadata as unknown as StripeIntegrationMetadata | null
                    const isLive = integration.status === 'CONNECTED' && stripeMeta?.chargesEnabled
                    const setupIncomplete = integration.status === 'CONNECTED' && !stripeMeta?.chargesEnabled

                    return (
                      <div key="STRIPE" className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-fg">{CHANNEL_LABELS.STRIPE}</p>
                            {integration.status === 'CONNECTED' && integration.displayName && (
                              <p className="mt-0.5 text-xs text-fg-secondary">{integration.displayName}</p>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {integration.status === 'CONNECTED' ? (
                              <>
                                <span
                                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                                    isLive ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                                  }`}
                                >
                                  {isLive ? 'Payments are live' : 'Setup incomplete'}
                                </span>
                                {setupIncomplete && (
                                  <button
                                    type="button"
                                    onClick={handleConnectStripe}
                                    disabled={connectingStripe}
                                    className={
                                  isEditorial
                                    ? 'editorial-btn-primary rounded-full bg-accent px-3 py-1.5 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                    : 'rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                }
                                  >
                                    {connectingStripe ? 'Redirecting…' : 'Finish setup'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setShowDisconnectConfirm('STRIPE')}
                                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                                >
                                  Disconnect
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={handleConnectStripe}
                                disabled={connectingStripe}
                                className={
                                  isEditorial
                                    ? 'editorial-btn-primary rounded-full bg-accent px-3 py-1.5 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                    : 'rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                }
                              >
                                {connectingStripe ? 'Redirecting…' : 'Connect with Stripe'}
                              </button>
                            )}
                          </div>
                        </div>

                        {integration.status === 'CONNECTED' && (
                          <div className="mt-4 space-y-1 border-t border-border pt-4 text-xs text-fg-muted">
                            {integration.connectedAt && <p>Connected {formatDateTime(integration.connectedAt)}</p>}
                            {setupIncomplete && (
                              <p className="text-warning">
                                Onboarding wasn't finished on Stripe's side -- real deposit/checkout payments won't
                                work until it is. Click "Finish setup" to pick up where you left off.
                              </p>
                            )}
                          </div>
                        )}

                        {stripeError && <p className="mt-3 text-xs text-danger">{stripeError}</p>}
                      </div>
                    )
                  }

                  if (integration.channel === 'BIRD_SMS') {
                    return (
                      <div key="BIRD_SMS" className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-fg">{CHANNEL_LABELS.BIRD_SMS}</p>
                            <p className="mt-0.5 text-xs text-fg-muted">
                              Test-only for now -- client-facing texts still send through SMS (Twilio) above.
                            </p>
                            {integration.status === 'ERROR' && integration.lastError && (
                              <p className="mt-0.5 text-xs text-danger">Last attempt failed: {integration.lastError}</p>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {integration.status === 'CONNECTED' ? (
                              <>
                                <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
                                  Connected
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setShowDisconnectConfirm('BIRD_SMS')}
                                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                                >
                                  Disconnect
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={handleConnectBirdSms}
                                disabled={connectingBirdSms}
                                className={
                                  isEditorial
                                    ? 'editorial-btn-primary rounded-full bg-accent px-3 py-1.5 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                    : 'rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                                }
                              >
                                {connectingBirdSms ? 'Connecting…' : integration.status === 'ERROR' ? 'Try again' : 'Connect'}
                              </button>
                            )}
                          </div>
                        </div>

                        {birdSmsError && <p className="mt-3 text-xs text-danger">{birdSmsError}</p>}

                        {integration.status === 'CONNECTED' && (
                          <div className="mt-4 space-y-4 border-t border-border pt-4">
                            {integration.connectedAt && (
                              <p className="text-xs text-fg-muted">Connected {formatDateTime(integration.connectedAt)}</p>
                            )}

                            <form onSubmit={handleSendTestBirdSms} className="flex flex-wrap items-end gap-2">
                              <div className="min-w-[200px] flex-1">
                                <label className="mb-1 block text-xs font-medium text-fg-secondary">
                                  Send test message to
                                </label>
                                <PhoneInput
                                  value={testBirdSmsTo}
                                  onChange={setTestBirdSmsTo}
                                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                              </div>
                              <button
                                type="submit"
                                disabled={testBirdSmsSending || !isValidPhoneDigits(testBirdSmsTo)}
                                className="rounded-full border border-border px-3 py-2 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                              >
                                {testBirdSmsSending ? 'Sending…' : 'Send test message'}
                              </button>
                            </form>
                            {testBirdSmsResult && <p className="text-xs text-fg-secondary">{testBirdSmsResult}</p>}
                          </div>
                        )}
                      </div>
                    )
                  }

                  if (integration.channel !== 'SMS') {
                    return (
                      <div key={integration.channel} className="rounded-xl border border-border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-fg">{CHANNEL_LABELS[integration.channel]}</p>
                          <span className="rounded-full bg-surface-inset px-3 py-1 text-xs font-medium text-fg-muted">
                            Coming soon
                          </span>
                        </div>
                      </div>
                    )
                  }

                  const metadataPhone =
                    (integration.metadata as { phoneNumber?: string } | null)?.phoneNumber ?? null

                  return (
                    <div key={integration.channel} className="rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-fg">{CHANNEL_LABELS[integration.channel]}</p>
                          {integration.status === 'CONNECTED' && integration.displayName && (
                            <p className="mt-0.5 text-xs text-fg-secondary">{integration.displayName}</p>
                          )}
                          {integration.status === 'ERROR' && integration.lastError && (
                            <p className="mt-0.5 text-xs text-danger">Last attempt failed: {integration.lastError}</p>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {integration.status === 'CONNECTED' ? (
                            <>
                              <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
                                Connected
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowDisconnectConfirm('SMS')}
                                className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                              >
                                Disconnect
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSmsConnectError(null)
                                setShowConnectSms(true)
                              }}
                              className={
                                isEditorial
                                  ? 'editorial-btn-primary rounded-full bg-accent px-3 py-1.5 text-bg transition hover:bg-accent-hover'
                                  : 'rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover'
                              }
                            >
                              {integration.status === 'ERROR' ? 'Try again' : 'Connect'}
                            </button>
                          )}
                        </div>
                      </div>

                      {integration.status === 'CONNECTED' && (
                        <div className="mt-4 space-y-4 border-t border-border pt-4">
                          {integration.connectedAt && (
                            <p className="text-xs text-fg-muted">
                              Connected {formatDateTime(integration.connectedAt)}
                            </p>
                          )}

                          <form onSubmit={handleSendTestMessage} className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[200px] flex-1">
                              <label className="mb-1 block text-xs font-medium text-fg-secondary">
                                Send test message to
                              </label>
                              <PhoneInput
                                value={testMessageTo}
                                onChange={setTestMessageTo}
                                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            </div>
                            <button
                              type="submit"
                              disabled={testMessageSending || !isValidPhoneDigits(testMessageTo)}
                              className="rounded-full border border-border px-3 py-2 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                            >
                              {testMessageSending ? 'Sending…' : 'Send test message'}
                            </button>
                          </form>
                          {testMessageResult && (
                            <p className="text-xs text-fg-secondary">{testMessageResult}</p>
                          )}

                          <div>
                            <p className="text-xs font-medium text-fg-secondary">Inbound webhook URL</p>
                            <p className="mt-1 text-xs text-fg-muted">
                              In your Twilio console, under this number's messaging configuration, set "A message
                              comes in" to this URL (HTTP POST).
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                type="text"
                                readOnly
                                value={smsWebhookUrl ?? ''}
                                onFocus={(e) => e.target.select()}
                                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-xs text-fg focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={handleCopyWebhookUrl}
                                aria-label="Copy webhook URL"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-fg-muted transition hover:bg-surface hover:text-fg"
                              >
                                <CopyIcon className="h-4 w-4" />
                              </button>
                            </div>
                            {copiedWebhook && <p className="mt-1 text-xs text-success">Copied.</p>}
                          </div>

                          {metadataPhone && (
                            <p className="text-xs text-fg-muted">From number: {metadataPhone}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {showConnectSms && (
            <Modal
              title="Connect SMS (Twilio)"
              onClose={() => {
                setShowConnectSms(false)
                setSmsConnectError(null)
              }}
            >
              <form onSubmit={handleConnectSms}>
                <p className="mb-4 text-xs text-fg-secondary">
                  Your own Twilio account credentials -- encrypted at rest, never shared with any other studio.
                </p>

                <div className="mb-3">
                  <label htmlFor="twilioAccountSid" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Account SID
                  </label>
                  <input
                    id="twilioAccountSid"
                    type="text"
                    required
                    value={smsConnectForm.accountSid}
                    onChange={(e) => setSmsConnectForm({ ...smsConnectForm, accountSid: e.target.value })}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="twilioAuthToken" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Auth Token
                  </label>
                  <input
                    id="twilioAuthToken"
                    type="password"
                    required
                    value={smsConnectForm.authToken}
                    onChange={(e) => setSmsConnectForm({ ...smsConnectForm, authToken: e.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="twilioFromNumber" className="mb-1 block text-sm font-medium text-fg-secondary">
                    From number
                  </label>
                  <input
                    id="twilioFromNumber"
                    type="text"
                    required
                    value={smsConnectForm.fromNumber}
                    onChange={(e) => setSmsConnectForm({ ...smsConnectForm, fromNumber: e.target.value })}
                    placeholder="+19195551234"
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mb-3">
                  <label htmlFor="twilioMessagingServiceSid" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Messaging Service SID <span className="font-normal text-fg-muted">(optional)</span>
                  </label>
                  <input
                    id="twilioMessagingServiceSid"
                    type="text"
                    value={smsConnectForm.messagingServiceSid}
                    onChange={(e) => setSmsConnectForm({ ...smsConnectForm, messagingServiceSid: e.target.value })}
                    placeholder="MG…"
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="mt-1 text-xs text-fg-muted">
                    Recommended for US/Canada texting. Routes every message through your approved A2P campaign, its
                    sender pool and opt-out handling. The From number above must be in that service&rsquo;s sender pool.
                  </p>
                </div>

                {smsConnectError && <p className="mb-3 text-sm text-danger">{smsConnectError}</p>}

                <button
                  type="submit"
                  disabled={smsConnecting}
                  className={
                    isEditorial
                      ? 'editorial-btn-primary w-full rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                      : 'w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60'
                  }
                >
                  {smsConnecting ? 'Connecting…' : 'Connect'}
                </button>
              </form>
            </Modal>
          )}

          {showDisconnectConfirm && (
            <Modal title={`Disconnect ${CHANNEL_LABELS[showDisconnectConfirm]}`} onClose={() => setShowDisconnectConfirm(null)}>
              <p className="text-sm text-fg-secondary">
                {showDisconnectConfirm === 'EMAIL'
                  ? 'Outbound messages will fall back to log-only (no real send) until Email is reconnected. Inbound emails will no longer be polled or land in threads.'
                  : showDisconnectConfirm === 'STRIPE'
                    ? "This only clears Ink Manager's own record of the connection -- your Stripe account itself is untouched and still exists. Deposits and checkout will fall back to manual-only payment collection until Stripe is reconnected."
                    : showDisconnectConfirm === 'BIRD_SMS'
                      ? "This just turns off test-sending via Bird for this studio -- nothing client-facing uses it yet, so there's no fallback to worry about."
                      : 'Outbound messages will fall back to log-only (no real send) until SMS is reconnected. Inbound texts will no longer be validated or land in threads.'}
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => handleDisconnectChannel(showDisconnectConfirm)}
                  disabled={disconnecting}
                  className="flex-1 rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDisconnectConfirm(null)}
                  disabled={disconnecting}
                  className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60'
                    }
                >
                  Cancel
                </button>
              </div>
            </Modal>
          )}

          {activeTab === 'system' && canViewSystem && (
            <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-6">
              <h2 className={isEditorial ? 'sc text-[22px]' : 'text-lg font-semibold text-fg'}>System</h2>
              <p className="mt-1 text-sm text-fg-secondary">
                These automatic tasks run on their own schedule (some nightly, some every 15 minutes) to keep your
                data up to date.
              </p>

              {jobsError && <p className="mt-4 text-sm text-danger">{jobsError}</p>}
              {!jobsError && jobs === null && <p className="mt-4 text-sm text-fg-secondary">Loading…</p>}
              {!jobsError && jobs !== null && jobs.length === 0 && (
                <p className="mt-4 text-sm text-fg-secondary">No automatic tasks yet.</p>
              )}

              {jobs && jobs.length > 0 && (
                <ul className="mt-4 space-y-3">
                  {jobs.map((job) => {
                    const display = JOB_DISPLAY[job.jobName] ?? {
                      friendlyName: job.jobName,
                      plainDescription: job.description,
                    }
                    return (
                      <li key={job.jobName} className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-fg">{display.friendlyName}</p>
                            <p className="mt-0.5 text-xs text-fg-secondary">{display.plainDescription}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRunNow(job.jobName)}
                            disabled={runningJob === job.jobName}
                            className={
                              isEditorial
                                ? 'editorial-btn-secondary shrink-0 rounded-full border px-3 py-1.5 transition disabled:opacity-60'
                                : 'shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60'
                            }
                          >
                            {runningJob === job.jobName ? 'Running…' : 'Run Now'}
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <JobStatusDisplay lastRun={job.lastRun} />
                          {job.lastRun && (
                            <span
                              className="text-xs text-fg-muted"
                              title={formatDateTime(job.lastRun.startedAt)}
                            >
                              {formatRelativeDateTime(job.lastRun.startedAt, policies?.timezone ?? 'America/New_York')}
                            </span>
                          )}
                        </div>

                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg-secondary">
                            Advanced
                          </summary>
                          <p className="mt-1 text-xs text-fg-muted">
                            Internal name: {job.jobName} &middot; Schedule: {job.schedule}
                          </p>
                          {job.lastRun?.details && Object.keys(job.lastRun.details).length > 0 && (
                            <p className="mt-1 text-xs text-fg-muted">
                              Last run details: {JSON.stringify(job.lastRun.details)}
                            </p>
                          )}
                        </details>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
  )
}

function JobStatusDisplay({ lastRun }: { lastRun: JobRunInfo | null }) {
  if (!lastRun) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
        <ClockIcon className="h-4 w-4" />
        Not run yet
      </span>
    )
  }
  if (lastRun.status === 'RUNNING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-info">
        <SpinnerIcon className="h-4 w-4 animate-spin" />
        Running…
      </span>
    )
  }
  if (lastRun.status === 'FAILED') {
    const reason = lastRun.error ? (lastRun.error.length > 80 ? `${lastRun.error.slice(0, 80)}…` : lastRun.error) : null
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-danger">
        <CloseIcon className="h-4 w-4" />
        Failed{reason ? ` — ${reason}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-success">
      <CheckIcon className="h-4 w-4" />
      Succeeded
    </span>
  )
}

function LocationCard({
  location,
  canManage,
  confirmingDelete,
  onEdit,
  onDeleteClick,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  location: Location
  canManage: boolean
  confirmingDelete: boolean
  onEdit: () => void
  onDeleteClick: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
}) {
  const summary = hoursSummary(location.hours)

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">{location.name}</p>
          {location.address && (
            <a
              href={googleMapsUrl(location.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-xs text-fg-secondary underline decoration-border-strong underline-offset-2 hover:text-fg"
            >
              {location.address}
            </a>
          )}
          {location.phone && <p className="mt-1 text-xs text-fg-secondary">{formatPhoneInput(location.phone)}</p>}
          {location.email && <p className="mt-1 text-xs text-fg-secondary">{location.email}</p>}
        </div>

        {canManage && !confirmingDelete && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDeleteClick}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface hover:text-fg"
            >
              Delete
            </button>
          </div>
        )}

        {canManage && confirmingDelete && (
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <span className="text-fg-secondary">Delete this location?</span>
            <button
              type="button"
              onClick={onDeleteConfirm}
              className="rounded-full border border-danger/40 bg-danger/10 px-3 py-1.5 font-medium text-danger transition hover:bg-danger/20"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded-full border border-border px-3 py-1.5 font-medium text-fg transition hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {summary && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border pt-3 sm:grid-cols-4">
          {summary.map((day) => (
            <div key={day.label} className="text-xs">
              <span className="text-fg-muted">{day.label} </span>
              <span className="text-fg-secondary">{day.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LocationForm({
  form,
  error,
  submitting,
  onFieldChange,
  onPhoneChange,
  onHoursChange,
  onSubmit,
  onCancel,
}: {
  form: { name: string; address: string; phone: string; email: string; hours: LocationHoursDay[] }
  error: string | null
  submitting: boolean
  onFieldChange: (field: 'name' | 'address' | 'phone' | 'email') => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onPhoneChange: (value: string) => void
  onHoursChange: (day: number, patch: Partial<LocationHoursDay>) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
}) {
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-bg p-4">
      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="locationName" className="mb-1 block text-sm font-medium text-fg-secondary">
          Location name
        </label>
        <input
          id="locationName"
          type="text"
          required
          placeholder="Downtown"
          value={form.name}
          onChange={onFieldChange('name')}
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="mb-4">
        <label htmlFor="locationAddress" className="mb-1 block text-sm font-medium text-fg-secondary">
          Address
        </label>
        <textarea
          id="locationAddress"
          rows={2}
          placeholder="123 Main St, Suite 2, Portland, OR 97201"
          value={form.address}
          onChange={onFieldChange('address')}
          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="locationPhone" className="mb-1 block text-sm font-medium text-fg-secondary">
            Phone
          </label>
          <PhoneInput
            id="locationPhone"
            value={form.phone}
            onChange={onPhoneChange}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label htmlFor="locationEmail" className="mb-1 block text-sm font-medium text-fg-secondary">
            Contact email
          </label>
          <input
            id="locationEmail"
            type="email"
            placeholder="hello@yourstudio.com"
            value={form.email}
            onChange={onFieldChange('email')}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <div className="mb-4">
        <span className="mb-2 block text-sm font-medium text-fg-secondary">Hours</span>
        <div className="space-y-2">
          {form.hours.map((day) => (
            <div key={day.day} className="flex flex-wrap items-center gap-2">
              <span className="w-9 text-xs font-medium text-fg-secondary">{DAY_LABELS[day.day]}</span>
              <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  checked={day.closed}
                  onChange={(event) => onHoursChange(day.day, { closed: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
                />
                Closed
              </label>
              <input
                type="time"
                value={day.open ?? ''}
                disabled={day.closed}
                onChange={(event) => onHoursChange(day.day, { open: event.target.value })}
                className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
              />
              <span className="text-xs text-fg-muted">to</span>
              <input
                type="time"
                value={day.close ?? ''}
                disabled={day.closed}
                onChange={(event) => onHoursChange(day.day, { close: event.target.value })}
                className="rounded-lg border border-border bg-surface-inset px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className={
                      isEditorial
                        ? 'editorial-btn-primary flex-1 rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover disabled:opacity-60'
                        : 'flex-1 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60'
                    }
        >
          {submitting ? 'Saving…' : 'Save location'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={
                      isEditorial
                        ? 'editorial-btn-secondary rounded-full border px-4 py-2 transition disabled:opacity-60'
                        : 'rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60'
                    }
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

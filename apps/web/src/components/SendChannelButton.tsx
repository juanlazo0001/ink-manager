import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import DropdownPortal from './DropdownPortal'
import { SendIcon, ChevronDownIcon } from './icons'

export type SendChannel = 'SMS' | 'EMAIL'

interface IntegrationStatusResponse {
  sms: boolean
  email: boolean
  instagram: boolean
  facebook: boolean
}

interface SendChannelButtonProps {
  // The full base label as it should read with no channel suffix yet --
  // e.g. "Send Deposit Form" or "Generate & Resend Estimate". This
  // component never prepends its own "Send" -- callers vary on verb
  // ("Send"/"Generate & Send"/"Generate & Resend"), so it just appends
  // " via SMS"/" via Email"/"…" to whatever's passed. Also doubles as the
  // accessible name (aria-label/title) on the icon-only mobile button.
  label: string
  // Validation pass finding, live-reproduced: a client can genuinely have
  // a phone/email on file (real ClientPhone/ClientEmail rows, visible in
  // ClientDetail.tsx's own Contact Info widget) while Client.phone/email
  // -- the singular scalar -- sits null, because POST /clients/:id/phones
  // and /emails never synced back to it. That write-path gap is fixed
  // (routes/clients.ts), but this component takes plain booleans rather
  // than a phone/email string specifically so every caller is forced to
  // derive them from the real contact rows (`client.phones.length > 0`,
  // not `!!client.phone`) instead of reaching for the scalar out of
  // convenience and reintroducing the same bug at a new call site.
  hasPhone: boolean
  hasEmail: boolean
  sending: boolean
  sendingLabel?: string
  onSend: (channel: SendChannel) => void
  className?: string
}

// Send-channel picker: the one shared control every client-facing send
// button swaps its plain <button> for. SMS needs this studio's own SMS
// connected (same ['sms-integration-status'] cache ConversationsPanel.tsx
// already keeps warm and live-invalidates on integration.changed -- one
// fetch shared across every instance on a page, not one per button).
// Email doesn't gate on the studio's own email integration at all --
// unlike SMS, there's always a platform-level fallback (lib/clientEmail.ts),
// so the only question is whether this client HAS an email, matching the
// task's own "Email only if they have an email address" framing exactly.
//
// Responsive per Juan's live validation pass: compact icon-only at mobile
// widths (accessible name via aria-label/title, same convention every
// other icon-only mobile button in this app already uses), full labeled
// button at desktop -- restoring the pattern this component's own first
// draft (and the UI-batch item before it) had moved away from for THESE
// specifically-Send buttons. More actions fit per row on a narrow screen
// this way; a page with several Send buttons in one row row-wraps far
// less aggressively than it would with every one of them fully labeled.
export default function SendChannelButton({
  label,
  hasPhone,
  hasEmail,
  sending,
  sendingLabel = 'Sending…',
  onSend,
  className,
}: SendChannelButtonProps) {
  const [showMenu, setShowMenu] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const { data: status } = useQuery({
    queryKey: ['sms-integration-status'],
    queryFn: () => apiFetch<IntegrationStatusResponse>('/integrations/status'),
    staleTime: 60_000,
  })

  const smsAvailable = hasPhone && (status?.sms ?? true)
  const emailAvailable = hasEmail

  const baseClass =
    className ??
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2'
  const labelClass = 'hidden whitespace-nowrap text-sm font-semibold md:inline'

  if (!smsAvailable && !emailAvailable) {
    const reason = !hasPhone && !hasEmail ? 'no phone or email on file' : 'no available send channel'
    const title = `Can't send -- this client has ${reason}.`
    return (
      <button type="button" disabled aria-label={label} title={title} className={baseClass}>
        <SendIcon className="h-4 w-4" />
        <span className={labelClass}>{sending ? sendingLabel : label}</span>
      </button>
    )
  }

  if (smsAvailable && !emailAvailable) {
    return (
      <button
        type="button"
        onClick={() => onSend('SMS')}
        disabled={sending}
        aria-label={`${label} via SMS`}
        title={`${label} via SMS`}
        className={baseClass}
      >
        <SendIcon className="h-4 w-4" />
        <span className={labelClass}>{sending ? sendingLabel : `${label} via SMS`}</span>
      </button>
    )
  }

  if (emailAvailable && !smsAvailable) {
    return (
      <button
        type="button"
        onClick={() => onSend('EMAIL')}
        disabled={sending}
        aria-label={`${label} via Email`}
        title={`${label} via Email`}
        className={baseClass}
      >
        <SendIcon className="h-4 w-4" />
        <span className={labelClass}>{sending ? sendingLabel : `${label} via Email`}</span>
      </button>
    )
  }

  // Both available -- "…" opens a two-item menu, SMS listed first
  // (default preselection).
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setShowMenu((v) => !v)}
        disabled={sending}
        aria-label={`${label} -- choose SMS or Email`}
        title={`${label} -- choose SMS or Email`}
        className={baseClass}
      >
        <SendIcon className="h-4 w-4" />
        <span className={labelClass}>{sending ? sendingLabel : `${label}…`}</span>
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>
      <DropdownPortal open={showMenu} onClose={() => setShowMenu(false)} anchorRef={buttonRef} align="end" className="w-40">
        <button
          type="button"
          onClick={() => {
            setShowMenu(false)
            onSend('SMS')
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
        >
          via SMS
        </button>
        <button
          type="button"
          onClick={() => {
            setShowMenu(false)
            onSend('EMAIL')
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
        >
          via Email
        </button>
      </DropdownPortal>
    </div>
  )
}

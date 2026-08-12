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
  // " via SMS"/" via Email"/"…" to whatever's passed.
  label: string
  client: { phone: string | null; email: string | null }
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
export default function SendChannelButton({
  label,
  client,
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

  const smsAvailable = !!client.phone && (status?.sms ?? true)
  const emailAvailable = !!client.email

  const baseClass =
    className ??
    'flex shrink-0 items-center gap-2 rounded-full border border-border px-4 py-2 text-fg transition hover:bg-surface disabled:opacity-60'

  if (!smsAvailable && !emailAvailable) {
    const reason = !client.phone && !client.email ? 'no phone or email on file' : 'no available send channel'
    return (
      <button type="button" disabled title={`Can't send -- this client has ${reason}.`} className={baseClass}>
        <SendIcon className="h-4 w-4" />
        <span className="whitespace-nowrap text-sm font-semibold">{sending ? sendingLabel : label}</span>
      </button>
    )
  }

  if (smsAvailable && !emailAvailable) {
    return (
      <button type="button" onClick={() => onSend('SMS')} disabled={sending} className={baseClass}>
        <SendIcon className="h-4 w-4" />
        <span className="whitespace-nowrap text-sm font-semibold">{sending ? sendingLabel : `${label} via SMS`}</span>
      </button>
    )
  }

  if (emailAvailable && !smsAvailable) {
    return (
      <button type="button" onClick={() => onSend('EMAIL')} disabled={sending} className={baseClass}>
        <SendIcon className="h-4 w-4" />
        <span className="whitespace-nowrap text-sm font-semibold">{sending ? sendingLabel : `${label} via Email`}</span>
      </button>
    )
  }

  // Both available -- "…" opens a two-item menu, SMS listed first
  // (default preselection).
  return (
    <div className="relative">
      <button ref={buttonRef} type="button" onClick={() => setShowMenu((v) => !v)} disabled={sending} className={baseClass}>
        <SendIcon className="h-4 w-4" />
        <span className="whitespace-nowrap text-sm font-semibold">{sending ? sendingLabel : `${label}…`}</span>
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>
      <DropdownPortal
        open={showMenu}
        onClose={() => setShowMenu(false)}
        anchorRef={buttonRef}
        align="end"
        className="w-40 rounded-xl border border-border bg-surface-raised p-1 shadow-xl"
      >
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

export type ClientSendResult =
  | { sent: true }
  | { sent: false; reason: 'not_connected' | 'no_phone' | 'opted_out' | 'no_email' | 'send_failed'; error?: string }

// Shared across every auto-send-on-generate flow (estimate, deposit form,
// waiver, consent form, prefilled intake link) -- same best-effort send
// path (lib/clientSms.ts sendClientSms / lib/clientEmail.ts
// sendClientEmail), same shape of result, same "generated regardless,
// sent best-effort" messaging. `channel` picks the right verb/noun instead
// of always assuming SMS.
export function describeSendResult(
  thing: string,
  result: ClientSendResult | null | undefined,
  channel: 'SMS' | 'EMAIL' = 'SMS',
): string | null {
  if (!result) return null
  const via = channel === 'EMAIL' ? 'via email' : 'via text'
  if (result.sent) return `${thing} sent to the client ${via} — check Conversations.`
  switch (result.reason) {
    case 'not_connected':
      return `${thing} generated, but SMS isn't connected for this studio — share the link below manually.`
    case 'no_phone':
      return `${thing} generated, but this client has no phone on file — share the link below manually.`
    case 'opted_out':
      return `${thing} generated, but this client has opted out of texts — share the link below manually.`
    case 'no_email':
      return `${thing} generated, but this client has no email on file — share the link below manually.`
    default:
      return `${thing} generated, but the ${channel === 'EMAIL' ? 'email' : 'text'} failed to send — share the link below manually.`
  }
}

export type ClientSendResult =
  | { sent: true }
  | { sent: false; reason: 'not_connected' | 'no_phone' | 'opted_out' | 'send_failed'; error?: string }

// Shared across every auto-send-on-generate flow (estimate, deposit form,
// waiver, consent form, prefilled intake link) -- same best-effort SMS
// path (lib/clientSms.ts sendClientSms), same shape of result, same
// "generated regardless, texted best-effort" messaging.
export function describeSendResult(thing: string, result: ClientSendResult | null | undefined): string | null {
  if (!result) return null
  if (result.sent) return `${thing} sent to the client via text — check Conversations.`
  switch (result.reason) {
    case 'not_connected':
      return `${thing} generated, but SMS isn't connected for this studio — share the link below manually.`
    case 'no_phone':
      return `${thing} generated, but this client has no phone on file — share the link below manually.`
    case 'opted_out':
      return `${thing} generated, but this client has opted out of texts — share the link below manually.`
    default:
      return `${thing} generated, but the text failed to send — share the link below manually.`
  }
}

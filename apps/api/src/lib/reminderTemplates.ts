// Shared by the reminder-cadence cron ticker (lib/jobs/reminderTicker.ts)
// and the Twilio inbound webhook's opt-in-confirmation/HELP auto-replies
// (routes/webhooks.ts) -- one render implementation and one template
// shape, not two that happen to agree. optInConfirmation/helpResponse are
// sent from the webhook directly (on a matched inbound keyword), not on
// the ticker's own cadence -- they still live in this same JSON field and
// editor since they're the same kind of thing (a plain-text SMS template
// with {{placeholder}} tokens), not a second template system.
export interface ReminderTemplates {
  clientWeekBefore: string;
  clientNightBefore: string;
  clientMorningOf: string;
  artistDayBefore: string;
  estimateFollowUp: string;
  optInConfirmation: string;
  helpResponse: string;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

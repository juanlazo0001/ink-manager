import { BellIcon } from './icons'

export default function ReminderCard() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-fg-secondary">
          <BellIcon className="h-4 w-4" />
        </span>
        <h2 className="text-base font-semibold text-fg">Reminder</h2>
      </div>

      <p className="mt-3 text-sm text-fg-secondary">
        3 clients have appointments this week without a signed consent form.
      </p>

      <button
        type="button"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface-raised"
      >
        Review Now
      </button>
    </div>
  )
}

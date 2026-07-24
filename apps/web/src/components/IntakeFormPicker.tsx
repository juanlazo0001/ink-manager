import Modal from './Modal'
import type { IntakeFormOption } from '../lib/useIntakeForms'

// Shown only when a studio has more than one intake form -- callers are
// responsible for skipping this entirely when useIntakeForms() returns
// one form or fewer (the common case), matching the same "advisory,
// doesn't disrupt simple usage" philosophy already used for
// preferredSchedule: no extra click imposed on a studio that never uses
// multiple forms.
export default function IntakeFormPicker({
  forms,
  onSelect,
  onClose,
}: {
  forms: IntakeFormOption[]
  onSelect: (form: IntakeFormOption) => void
  onClose: () => void
}) {
  return (
    <Modal title="Which intake form?" onClose={onClose}>
      <p className="mb-3 text-sm text-fg-secondary">This studio has more than one intake form -- pick which one the link should open.</p>
      <div className="space-y-2">
        {forms.map((form) => (
          <button
            key={form.id}
            type="button"
            onClick={() => onSelect(form)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm font-medium text-fg transition hover:bg-surface"
          >
            {form.name}
            {form.isDefault && (
              <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                Default
              </span>
            )}
          </button>
        ))}
      </div>
    </Modal>
  )
}

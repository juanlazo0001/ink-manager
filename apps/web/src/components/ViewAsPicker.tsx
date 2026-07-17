import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from './Modal'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { useViewAs } from '../context/useViewAs'

interface StaffRosterEntry {
  id: string
  name: string
  email: string
  role: string
}

// Reuses the same OWNER/FRONT_DESK staff roster the conversations panel
// and the task-assignment picker already use -- it already excludes
// CUSTOMER-role users, exactly the set View As can target.
export default function ViewAsPicker({ onClose }: { onClose: () => void }) {
  const { user: realUser } = useAuth()
  const { startViewAs } = useViewAs()
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: roster } = useQuery({
    queryKey: ['conversations-staff-roster'],
    queryFn: () => apiFetch<StaffRosterEntry[]>('/conversations/staff'),
  })

  const targets = (roster ?? []).filter((member) => member.id !== realUser?.userId)

  async function handleSelect(id: string) {
    setActivating(true)
    setError(null)
    try {
      await startViewAs(id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start View As')
    } finally {
      setActivating(false)
    }
  }

  return (
    <Modal title="View portal as..." onClose={onClose}>
      <p className="text-xs text-neutral-500">
        You'll see the portal exactly as they do -- their navigation, their data, their permission walls. Read-only
        while active.
      </p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 space-y-1">
        {roster === undefined && <p className="text-sm text-neutral-400">Loading…</p>}
        {roster && targets.length === 0 && <p className="text-sm text-neutral-400">No other staff members yet.</p>}
        {targets.map((member) => (
          <button
            key={member.id}
            type="button"
            disabled={activating}
            onClick={() => handleSelect(member.id)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-left text-sm text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="truncate">{member.name}</span>
            <span className="shrink-0 text-xs text-neutral-500">{member.role}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

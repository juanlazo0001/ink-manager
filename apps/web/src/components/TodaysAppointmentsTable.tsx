import StatusPill from './StatusPill'

const APPOINTMENTS = [
  { client: 'Maria Gonzalez', artist: 'Jordan Vega', time: '10:00 AM', status: 'CONFIRMED' },
  { client: 'Ethan Brooks', artist: 'Sam Kestrel', time: '11:30 AM', status: 'REQUESTED' },
  { client: 'Priya Anand', artist: 'Jordan Vega', time: '1:00 PM', status: 'CONFIRMED' },
  { client: 'Leo Marchetti', artist: 'Dana Cho', time: '3:00 PM', status: 'COMPLETED' },
  { client: 'Nina Foster', artist: 'Sam Kestrel', time: '4:30 PM', status: 'CANCELLED' },
]

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export default function TodaysAppointmentsTable() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">Today's Appointments</h2>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-surface-inset text-xs text-fg-muted">
              <th className="rounded-l-lg py-2 pl-3 font-medium">Client Name</th>
              <th className="py-2 font-medium">Artist</th>
              <th className="py-2 font-medium">Time</th>
              <th className="rounded-r-lg py-2 pr-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {APPOINTMENTS.map((appointment) => (
              <tr key={appointment.client}>
                <td className="py-3 pl-3 text-fg">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold text-fg">
                      {initials(appointment.client)}
                    </span>
                    {appointment.client}
                  </div>
                </td>
                <td className="py-3 text-fg-secondary">{appointment.artist}</td>
                <td className="py-3 text-fg-secondary">{appointment.time}</td>
                <td className="py-3 pr-3">
                  <StatusPill status={appointment.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

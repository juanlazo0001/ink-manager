const APPOINTMENTS = [
  { client: 'Maria Gonzalez', artist: 'Jordan Vega', time: '10:00 AM', status: 'Confirmed' },
  { client: 'Ethan Brooks', artist: 'Sam Kestrel', time: '11:30 AM', status: 'Requested' },
  { client: 'Priya Anand', artist: 'Jordan Vega', time: '1:00 PM', status: 'Confirmed' },
  { client: 'Leo Marchetti', artist: 'Dana Cho', time: '3:00 PM', status: 'Completed' },
  { client: 'Nina Foster', artist: 'Sam Kestrel', time: '4:30 PM', status: 'Cancelled' },
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
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-base font-semibold text-white">Today's Appointments</h2>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-neutral-500">
              <th className="pb-3 font-medium">Client Name</th>
              <th className="pb-3 font-medium">Artist</th>
              <th className="pb-3 font-medium">Time</th>
              <th className="pb-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {APPOINTMENTS.map((appointment) => (
              <tr key={appointment.client}>
                <td className="py-3 text-white">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-white">
                      {initials(appointment.client)}
                    </span>
                    {appointment.client}
                  </div>
                </td>
                <td className="py-3 text-neutral-400">{appointment.artist}</td>
                <td className="py-3 text-neutral-400">{appointment.time}</td>
                <td className="py-3">
                  <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                    {appointment.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

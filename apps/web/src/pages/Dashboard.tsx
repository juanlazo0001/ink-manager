import { useAuth } from '../context/useAuth'
import Sidebar from '../components/Sidebar'
import StatCard from '../components/StatCard'
import TodaysAppointmentsTable from '../components/TodaysAppointmentsTable'
import WeeklyAppointmentsChart from '../components/WeeklyAppointmentsChart'
import ArtistWorkloadCard from '../components/ArtistWorkloadCard'
import ReminderCard from '../components/ReminderCard'
import { AppointmentsIcon, BellIcon, CheckIcon, ClientsIcon, DocumentIcon, PlusIcon } from '../components/icons'

const STATS = [
  { icon: <ClientsIcon className="h-4 w-4" />, label: 'Total Clients', value: '128', delta: '+6 this month' },
  {
    icon: <AppointmentsIcon className="h-4 w-4" />,
    label: 'Appointments This Week',
    value: '23',
    delta: '+15% vs last week',
  },
  { icon: <DocumentIcon className="h-4 w-4" />, label: 'Pending Consent Forms', value: '4', delta: '-2 vs last week' },
  {
    icon: <CheckIcon className="h-4 w-4" />,
    label: 'Completed Appointments',
    value: '312',
    delta: '+18 this month',
  },
]

export default function Dashboard() {
  const { user } = useAuth()

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Welcome, {user?.role}</h1>
              <p className="mt-1 text-sm text-neutral-400">Here's what's happening at your studio today.</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
              >
                <PlusIcon className="h-4 w-4" />
                New Appointment
              </button>
              <button
                type="button"
                aria-label="Notifications"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-800 text-neutral-400 transition hover:text-white"
              >
                <BellIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {STATS.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <TodaysAppointmentsTable />
            </div>

            <div className="flex flex-col gap-6">
              <WeeklyAppointmentsChart />
              <ArtistWorkloadCard />
              <ReminderCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

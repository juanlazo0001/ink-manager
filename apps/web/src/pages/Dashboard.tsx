import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import Sidebar from '../components/Sidebar'
import DateRangePresetFilter, { presetRange, type DateRange } from '../components/DateRangePresetFilter'
import HorizontalBarList from '../components/HorizontalBarList'
import { SkeletonCards } from '../components/Skeleton'
import { apiFetch } from '../lib/api'
import { reportsDashboardQueryKey } from '../lib/queryKeys'
import { formatCents } from '../lib/money'
import { formatStatus } from '../lib/format'
import { ArtistsIcon, CheckIcon, ClockIcon, DocumentIcon, TagIcon } from '../components/icons'
import { useThemePreset } from '../lib/useThemePreset'

interface FunnelStage {
  stage: string
  label: string
  count: number
  conversionFromReceived: number | null
}

interface ReportsDashboard {
  range: { start: string; end: string }
  funnel: { stages: FunnelStage[] }
  lostRate: { lost: number; cold: number; converted: number; lostColdRate: number | null }
  responseTime: {
    avgHoursToEstimateSent: number | null
    avgHoursToResponse: number | null
    sampleSizeEstimateSent: number
    sampleSizeResponse: number
  }
  artistUtilization: { artistId: string; name: string; appointmentCount: number }[]
  depositConversion: { sent: number; paid: number; conversionRate: number | null; avgHoursToPayment: number | null }
  giftCardLiability: { activeCardCount: number; totalCents: number }
}

// Bucketed on the magnitude, sign kept separate -- a negative value (only
// possible from a paidAt earlier than createdAt, which real usage can
// never produce since mark-paid always stamps paidAt at call time; a few
// dev-seed fixtures backdate it directly) stays visibly negative rather
// than clamping to a small positive number that would misreport an
// impossibly-fast payment.
function formatHours(hours: number | null): string {
  if (hours == null) return '—'
  const sign = hours < 0 ? '-' : ''
  const abs = Math.abs(hours)
  if (abs < 1) return `${sign}${Math.round(abs * 60)}m`
  if (abs < 48) return `${sign}${abs < 10 ? abs.toFixed(1) : Math.round(abs)}h`
  return `${sign}${(abs / 24).toFixed(1)}d`
}

function formatPct(pct: number | null): string {
  return pct == null ? '—' : `${pct}%`
}

function CardShell({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  return (
    <div
      className={
        isEditorial
          ? 'card-surface relative rounded-card border border-border bg-gradient-to-b from-white/[0.012] to-transparent bg-surface p-6'
          : 'card-surface rounded-2xl border border-border bg-surface p-5'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className={isEditorial ? 'sc text-[20px]' : 'text-base font-semibold text-fg'}>{title}</h2>
        {caption && <span className="shrink-0 text-xs text-fg-muted">{caption}</span>}
      </div>
      <div className={isEditorial ? 'mt-5' : 'mt-4'}>{children}</div>
    </div>
  )
}

// Big stat figure -- shared className across every card below, so the
// original "4xl/3xl font-bold" size never has to be repeated per site.
function bigStatClass(isEditorial: boolean, size: 'lg' | 'xl') {
  if (!isEditorial) return size === 'xl' ? 'text-4xl font-bold text-fg' : 'text-3xl font-bold text-fg'
  return size === 'xl'
    ? 'font-display text-5xl font-normal tracking-[-0.015em] text-fg'
    : 'font-display text-4xl font-normal tracking-[-0.015em] text-fg'
}

export default function Dashboard() {
  const user = useEffectiveUser()
  const { profile } = useUserProfile()
  const [range, setRange] = useState<DateRange>(() => presetRange(30))
  const [activeDays, setActiveDays] = useState<number | null>(30)
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'

  const { data, isLoading, error } = useQuery({
    queryKey: reportsDashboardQueryKey(user!.studioId, range.start, range.end),
    queryFn: () =>
      apiFetch<ReportsDashboard>(
        `/reports/dashboard?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`,
      ),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1
                className={
                  isEditorial
                    ? 'font-display text-[clamp(32px,4vw,44px)] font-normal tracking-[-0.015em] text-fg'
                    : 'text-2xl font-bold text-fg sm:text-3xl'
                }
              >
                Welcome, {profile?.name?.trim().split(' ')[0] || (user ? formatStatus(user.role) : '')}
              </h1>
              {isEditorial ? (
                <p className="mt-2.5 inline-flex items-center gap-3 font-jura text-[11px] font-semibold tracking-[0.34em] text-fg-muted uppercase">
                  Here's how the studio is doing.
                  <span className="text-danger-strong text-[13px] tracking-normal" aria-hidden="true">
                    +
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-fg-secondary">Here's how the studio is doing.</p>
              )}
            </div>

            <DateRangePresetFilter
              value={range}
              activeDays={activeDays}
              onChange={(next, days) => {
                setRange(next)
                setActiveDays(days)
              }}
            />
          </div>

          {error && (
            <p className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error instanceof Error ? error.message : 'Failed to load dashboard data.'}
            </p>
          )}

          {isLoading && !data ? (
            <div className="mt-6">
              <SkeletonCards count={6} />
            </div>
          ) : data ? (
            <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <CardShell title="Inquiry Funnel" caption={`${range.start} – ${range.end}`}>
                <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
                  <DocumentIcon className="h-3.5 w-3.5" />
                  Conversion is shown as % of Received still in this stage today
                </div>
                <HorizontalBarList
                  data={data.funnel.stages.map((s) => ({
                    key: s.stage,
                    label: s.label,
                    value: s.count,
                    valueLabel: `${s.count} (${formatPct(s.conversionFromReceived)})`,
                  }))}
                />
              </CardShell>

              <CardShell title="Lost / Cold Rate" caption={`${range.start} – ${range.end}`}>
                {isEditorial && <span className="mb-3 block h-0.5 w-8 rounded-full bg-danger-strong" aria-hidden="true" />}
                <p className={bigStatClass(isEditorial, 'xl')}>{formatPct(data.lostRate.lostColdRate)}</p>
                <p className={isEditorial ? 'mt-2 text-[13.5px] text-fg-muted' : 'mt-1 text-xs text-fg-muted'}>
                  of inquiries that reached a terminal outcome ended lost or cold, rest converted
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-danger" /> {data.lostRate.lost} Closed Lost
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-warning" /> {data.lostRate.cold} Cold Lead
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-success" /> {data.lostRate.converted} Confirmed
                  </span>
                </div>
              </CardShell>

              <CardShell title="Response Time" caption={`${range.start} – ${range.end}`}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <ClockIcon className="h-3.5 w-3.5" /> Received → Estimate Sent
                    </div>
                    <p className={`mt-2 ${bigStatClass(isEditorial, 'lg')}`}>
                      {formatHours(data.responseTime.avgHoursToEstimateSent)}
                    </p>
                    <p className="mt-1 text-xs text-fg-muted">avg, n={data.responseTime.sampleSizeEstimateSent}</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <ClockIcon className="h-3.5 w-3.5" /> Estimate Sent → Response
                    </div>
                    <p className={`mt-2 ${bigStatClass(isEditorial, 'lg')}`}>
                      {formatHours(data.responseTime.avgHoursToResponse)}
                    </p>
                    <p className="mt-1 text-xs text-fg-muted">avg, n={data.responseTime.sampleSizeResponse}</p>
                  </div>
                </div>
              </CardShell>

              <CardShell title="Artist Utilization" caption={`${range.start} – ${range.end}`}>
                <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
                  <ArtistsIcon className="h-3.5 w-3.5" />
                  Appointments scheduled in this range
                </div>
                <HorizontalBarList
                  data={data.artistUtilization.map((a) => ({
                    key: a.artistId,
                    label: a.name,
                    value: a.appointmentCount,
                    valueLabel: String(a.appointmentCount),
                  }))}
                  emptyMessage="No appointments scheduled in this range."
                />
              </CardShell>

              <CardShell title="Deposit Conversion" caption="All-time, not affected by the date range above">
                <div className={isEditorial ? 'flex items-center gap-3' : 'flex items-center gap-2'}>
                  <CheckIcon className={isEditorial ? 'h-4 w-4 text-danger-strong' : 'h-4 w-4 text-fg-muted'} />
                  <p className={bigStatClass(isEditorial, 'xl')}>{formatPct(data.depositConversion.conversionRate)}</p>
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  {data.depositConversion.paid} of {data.depositConversion.sent} deposit forms sent have been paid
                </p>
                <p className="mt-3 text-sm text-fg-secondary">
                  Avg time to payment: <span className="font-medium text-fg">{formatHours(data.depositConversion.avgHoursToPayment)}</span>
                </p>
              </CardShell>

              <CardShell title="Outstanding Gift Card Liability" caption="Right now, not affected by the date range above">
                <div className={isEditorial ? 'flex items-center gap-3' : 'flex items-center gap-2'}>
                  <TagIcon className={isEditorial ? 'h-4 w-4 text-accent' : 'h-4 w-4 text-fg-muted'} />
                  <p className={bigStatClass(isEditorial, 'xl')}>{formatCents(data.giftCardLiability.totalCents)}</p>
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  across {data.giftCardLiability.activeCardCount} active, unredeemed gift card
                  {data.giftCardLiability.activeCardCount === 1 ? '' : 's'}
                </p>
              </CardShell>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatPriceEstimate, formatStatus } from '../lib/format'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { deriveProjectStage, PROJECT_STAGE_LABELS } from '../lib/kanban'
import { useEffectiveUser } from '../context/useEffectiveUser'
import StatusPill from '../components/StatusPill'
import { ArrowLeftIcon, DocumentIcon, GiftCardIcon } from '../components/icons'
import { AttachmentChip } from '../components/NotesSection'
import type { NoteAttachment } from '../lib/cloudinary'

interface Session {
  id: string
  startTime: string
  endTime: string
  status: string
  checkedOutAt: string | null
  liabilityWaiver: { status: string } | null
  photos: { id: string; url: string; uploadedAt: string }[]
}

interface DepositForm {
  id: string
  sessionNumber: number
  signedAt: string | null
  paidAt: string | null
  paidManually: boolean
}

interface Note {
  id: string
  bodyHtml: string
  attachments: NoteAttachment[] | null
  createdAt: string
  author: { id: string; name: string | null; email: string } | null
}

interface Project {
  id: string
  channel: string
  description: string
  colorOrBlackGrey: string
  placement: string
  estimatedSize: string
  hasBeenTattooedBefore: boolean
  budget: string | null
  desiredTiming: string | null
  referenceImages: string[]
  placementImages: string[]
  createdAt: string
  status: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
  projectCompletedAt: string | null
  client: { firstName: string; lastName: string }
  service: { id: string; name: string; pricingModel: 'RANGE' | 'FLAT' }
  appointment: { id: string; startTime: string; endTime: string; status: string } | null
  sessions: Session[]
  depositForms: DepositForm[]
  notes: Note[]
}

function ImageGrid({ images }: { images: string[] }) {
  if (images.length === 0) {
    return <p className="text-sm text-fg-secondary">None uploaded.</p>
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {images.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block aspect-square overflow-hidden rounded-lg border border-border"
        >
          <img src={url} alt="" className="h-full w-full object-cover transition hover:opacity-80" />
        </a>
      ))}
    </div>
  )
}

// Deposit/financial specifics (amounts, payment method, gift card codes,
// signature image) never reach this page at all -- ARTIST_INQUIRY_SELECT
// (routes/inquiries.ts) already strips them server-side. This only ever
// renders the signed/paid status that IS included.
function DepositStatusRow({ form }: { form: DepositForm }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="font-medium text-fg">Session {form.sessionNumber}</span>
      <span className="flex items-center gap-3 text-fg-secondary">
        <span className={form.signedAt ? 'text-fg' : 'text-fg-muted'}>
          {form.signedAt ? `Signed ${formatDateTime(form.signedAt)}` : 'Not signed yet'}
        </span>
        <span className={form.paidAt ? 'text-fg' : 'text-fg-muted'}>{form.paidAt ? 'Paid' : 'Not paid yet'}</span>
      </span>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl card-surface border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  )
}

export default function MyProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const user = useEffectiveUser()

  // Artist mobility: a solo studio's owner is role OWNER with their own
  // attached Artist profile (soloStudio.ts), not role ARTIST -- this page
  // is also where their guest-studio project cards (Inquiries.tsx's
  // fromGuestStudio blend) link to for detail, so OWNER needs to reach it
  // too. GET /inquiries/assigned-to-me/:id already 404s cleanly for an
  // OWNER with no Artist row, same as it always has for a role-ARTIST
  // caller with none.
  const canViewOwnAssignments = user?.role === 'ARTIST' || user?.role === 'OWNER'

  const {
    data: project,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['assigned-project', id],
    queryFn: () => apiFetch<Project>(`/inquiries/assigned-to-me/${id}`),
    enabled: !!id && canViewOwnAssignments,
  })

  if (user && !canViewOwnAssignments) {
    return <Navigate to="/dashboard" replace />
  }

  const projectStage = project ? deriveProjectStage(project) : null
  const estimateRange = project ? formatPriceEstimate(project.priceEstimateLow, project.priceEstimateHigh) : null
  const timeRange =
    project && project.timeEstimateHoursMin != null && project.timeEstimateHoursMax != null
      ? project.timeEstimateHoursMin === project.timeEstimateHoursMax
        ? `${project.timeEstimateHoursMin}h`
        : `${project.timeEstimateHoursMin}–${project.timeEstimateHoursMax}h`
      : null

  // MyInquiries.tsx (role ARTIST's own "My Inquiries" board) redirects any
  // other role straight to /dashboard -- an OWNER landing here from a
  // guest-studio project card (Inquiries.tsx) needs to go back to their
  // real Inquiries & Projects page instead, or "back" would just bounce
  // them again.
  const backTo = user?.role === 'OWNER' ? '/inquiries' : '/my-inquiries'
  const backLabel = user?.role === 'OWNER' ? 'Back to Inquiries & Projects' : 'Back to My Inquiries'

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 sm:px-10 sm:py-8">
      <Link to={backTo} className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg">
        <ArrowLeftIcon className="h-4 w-4" />
        {backLabel}
      </Link>

      {error && (
        <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
          <p className="text-sm text-danger">
            {error instanceof ApiError && error.status === 404
              ? "This project isn't assigned to you."
              : error instanceof Error
                ? error.message
                : 'Failed to load project'}
          </p>
        </div>
      )}

      {!error && isLoading && <p className="mt-6 text-sm text-fg-secondary">Loading project…</p>}

      {!error && project && (
        <div className="mt-6 space-y-5">
          <div className="rounded-2xl card-surface border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-fg">
                  {project.client.firstName} {project.client.lastName}
                </h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  Submitted {formatDateTime(project.createdAt)} via {formatStatus(project.channel)}
                </p>
              </div>
              <StatusPill
                status={projectStage ?? project.status}
                label={projectStage ? PROJECT_STAGE_LABELS[projectStage] : undefined}
              />
            </div>
          </div>

          <Card title="Project details">
            <p className="whitespace-pre-wrap text-sm text-fg">{project.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Placement</p>
                <p className="mt-1 text-sm text-fg">{project.placement}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Size</p>
                <p className="mt-1 text-sm text-fg">{project.estimatedSize}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Color</p>
                <p className="mt-1 text-sm text-fg">{project.colorOrBlackGrey}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Budget</p>
                <p className="mt-1 text-sm text-fg">{project.budget ?? 'Not provided'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Service</p>
                <p className="mt-1 text-sm text-fg">{project.service.name}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Timing</p>
                <p className="mt-1 text-sm text-fg">{project.desiredTiming ?? 'Not specified'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Tattooed before</p>
                <p className="mt-1 text-sm text-fg">{project.hasBeenTattooedBefore ? 'Yes' : 'No'}</p>
              </div>
              {(estimateRange || timeRange) && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Estimate</p>
                  <p className="mt-1 text-sm text-fg">
                    {estimateRange ?? '—'}
                    {timeRange ? ` · ${timeRange}` : ''}
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card title="Reference images">
            <ImageGrid images={project.referenceImages} />
          </Card>

          <Card title="Placement photos">
            <ImageGrid images={project.placementImages} />
          </Card>

          <Card title={`Sessions (${project.sessions.length})`}>
            {project.sessions.length === 0 ? (
              <p className="text-sm text-fg-secondary">No sessions scheduled yet.</p>
            ) : (
              <div className="space-y-4">
                {project.sessions.map((session, index) => (
                  <div key={session.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-fg">
                        Session {index + 1} — {formatDateTime(session.startTime)}
                      </p>
                      <StatusPill status={session.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-fg-muted">
                      <span>{session.checkedOutAt ? `Checked out ${formatDateTime(session.checkedOutAt)}` : 'Not checked out yet'}</span>
                      {session.liabilityWaiver && <span>Waiver: {formatStatus(session.liabilityWaiver.status)}</span>}
                    </div>
                    {session.photos.length > 0 && (
                      <div className="mt-3">
                        <ImageGrid images={session.photos.map((p) => p.url)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Deposit status">
            <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
              <GiftCardIcon className="h-3.5 w-3.5" />
              Signed/paid status only -- amounts and payment details are managed by the studio.
            </div>
            {project.depositForms.length === 0 ? (
              <p className="text-sm text-fg-secondary">No deposit forms yet.</p>
            ) : (
              <div className="space-y-2">
                {project.depositForms.map((form) => (
                  <DepositStatusRow key={form.id} form={form} />
                ))}
              </div>
            )}
          </Card>

          <Card title="Notes">
            <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
              <DocumentIcon className="h-3.5 w-3.5" />
              Only notes staff has chosen to share with you appear here.
            </div>
            {project.notes.length === 0 ? (
              <p className="text-sm text-fg-secondary">No notes shared with you yet.</p>
            ) : (
              <ul className="space-y-4">
                {project.notes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-fg">
                        {note.author ? note.author.name || note.author.email : 'Deleted user'}
                      </span>
                      <span className="text-xs text-fg-muted">{formatDateTime(note.createdAt)}</span>
                    </div>
                    <div
                      className="tiptap-content mt-2 text-sm text-fg"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.bodyHtml) }}
                    />
                    {note.attachments && note.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {note.attachments.map((attachment) => (
                          <AttachmentChip key={attachment.url} attachment={attachment} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

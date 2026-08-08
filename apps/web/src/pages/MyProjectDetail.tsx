import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch, ApiError, downloadFile } from '../lib/api'
import { formatDateTime, formatPriceEstimate, formatStatus } from '../lib/format'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { deriveProjectStage, PROJECT_STAGE_LABELS } from '../lib/kanban'
import { useEffectiveUser } from '../context/useEffectiveUser'
import StatusPill from '../components/StatusPill'
import { ArrowLeftIcon, DocumentIcon, DownloadIcon, GiftCardIcon } from '../components/icons'
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
  // Phase 5: absent (not null) when "Pricing & financial detail" is
  // hidden -- already safe at its one call site (`??` treats undefined
  // and null identically), typed optional here just for accuracy.
  budget?: string | null
  desiredTiming: string | null
  referenceImages: string[]
  placementImages: string[]
  createdAt: string
  status: string
  // Phase 5: absent entirely (not null) when the studio has switched off
  // "Pricing & financial detail" for artists at this project's own studio
  // -- see lib/artistFieldVisibility.ts (API). Optional here, not
  // `| null`, to match that real "key missing" shape rather than a value
  // that was fetched and found empty.
  priceEstimateLow?: number | null
  priceEstimateHigh?: number | null
  timeEstimateHoursMin?: number | null
  timeEstimateHoursMax?: number | null
  projectCompletedAt: string | null
  client: { firstName: string; lastName: string }
  service: { id: string; name: string; pricingModel: 'RANGE' | 'FLAT' }
  appointment: { id: string; startTime: string; endTime: string; status: string } | null
  sessions: Session[]
  // Phase 5: same "absent, not empty" shape as the price/time estimate
  // fields above -- depositForms hidden by "Pricing & financial detail",
  // notes hidden by its own separate "Internal notes" toggle.
  depositForms?: DepositForm[]
  notes?: Note[]
  // Artist mobility: set only when this project belongs to a studio where
  // the viewer is an active GUEST rather than their own home studio -- see
  // Inquiries.tsx's own fromGuestStudio comment for the fuller context.
  fromGuestStudio: { id: string; name: string } | null
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
// renders the signed/paid status that IS included. The PDF download below
// still works though: GET /deposit-forms/:id/pdf isn't behind a health-data
// floor like waivers are (see deposits.ts's own comment) -- it's scoped to
// the artist's own assigned project the same way this whole page is, so an
// artist can pull the full branded PDF for their own client even though the
// on-page summary above deliberately stays reduced.
function DepositStatusRow({
  form,
  onDownload,
  downloading,
}: {
  form: DepositForm
  onDownload: (id: string, filename: string) => void
  downloading: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="font-medium text-fg">Session {form.sessionNumber}</span>
      <span className="flex items-center gap-3 text-fg-secondary">
        <span className={form.signedAt ? 'text-fg' : 'text-fg-muted'}>
          {form.signedAt ? `Signed ${formatDateTime(form.signedAt)}` : 'Not signed yet'}
        </span>
        <span className={form.paidAt ? 'text-fg' : 'text-fg-muted'}>{form.paidAt ? 'Paid' : 'Not paid yet'}</span>
        {form.signedAt && (
          <button
            type="button"
            onClick={() => onDownload(form.id, `deposit-form-session-${form.sessionNumber}.pdf`)}
            disabled={downloading}
            aria-label="Download PDF"
            title="Download PDF"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
          </button>
        )}
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

  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null)
  const [pdfDownloadError, setPdfDownloadError] = useState<string | null>(null)

  async function handleDownloadDepositPdf(depositFormId: string, filename: string) {
    setDownloadingPdfId(depositFormId)
    setPdfDownloadError(null)
    try {
      await downloadFile(`/deposit-forms/${depositFormId}/pdf`, filename)
    } catch (err) {
      setPdfDownloadError(err instanceof ApiError ? err.message : 'Failed to download PDF')
    } finally {
      setDownloadingPdfId(null)
    }
  }

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
  const estimateRange = project
    ? formatPriceEstimate(project.priceEstimateLow ?? null, project.priceEstimateHigh ?? null)
    : null
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
                {project.fromGuestStudio && (
                  // Same accent-tinted pill as Inquiries.tsx's own
                  // fromGuestStudio badge (List row + Kanban card) -- one
                  // consistent "you're a guest here" tag wherever this
                  // project shows up.
                  <span className="mt-2 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                    {project.fromGuestStudio.name}
                  </span>
                )}
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
              {/* Phase 5: absent entirely (not just null) when "Pricing &
                  financial detail" is hidden -- omitted outright rather
                  than showing "Not provided," which would misleadingly
                  imply the client never gave one. */}
              {project.budget !== undefined && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Budget</p>
                  <p className="mt-1 text-sm text-fg">{project.budget ?? 'Not provided'}</p>
                </div>
              )}
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

          {/* Phase 5: absent entirely (not an empty array) when this
              project's own studio has "Pricing & financial detail" switched
              off for artists -- the whole card disappears rather than
              showing an empty/misleading "No deposit forms yet." */}
          {project.depositForms !== undefined && (
            <Card title="Deposit status">
              <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted">
                <GiftCardIcon className="h-3.5 w-3.5" />
                Signed/paid status only -- amounts and payment details are managed by the studio.
              </div>
              {pdfDownloadError && <p className="mb-3 text-sm text-danger">{pdfDownloadError}</p>}
              {project.depositForms.length === 0 ? (
                <p className="text-sm text-fg-secondary">No deposit forms yet.</p>
              ) : (
                <div className="space-y-2">
                  {project.depositForms.map((form) => (
                    <DepositStatusRow
                      key={form.id}
                      form={form}
                      onDownload={handleDownloadDepositPdf}
                      downloading={downloadingPdfId === form.id}
                    />
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Phase 5: same "absent means hide the card" treatment, gated by
              the separate "Internal notes" toggle. */}
          {project.notes !== undefined && (
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
          )}
        </div>
      )}
    </div>
  )
}

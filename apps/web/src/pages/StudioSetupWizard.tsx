import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch } from '../lib/api'
import { dollarsToCents } from '../lib/money'
import { readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'
import RichTextEditor from '../components/RichTextEditor'
import { crossfadeVariants, uiSpringTransition } from '../lib/motion'

interface StudioFull {
  id: string
  name: string
  website: string | null
  logoUrl: string | null
}

interface DepositTier {
  minAmountCents: number
  maxAmountCents: number | null
  depositAmountCents: number
}

interface StudioSettingsFull {
  depositTiers: DepositTier[]
  depositPolicy: string | null
  reschedulePolicy: string | null
  schedulingBufferMinutes: number
  depositFeeCents: number
  reminderWeekBeforeDays: number
  reminderNightBeforeDays: number
}

interface IntegrationInfo {
  channel: string
  status: string
  metadata: { chargesEnabled?: boolean } | null
}

interface DepositTierDraft {
  minDollars: string
  maxDollars: string
  depositDollars: string
}

const centsToDollarsInput = (cents: number) => (cents / 100).toString()

const ALL_STEPS = ['basics', 'policies', 'defaults', 'payments', 'team', 'done'] as const
type Step = (typeof ALL_STEPS)[number]

type InviteRole = 'FRONT_DESK' | 'ARTIST'

// Full-screen, first-run wizard, same architecture and contract as
// ArtistWelcomeWizard.tsx (see that file's own comment): eligibility
// (Studio.setupCompletedAt null, OWNER only) and the redirect into this
// page both live in ProtectedRoute, checked BEFORE the artist wizard's own
// so a solo OWNER+Artist account always lands here first -- this wizard's
// own Done step is what then hands off into /welcome, not redirect-check
// order. Every step is optional and saves immediately on Continue via the
// SAME routes Settings.tsx's own editors already use (PATCH
// /studios/:studioId, PATCH /studio-settings, POST /studios/:studioId/invites,
// POST /integrations/stripe/connect) -- no parallel wizard-only mutation
// path. "Invite your team" is hidden entirely for a solo signup (detected
// via profile.artist -- only a SOLO persona signup ever attaches one to
// the OWNER, see lib/studioCreation.ts).
export default function StudioSetupWizard() {
  const { profile, refresh } = useUserProfile()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const studioId = profile?.studioId
  const isSolo = !!profile?.artist

  const steps = useMemo(() => (isSolo ? ALL_STEPS.filter((s) => s !== 'team') : ALL_STEPS), [isSolo])

  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex]

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Basics
  const [studioName, setStudioName] = useState('')
  const [website, setWebsite] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  // Policies
  const [depositTiersDraft, setDepositTiersDraft] = useState<DepositTierDraft[]>([])
  const [depositPolicy, setDepositPolicy] = useState('')
  const [reschedulePolicy, setReschedulePolicy] = useState('')

  // Defaults
  const [schedulingBufferMinutes, setSchedulingBufferMinutes] = useState('')
  const [depositFeeDollars, setDepositFeeDollars] = useState('')
  const [weekBeforeDays, setWeekBeforeDays] = useState('7')
  const [nightBeforeDays, setNightBeforeDays] = useState('1')

  // Payments
  const [stripeIntegration, setStripeIntegration] = useState<IntegrationInfo | null>(null)
  const [connectingStripe, setConnectingStripe] = useState(false)

  // Team
  const [inviteRole, setInviteRole] = useState<InviteRole>('FRONT_DESK')
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteSent, setInviteSent] = useState(false)

  useEffect(() => {
    if (!studioId) return
    let ignore = false

    Promise.all([
      apiFetch<StudioFull>(`/studios/${studioId}`),
      apiFetch<StudioSettingsFull>('/studio-settings'),
      apiFetch<{ channels: IntegrationInfo[] }>('/integrations'),
    ])
      .then(([studio, settings, integrationsRes]) => {
        if (ignore) return
        setStudioName(studio.name)
        setWebsite(studio.website ?? '')
        setLogoUrl(studio.logoUrl)
        setDepositTiersDraft(
          settings.depositTiers.map((tier) => ({
            minDollars: centsToDollarsInput(tier.minAmountCents),
            maxDollars: tier.maxAmountCents === null ? '' : centsToDollarsInput(tier.maxAmountCents),
            depositDollars: centsToDollarsInput(tier.depositAmountCents),
          })),
        )
        setDepositPolicy(settings.depositPolicy ?? '')
        setReschedulePolicy(settings.reschedulePolicy ?? '')
        setSchedulingBufferMinutes(String(settings.schedulingBufferMinutes))
        setDepositFeeDollars(centsToDollarsInput(settings.depositFeeCents))
        setWeekBeforeDays(String(settings.reminderWeekBeforeDays))
        setNightBeforeDays(String(settings.reminderNightBeforeDays))
        setStripeIntegration(integrationsRes.channels.find((c) => c.channel === 'STRIPE') ?? null)
        setLoaded(true)
      })
      .catch(() => {
        if (!ignore) setLoaded(true)
      })

    return () => {
      ignore = true
    }
  }, [studioId])

  // Stripe's return_url/refresh_url (see routes/integrations.ts's own
  // comment on the `from: "wizard"` branch) lands back here with
  // ?stripe=return|refresh -- re-syncs live status same as Settings.tsx's
  // identical effect, then jumps straight to the Payments step so
  // "returning from Stripe re-enters the wizard at this step" holds even
  // on a fresh page load (a full browser redirect, not an in-app
  // navigation -- component state from before leaving is gone either way).
  useEffect(() => {
    const stripeReturn = searchParams.get('stripe')
    if (!stripeReturn || !loaded) return

    apiFetch('/integrations/stripe/refresh-status', { method: 'POST' })
      .catch(() => {
        // Same as Settings.tsx -- the integration list refetch below is
        // the real source of truth either way.
      })
      .finally(() => {
        apiFetch<{ channels: IntegrationInfo[] }>('/integrations').then((res) => {
          setStripeIntegration(res.channels.find((c) => c.channel === 'STRIPE') ?? null)
        })
        const paymentsIndex = steps.indexOf('payments')
        if (paymentsIndex !== -1) setStepIndex(paymentsIndex)
        setSearchParams((params) => {
          params.delete('stripe')
          return params
        }, { replace: true })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  function addDepositTier() {
    setDepositTiersDraft((prev) => [...prev, { minDollars: '', maxDollars: '', depositDollars: '' }])
  }
  function removeDepositTier(index: number) {
    setDepositTiersDraft((prev) => prev.filter((_, i) => i !== index))
  }
  function updateDepositTier(index: number, patch: Partial<DepositTierDraft>) {
    setDepositTiersDraft((prev) => prev.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)))
  }

  async function saveStep(currentStep: Step) {
    if (!studioId) return
    switch (currentStep) {
      case 'basics': {
        const data: Record<string, unknown> = {}
        if (studioName.trim()) data.name = studioName.trim()
        data.website = website.trim() || null
        data.logoUrl = logoUrl
        await apiFetch(`/studios/${studioId}`, { method: 'PATCH', body: JSON.stringify(data) })
        return
      }
      case 'policies': {
        const payload = depositTiersDraft
          .filter((t) => t.minDollars.trim() !== '' && t.depositDollars.trim() !== '')
          .map((tier) => ({
            minAmountCents: Math.round(Number(tier.minDollars) * 100),
            maxAmountCents: tier.maxDollars.trim() === '' ? null : Math.round(Number(tier.maxDollars) * 100),
            depositAmountCents: Math.round(Number(tier.depositDollars) * 100),
          }))
        await apiFetch('/studio-settings', {
          method: 'PATCH',
          body: JSON.stringify({
            ...(payload.length > 0 ? { depositTiers: payload } : {}),
            depositPolicy,
            reschedulePolicy,
          }),
        })
        return
      }
      case 'defaults': {
        await apiFetch('/studio-settings', {
          method: 'PATCH',
          body: JSON.stringify({
            schedulingBufferMinutes: Number(schedulingBufferMinutes) || 0,
            depositFeeCents: dollarsToCents(Number(depositFeeDollars) || 0),
            reminderWeekBeforeDays: Number(weekBeforeDays) || 7,
            reminderNightBeforeDays: Number(nightBeforeDays) || 1,
          }),
        })
        return
      }
      default:
        return
    }
  }

  async function handleContinue() {
    setError(null)
    setSaving(true)
    try {
      await saveStep(step)
      setStepIndex((i) => Math.min(i + 1, steps.length - 1))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save -- try again.')
    } finally {
      setSaving(false)
    }
  }

  async function finishWizard(includeCurrentStepFields: boolean) {
    if (!studioId) return
    setError(null)
    setSaving(true)
    try {
      if (includeCurrentStepFields) await saveStep(step)
      await apiFetch(`/studios/${studioId}`, { method: 'PATCH', body: JSON.stringify({ setupCompletedAt: true }) })
      await refresh()
      // Solo signup: one continuous onboarding, not two separate apps --
      // hands off straight into the artist profile wizard (they qualify
      // via their own null profileSetupCompletedAt, same as any other
      // fresh artist) rather than /dashboard.
      navigate(isSolo ? '/welcome' : '/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup -- try again.')
      setSaving(false)
    }
  }

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setError('Logo image must be under 5MB.')
      return
    }
    try {
      setLogoUrl(await readFileAsDataUrl(file))
    } catch {
      setError('Could not read that image. Please try a different file.')
    }
  }

  async function handleConnectStripe() {
    setConnectingStripe(true)
    setError(null)
    try {
      const { url } = await apiFetch<{ url: string }>('/integrations/stripe/connect', {
        method: 'POST',
        body: JSON.stringify({ from: 'wizard' }),
      })
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start connecting Stripe')
      setConnectingStripe(false)
    }
  }

  async function handleSendInvite() {
    if (!studioId) return
    setError(null)
    setSaving(true)
    try {
      await apiFetch(`/studios/${studioId}/invites`, {
        method: 'POST',
        body: JSON.stringify({
          role: inviteRole,
          email: inviteEmail.trim(),
          name: inviteName.trim() || undefined,
          ...(inviteRole === 'ARTIST' ? { membershipType: 'HOME' } : { phone: invitePhone.trim() || undefined }),
        }),
      })
      setInviteSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setSaving(false)
    }
  }

  const stripeConnected = stripeIntegration?.status === 'CONNECTED'
  const stripeLive = stripeConnected && Boolean(stripeIntegration?.metadata?.chargesEnabled)

  if (!profile || !loaded) {
    return <div className="min-h-screen bg-bg" />
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-12">
      <div className="relative z-10 w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-1.5">
          {steps.map((s, i) => (
            <div
              key={s}
              className={[
                'h-1.5 rounded-full transition-all',
                i === stepIndex ? 'w-8 bg-accent' : i < stepIndex ? 'w-1.5 bg-accent/60' : 'w-1.5 bg-border',
              ].join(' ')}
            />
          ))}
        </div>

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={step}
            variants={crossfadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={uiSpringTransition}
            className="rounded-2xl card-surface border border-border bg-surface p-8"
          >
            {step === 'basics' && (
              <div>
                <h1 className="text-xl font-bold text-fg">Let's set up your studio.</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  Every step here is optional -- fill in what you'd like, skip the rest for now.
                </p>

                <div className="mt-6">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Studio name</label>
                  <input
                    type="text"
                    value={studioName}
                    onChange={(e) => setStudioName(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Website</label>
                  <input
                    type="text"
                    placeholder="https://yourstudio.com"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mt-4">
                  <span className="mb-1 block text-sm font-medium text-fg-secondary">Logo</span>
                  <div className="mt-2 flex items-center gap-4">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Studio logo preview" className="h-14 w-auto rounded-lg" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border text-xs text-fg-muted">
                        No logo
                      </div>
                    )}
                    <label className="cursor-pointer rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface">
                      {logoUrl ? 'Change logo' : 'Upload logo'}
                      <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                    </label>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl(null)}
                        className="text-sm font-medium text-fg-secondary transition hover:text-fg"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {!isSolo && (
                  <p className="mt-4 text-xs text-fg-muted">
                    You can add your shop location(s), hours, and contact info anytime from Settings → General.
                  </p>
                )}
              </div>
            )}

            {step === 'policies' && (
              <div>
                <h1 className="text-xl font-bold text-fg">Deposit tiers & policies</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  The deposit amount charged depends on which tier the average price estimate falls into.
                </p>

                <div className="mt-6 space-y-3">
                  {depositTiersDraft.map((tier, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Min ($)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tier.minDollars}
                          onChange={(e) => updateDepositTier(i, { minDollars: e.target.value })}
                          className="w-24 rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Max ($, blank = above)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tier.maxDollars}
                          onChange={(e) => updateDepositTier(i, { maxDollars: e.target.value })}
                          placeholder="and above"
                          className="w-32 rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Deposit ($)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tier.depositDollars}
                          onChange={(e) => updateDepositTier(i, { depositDollars: e.target.value })}
                          className="w-24 rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDepositTier(i)}
                        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addDepositTier}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                  >
                    + Add tier
                  </button>
                </div>

                <div className="mt-6">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Deposit policy</label>
                  <div className="h-32 overflow-y-auto rounded-lg border border-border">
                    <RichTextEditor value={depositPolicy} onChange={setDepositPolicy} />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Reschedule policy</label>
                  <div className="h-32 overflow-y-auto rounded-lg border border-border">
                    <RichTextEditor value={reschedulePolicy} onChange={setReschedulePolicy} />
                  </div>
                </div>

                <p className="mt-3 text-xs text-fg-muted">
                  The rest of your policy documents (refund, cancellation, waivers, terms) can be filled in anytime
                  from Settings → Policies & Templates.
                </p>
              </div>
            )}

            {step === 'defaults' && (
              <div>
                <h1 className="text-xl font-bold text-fg">Defaults</h1>
                <p className="mt-1 text-sm text-fg-secondary">Scheduling buffer, deposit fee, and reminder cadence.</p>

                <div className="mt-6">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Scheduling buffer (minutes)</label>
                  <p className="mb-1 text-xs text-fg-muted">
                    Appointments within this window of each other are flagged as a possible conflict.
                  </p>
                  <input
                    type="number"
                    min="0"
                    value={schedulingBufferMinutes}
                    onChange={(e) => setSchedulingBufferMinutes(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Deposit processing fee ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositFeeDollars}
                    onChange={(e) => setDepositFeeDollars(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">"1 week before" is actually</label>
                    <input
                      type="number"
                      min="1"
                      value={weekBeforeDays}
                      onChange={(e) => setWeekBeforeDays(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">"Night before" is actually</label>
                    <input
                      type="number"
                      min="1"
                      value={nightBeforeDays}
                      onChange={(e) => setNightBeforeDays(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-fg-muted">Days before the appointment, not literal calendar weeks.</p>
              </div>
            )}

            {step === 'payments' && (
              <div className="text-center">
                <h1 className="text-xl font-bold text-fg">Payments</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  Connect Stripe to take real deposits and payments. Fully optional -- you can always do this later
                  from Settings → Integrations.
                </p>

                <div className="mt-6">
                  {stripeLive ? (
                    <span className="inline-flex rounded-full bg-success/15 px-4 py-2 text-sm font-medium text-success">
                      Payments are live
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectStripe}
                      disabled={connectingStripe}
                      className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {connectingStripe
                        ? 'Redirecting…'
                        : stripeConnected
                          ? 'Finish setup'
                          : 'Connect with Stripe'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {step === 'team' && (
              <div>
                <h1 className="text-xl font-bold text-fg">Invite your team</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  You can invite more people anytime from Team -- this is just a head start.
                </p>

                {inviteSent ? (
                  <p className="mt-6 text-sm text-fg-secondary">
                    Invite sent to <span className="font-medium text-fg">{inviteEmail}</span>.
                  </p>
                ) : (
                  <>
                    <div className="mt-6 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setInviteRole('FRONT_DESK')}
                        className={[
                          'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition',
                          inviteRole === 'FRONT_DESK'
                            ? 'border-accent bg-accent/10 text-fg'
                            : 'border-border text-fg-secondary hover:bg-surface-inset',
                        ].join(' ')}
                      >
                        Front desk / staff
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviteRole('ARTIST')}
                        className={[
                          'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition',
                          inviteRole === 'ARTIST'
                            ? 'border-accent bg-accent/10 text-fg'
                            : 'border-border text-fg-secondary hover:bg-surface-inset',
                        ].join(' ')}
                      >
                        Artist
                      </button>
                    </div>

                    <div className="mt-4">
                      <input
                        type="text"
                        placeholder="Name"
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        className="mb-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="mb-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      {inviteRole === 'FRONT_DESK' && (
                        <input
                          type="tel"
                          placeholder="Phone (optional)"
                          value={invitePhone}
                          onChange={(e) => setInvitePhone(e.target.value)}
                          className="mb-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      )}
                      <button
                        type="button"
                        onClick={handleSendInvite}
                        disabled={saving || !inviteEmail.trim()}
                        className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {saving ? 'Sending…' : 'Send invite'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {step === 'done' && (
              <div className="text-center">
                <h1 className="text-xl font-bold text-fg">You're all set.</h1>
                <p className="mt-1 text-sm text-fg-secondary">
                  {isSolo
                    ? "Your studio is ready. Next, let's set up your own artist profile."
                    : 'Your studio is ready. You can always come back and update any of this from Settings.'}
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {error && <p className="mt-4 text-center text-sm text-danger">{error}</p>}

        {step !== 'done' ? (
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => finishWizard(true)}
              disabled={saving}
              className="text-sm font-medium text-fg-secondary transition hover:text-fg disabled:opacity-60"
            >
              I'll do this later
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={saving}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Continue'}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => finishWizard(false)}
              disabled={saving}
              className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? 'Finishing…' : isSolo ? "Set up my artist profile" : 'Go to my dashboard'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

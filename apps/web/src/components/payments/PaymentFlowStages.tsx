import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { crossfadeVariants, uiSpringTransition } from '../../lib/motion'
import PaymentAmountStage from './PaymentAmountStage'
import PaymentTipStage from './PaymentTipStage'
import PaymentMethodStage from './PaymentMethodStage'
import PaymentConfirmationStage from './PaymentConfirmationStage'

export interface PaymentIdentity {
  artistName: string | null
  artistAvatarUrl: string | null
  studioName: string
}

export interface PaymentBreakdownItem {
  label: string
  valueCents: number
}

export interface PaymentMethodSecret {
  clientSecret: string
  connectedAccountId: string
}

export interface PaymentTipConfig {
  // The tip-percentage basis (the session subtotal, i.e. finalCostCents --
  // NOT amountDueCents, which is what's actually charged today after
  // gift-card redemption).
  subtotalCents: number
  // What's being charged today before any tip -- the tip step's live total
  // line is baseTotalCents + the selected tip.
  baseTotalCents: number
  onConfirm: (tipCents: number) => Promise<PaymentMethodSecret>
}

interface PaymentFlowStagesProps {
  identity: PaymentIdentity
  headlineAmountCents: number
  breakdown: PaymentBreakdownItem[]
  // Omitted for deposit/flash (no tip step, straight to payment method);
  // present for session checkout only.
  tip?: PaymentTipConfig
  // Required when `tip` is omitted -- the already-fetched (or in-flight)
  // PaymentIntent secret. Ignored once `tip` resolves its own secret.
  payment: PaymentMethodSecret | null
  paymentLoadError?: string | null
  returnUrl: string
  paymentMethodOrder?: string[]
  successHeading: string
  successBody: string
  onPaid: () => void
}

type Stage = 'amount' | 'tip' | 'method' | 'confirmation'

// Shared staged sequence (amount/identity -> tip [session checkout only] ->
// payment method -> confirmation) reused by deposit, flash prepayment, and
// session checkout -- the three flows only differ in what data they supply,
// not in the stage shape itself. No backdrop-filter on the crossfade
// (plain opacity/y via the existing crossfadeVariants), per CLAUDE.md's
// backdrop-filter+animation rule.
export default function PaymentFlowStages({
  identity,
  headlineAmountCents,
  breakdown,
  tip,
  payment,
  paymentLoadError,
  returnUrl,
  paymentMethodOrder,
  successHeading,
  successBody,
  onPaid,
}: PaymentFlowStagesProps) {
  const [stage, setStage] = useState<Stage>('amount')
  const [resolvedPayment, setResolvedPayment] = useState<PaymentMethodSecret | null>(payment)
  const [paidAmountCents, setPaidAmountCents] = useState(headlineAmountCents)

  function handleAmountContinue() {
    setStage(tip ? 'tip' : 'method')
  }

  async function handleTipContinue(tipCents: number) {
    if (!tip) return
    const secret = await tip.onConfirm(tipCents)
    setResolvedPayment(secret)
    setPaidAmountCents(tip.baseTotalCents + tipCents)
    setStage('method')
  }

  function handlePaid() {
    setStage('confirmation')
    onPaid()
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stage}
        variants={crossfadeVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={uiSpringTransition}
      >
        {stage === 'amount' && (
          <PaymentAmountStage
            identity={identity}
            headlineAmountCents={headlineAmountCents}
            breakdown={breakdown}
            onContinue={handleAmountContinue}
          />
        )}

        {stage === 'tip' && tip && (
          <PaymentTipStage
            subtotalCents={tip.subtotalCents}
            baseTotalCents={tip.baseTotalCents}
            onContinue={handleTipContinue}
            onBack={() => setStage('amount')}
          />
        )}

        {stage === 'method' && (
          <div>
            {paymentLoadError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {paymentLoadError}
              </div>
            )}
            {resolvedPayment ? (
              <PaymentMethodStage
                clientSecret={resolvedPayment.clientSecret}
                connectedAccountId={resolvedPayment.connectedAccountId}
                amountCents={paidAmountCents}
                returnUrl={returnUrl}
                paymentMethodOrder={paymentMethodOrder}
                onPaid={handlePaid}
              />
            ) : (
              !paymentLoadError && <p className="text-center text-sm text-fg-secondary">Loading payment form…</p>
            )}
          </div>
        )}

        {stage === 'confirmation' && (
          <PaymentConfirmationStage
            identity={identity}
            amountCents={paidAmountCents}
            heading={successHeading}
            body={successBody}
          />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

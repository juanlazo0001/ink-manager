import { formatCents } from '../../lib/money'
import { FlatArtistAvatar } from '../ArtistAvatar'
import PaymentBreakdownDisclosure from './PaymentBreakdownDisclosure'
import type { PaymentBreakdownItem, PaymentIdentity } from './PaymentFlowStages'

// Stage 1: large dominant amount, artist/studio identity, and a collapsed
// breakdown row -- the amount and who-this-is-for are the only two things
// that need to be immediately legible; everything else is progressive
// disclosure.
export default function PaymentAmountStage({
  identity,
  headlineAmountCents,
  breakdown,
  onContinue,
}: {
  identity: PaymentIdentity
  headlineAmountCents: number
  breakdown: PaymentBreakdownItem[]
  onContinue: () => void
}) {
  return (
    <div className="text-center">
      {/* text-base text-accent -- matches PaymentConfirmationStage's own
          identity line (the same transaction's who/where, shown again on
          the confirmation screen); this was text-sm text-fg-secondary with
          an inline font-medium/text-fg emphasis span, found via a
          typography audit's computed-style comparison to be a real
          inconsistency, not deliberate. Kept the inline span's own
          font-medium for a subtle emphasis on the name, just without its
          own separate color override now that the whole line is accent. */}
      {identity.artistName ? (
        <div className="flex flex-col items-center gap-2">
          <FlatArtistAvatar name={identity.artistName} avatarUrl={identity.artistAvatarUrl} className="h-12 w-12" />
          <p className="text-base text-accent">
            Your session with <span className="font-medium">{identity.artistName}</span> at {identity.studioName}
          </p>
        </div>
      ) : (
        <p className="text-base text-accent">{identity.studioName}</p>
      )}

      <p className="font-display mt-4 text-5xl font-medium text-fg">{formatCents(headlineAmountCents)}</p>

      <div className="text-left">
        <PaymentBreakdownDisclosure items={breakdown} />
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="login-button login-jura mt-8 w-full px-4 py-3 text-sm font-bold uppercase"
      >
        Continue
      </button>
    </div>
  )
}

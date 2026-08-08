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
      {identity.artistName ? (
        <div className="flex flex-col items-center gap-2">
          <FlatArtistAvatar name={identity.artistName} avatarUrl={identity.artistAvatarUrl} className="h-12 w-12" />
          <p className="text-sm text-fg-secondary">
            Your session with <span className="font-medium text-fg">{identity.artistName}</span> at{' '}
            {identity.studioName}
          </p>
        </div>
      ) : (
        <p className="text-sm text-fg-secondary">{identity.studioName}</p>
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

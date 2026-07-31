import { useSocket } from '../context/useSocket'

// Deliberately renders NOTHING while connected -- this is the common case
// and should stay invisible. Only appears during a drop/reconnect, so staff
// have an actual signal that live updates are paused right now (and thus a
// reason to manually refresh if something time-sensitive isn't showing up),
// instead of silently trusting a connection that isn't there. Pairs with
// the reconnect catch-up invalidate in SocketContext.tsx -- this indicator
// disappearing IS the signal that the catch-up refetch has happened.
export default function ConnectionStatusIndicator() {
  const { connectionStatus } = useSocket()

  if (connectionStatus === 'connected') return null

  return (
    <div
      className="flex h-11 items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 text-xs font-medium text-warning shadow-lg"
      title="Live updates are paused while reconnecting -- recent changes made by others may not appear yet."
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" aria-hidden="true" />
      Reconnecting…
    </div>
  )
}

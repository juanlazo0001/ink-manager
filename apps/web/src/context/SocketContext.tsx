import { useEffect, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { SocketContext, type ConnectionStatus } from './socket-context'
import { useAuth } from './useAuth'
import { queryClient } from '../lib/queryClient'

const API_URL = import.meta.env.VITE_API_URL

interface PresenceUserEvent {
  userId: string
}

interface PresenceSnapshotEvent {
  userIds: string[]
}

// Generic mechanism other parts of the app rely on (Part 2): every mutation
// route emits `invalidate` with the React Query cache keys it just made
// stale, and this is the single listener that turns those into
// queryClient.invalidateQueries calls. No component needs its own socket
// listener -- the data itself always flows back through the normal,
// already permission-scoped REST fetch that invalidateQueries triggers.
interface InvalidateEvent {
  keys: unknown[][]
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    if (!token) {
      setSocket(null)
      setOnlineUserIds(new Set())
      setConnectionStatus('connecting')
      return
    }

    const instance = io(API_URL, {
      auth: { token },
      // Explicit rather than left to the client library's own defaults --
      // documents the intent that this MUST keep retrying forever with a
      // capped, jittered backoff. A staff member's tab can plausibly sit
      // open across a laptop sleep/wake or a long wifi drop and still needs
      // to recover on its own, not get stuck after some default attempt cap.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
    })
    setSocket(instance)
    setConnectionStatus('connecting')

    // Flips true after this socket's first successful connect -- every
    // 'connect' after that point is necessarily a RE-connect, which is what
    // gates the catch-up invalidate below. A plain closure variable, not
    // state: read synchronously inside the handler, never needs to trigger
    // its own render.
    let hasConnectedBefore = false

    instance.on('connect', () => {
      setConnectionStatus('connected')

      if (hasConnectedBefore) {
        // Whatever 'invalidate' events the server emitted while this
        // client was disconnected are gone for good -- Socket.IO doesn't
        // queue events for a client that isn't connected (no
        // connectionStateRecovery configured server-side), and nothing
        // else in this app polls or refetches on its own
        // (queryClient.ts sets refetchOnWindowFocus: false BY DESIGN, to
        // lean on this push architecture instead of double-fetching
        // against it). So a reconnect after ANY drop -- a brief wifi blip,
        // a backgrounded tab throttled past the server's ping timeout, a
        // laptop sleep/wake -- must assume it missed something and
        // refetch every active query, not just wait for the next
        // unrelated invalidate event to happen to touch the same keys.
        // This is the fix for the reported "staleness across almost
        // everything": individual missing notify-event coverage (Part 2)
        // is one source of it, but ANY connection gap silently and
        // permanently going uncaught-up was the bigger, compounding one.
        queryClient.invalidateQueries()
      }
      hasConnectedBefore = true
    })

    instance.on('disconnect', () => {
      setConnectionStatus('disconnected')
    })

    instance.on('reconnect_attempt', () => {
      setConnectionStatus('connecting')
    })

    // Fires on the initial connect AND on every reconnect -- the server
    // always follows up with a presence:snapshot (see io.ts), so a
    // reconnect after a dropped connection re-syncs presence from scratch
    // rather than trusting whatever this client last knew.
    instance.on('presence:snapshot', ({ userIds }: PresenceSnapshotEvent) => {
      setOnlineUserIds(new Set(userIds))
    })

    instance.on('presence:online', ({ userId }: PresenceUserEvent) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev)
        next.add(userId)
        return next
      })
    })

    instance.on('presence:offline', ({ userId }: PresenceUserEvent) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    })

    instance.on('invalidate', ({ keys }: InvalidateEvent) => {
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey })
      }
    })

    // Browsers throttle (or fully suspend) timers -- and can pause the
    // underlying transport outright -- for a backgrounded tab, which can
    // leave socket.io's own reconnection backoff sitting well past when
    // the tab is actually usable again. Forcing an immediate reconnect
    // attempt the moment the tab becomes visible (if it isn't already
    // connected) means staff coming back to a stale tab get caught up
    // right away instead of waiting out whatever backoff delay happened
    // to be in flight.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && instance.disconnected) {
        instance.connect()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Same idea for a real network transition (wifi drops and comes back,
    // switching to cellular) -- the browser's own online event fires
    // before socket.io's backoff timer would necessarily fire again.
    function handleOnline() {
      if (instance.disconnected) {
        instance.connect()
      }
    }
    window.addEventListener('online', handleOnline)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      instance.disconnect()
      setSocket(null)
      setOnlineUserIds(new Set())
      setConnectionStatus('connecting')
    }
  }, [token])

  return (
    <SocketContext.Provider value={{ socket, onlineUserIds, connectionStatus }}>{children}</SocketContext.Provider>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'
import { SocketContext } from './socket-context'
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

  useEffect(() => {
    if (!token) {
      setSocket(null)
      setOnlineUserIds(new Set())
      return
    }

    const instance = io(API_URL, {
      auth: { token },
    })
    setSocket(instance)

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

    return () => {
      instance.disconnect()
      setSocket(null)
      setOnlineUserIds(new Set())
    }
  }, [token])

  return <SocketContext.Provider value={{ socket, onlineUserIds }}>{children}</SocketContext.Provider>
}

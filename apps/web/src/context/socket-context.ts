import { createContext } from 'react'
import type { Socket } from 'socket.io-client'

// 'connecting' covers both the very first handshake and any reconnect
// attempt in progress -- staff don't need to distinguish those, just
// whether live updates are flowing right now or not. 'disconnected' is
// the brief moment right after a drop, before socket.io's own
// reconnection loop kicks in (reconnection: true, attempts: Infinity --
// see SocketContext.tsx -- so this app never settles into a permanent
// given-up state).
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface SocketContextValue {
  socket: Socket | null
  // Online staff userIds for the current user's studio. Presence has no
  // per-studio scoping question on the client side -- a JWT only ever
  // belongs to one studio, so this is just "who's online here".
  onlineUserIds: Set<string>
  connectionStatus: ConnectionStatus
}

export const SocketContext = createContext<SocketContextValue | undefined>(undefined)

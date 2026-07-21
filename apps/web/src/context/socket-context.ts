import { createContext } from 'react'
import type { Socket } from 'socket.io-client'

export interface SocketContextValue {
  socket: Socket | null
  // Online staff userIds for the current user's studio. Presence has no
  // per-studio scoping question on the client side -- a JWT only ever
  // belongs to one studio, so this is just "who's online here".
  onlineUserIds: Set<string>
}

export const SocketContext = createContext<SocketContextValue | undefined>(undefined)

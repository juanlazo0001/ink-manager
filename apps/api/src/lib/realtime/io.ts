import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../jwt";
import type { AuthPayload } from "../../middleware/auth";
import { markOnline, scheduleOffline, getOnlineUserIds } from "./presence";

// Single Socket.IO server instance for the whole process, attached to the
// same HTTP server Express listens on (Railway only exposes one port -- no
// second listener). Populated by initRealtime() at boot (see index.ts);
// null until then so any accidental early import fails loudly rather than
// silently no-op-ing.
let io: Server | null = null;

export function getIo(): Server {
  if (!io) throw new Error("Realtime server not initialized -- call initRealtime() first");
  return io;
}

function studioRoom(studioId: string): string {
  return `studio:${studioId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

// KNOWN, ACCEPTED LIMITATION: presence + invalidation both broadcast via
// this single in-process Socket.IO server. Correct for one API instance
// (what's deployed today). If the API is ever scaled to multiple replicas,
// a client connected to replica A would never see an event emitted by
// replica B -- would need a shared adapter (e.g. @socket.io/redis-adapter)
// plus moving presence's in-memory Maps to Redis. Same category of
// limitation already accepted for the Phase 7A in-process job scheduler.
export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: true },
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("Unauthorized"));
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      socket.data.user = payload;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as AuthPayload;

    socket.join(studioRoom(user.studioId));
    socket.join(userRoom(user.userId));

    markOnline(io!, user.studioId, user.userId);

    // Snapshot for this socket only, sent after this connection has already
    // been folded into the online set above -- so a freshly-loaded page's
    // own presence dot is correct immediately, not just everyone else's.
    socket.emit("presence:snapshot", { userIds: getOnlineUserIds(user.studioId) });

    socket.on("disconnect", () => {
      scheduleOffline(io!, user.studioId, user.userId);
    });
  });

  return io;
}

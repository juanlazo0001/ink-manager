import type { Server } from "socket.io";

// Ephemeral, in-memory only -- no schema/database involvement, and nothing
// here needs to survive a process restart (a fresh boot just means every
// client's next connect re-populates it from scratch).
//
// See the comment on initRealtime() in ./io.ts for the accepted
// single-instance limitation this shares with the Phase 7A job scheduler.

// Debounce before broadcasting a user as offline -- absorbs a brief
// reconnect (flaky network) or a tab switch/refresh without flickering the
// dot for every other staff member watching it.
const OFFLINE_DEBOUNCE_MS = 8_000;

// The set of userIds currently considered online per studio -- what a
// freshly-connecting client is handed as its initial snapshot.
const onlineUsers = new Map<string, Set<string>>();

// Live socket-connection counts per (studioId, userId) -- a user can have
// multiple tabs/devices open at once, so "online" only flips to false once
// every connection has gone away (and stayed gone through the debounce).
const connectionCounts = new Map<string, number>();

const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>();

function key(studioId: string, userId: string): string {
  return `${studioId}:${userId}`;
}

export function getOnlineUserIds(studioId: string): string[] {
  return [...(onlineUsers.get(studioId) ?? [])];
}

export function markOnline(io: Server, studioId: string, userId: string): void {
  const k = key(studioId, userId);

  const pending = pendingOffline.get(k);
  if (pending) {
    clearTimeout(pending);
    pendingOffline.delete(k);
  }

  connectionCounts.set(k, (connectionCounts.get(k) ?? 0) + 1);

  const studioSet = onlineUsers.get(studioId) ?? new Set<string>();
  const wasOnline = studioSet.has(userId);
  studioSet.add(userId);
  onlineUsers.set(studioId, studioSet);

  if (!wasOnline) {
    io.to(`studio:${studioId}`).emit("presence:online", { userId });
  }
}

export function scheduleOffline(io: Server, studioId: string, userId: string): void {
  const k = key(studioId, userId);

  const remaining = (connectionCounts.get(k) ?? 1) - 1;
  connectionCounts.set(k, remaining);

  if (remaining > 0) return;

  const timer = setTimeout(() => {
    pendingOffline.delete(k);

    // A reconnect (or another tab) may have bumped the count back up while
    // this timer was pending -- only actually go offline if it's still 0.
    if ((connectionCounts.get(k) ?? 0) > 0) return;

    connectionCounts.delete(k);
    onlineUsers.get(studioId)?.delete(userId);
    io.to(`studio:${studioId}`).emit("presence:offline", { userId });
  }, OFFLINE_DEBOUNCE_MS);

  pendingOffline.set(k, timer);
}

import type { NavCounts, TasksResponse } from '@ink-manager/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/context/auth';
import { apiFetch } from '@/lib/api';
import { fetchTasks } from '@/lib/tasks';

/**
 * The two numbers the tab bar wears: unread chat threads, and open tasks.
 *
 * Both definitions are web's, not new ones:
 *
 *   chat   `GET /nav-counts` → `conversations`. Threads with a message
 *          from someone else since this viewer's own `lastReadAt`, which
 *          is cleared by opening the thread. A count of THREADS.
 *   tasks  `GET /tasks` → `system.length + personal.filter(open).length`,
 *          the same sum web's top bar computes. For an ARTIST `system` is
 *          always empty (enforced server-side), so in practice it is
 *          "open tasks assigned to me".
 *
 * Polled at web's own 60s cadence rather than the 30s the message and task
 * SCREENS use: a badge is ambient, and it also refreshes on focus, which
 * covers the case that actually matters — coming back from a thread you
 * just read.
 *
 * Neither count gates on `showSidebarBadges`. That toggle governs web's
 * SIDEBAR bubbles; its own top-bar task badge and chat FAB badge both
 * ignore it, and these are the counterparts of those two.
 */
const POLL_MS = 60_000;

export interface BadgeCounts {
  conversations: number;
  tasks: number;
}

export function useBadgeCounts(): BadgeCounts & { refresh: () => void } {
  const { session } = useAuth();
  const token = session?.token ?? null;
  const [counts, setCounts] = useState<BadgeCounts>({ conversations: 0, tasks: 0 });

  const load = useCallback(async () => {
    if (!token) return;
    // Settled, not all: a badge is chrome. One of these failing must not
    // blank the other, and neither failing is worth surfacing anywhere —
    // the screens behind them report their own errors.
    const [nav, tasks] = await Promise.allSettled([
      apiFetch<NavCounts>('/nav-counts', { token }),
      fetchTasks(token),
    ]);
    setCounts((current) => ({
      conversations: nav.status === 'fulfilled' ? nav.value.conversations : current.conversations,
      tasks:
        tasks.status === 'fulfilled'
          ? taskBadgeCount(tasks.value)
          : current.tasks,
    }));
  }, [token]);

  useEffect(() => {
    if (!token) {
      setCounts({ conversations: 0, tasks: 0 });
      return;
    }
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [token, load]);

  return { ...counts, refresh: () => void load() };
}

/** Web's `taskBadgeCount`, verbatim. Exported so it is checkable on its own. */
export function taskBadgeCount(data: TasksResponse): number {
  return data.system.length + data.personal.filter((t) => !t.completedAt).length;
}

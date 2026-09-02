import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/auth';
import { fetchWidgetLayout, saveWidgetLayout } from '@/lib/artists';

/**
 * Which section cards are collapsed, remembered per user, across restarts.
 *
 * ─── THE SAME STORE WEB USES, NOT A LOCAL COPY ──────────────────────
 *
 * Web persists this SERVER-SIDE: `UserWidgetLayout`, through
 * `GET`/`PUT /widget-layouts/:pageKey`, keyed on (user, pageKey), with
 * `collapsedWidgetIds` holding exactly this. Both routes are
 * `requireRole(OWNER, FRONT_DESK, ARTIST)`, so mobile can read and write
 * the same rows — which means collapsing a card on the phone collapses
 * it in the portal and back again.
 *
 * AsyncStorage was the alternative and would have been wrong here: it
 * would have given one person two different memories of the same
 * preference depending on which client they opened, and nothing would
 * ever reconcile them. No new API surface is added — this is the
 * endpoint web already calls, with the page keys web already uses.
 *
 * ─── WHAT IS DELIBERATELY NOT SHARED ────────────────────────────────
 *
 * `widgetOrder` is read and written back untouched. Web lets a person
 * drag its cards into an order; mobile has no reorder gesture, so it must
 * PRESERVE whatever web stored rather than overwrite it with an empty
 * array — a phone visit would otherwise silently reset the order someone
 * arranged in the portal. That is the whole reason the save below sends
 * the order it loaded.
 *
 * ─── FAILURE IS SILENT, ON PURPOSE ──────────────────────────────────
 *
 * A display preference that will not load is not worth an error state:
 * the screen opens with its built-in defaults, exactly as it did before
 * this existed. A save that fails leaves the card collapsed for this
 * session and unremembered for the next, which is the smallest possible
 * consequence.
 */
export interface CollapsedSections {
  /** True once the stored value has arrived — defaults apply until then. */
  ready: boolean;
  isCollapsed: (sectionId: string) => boolean;
  toggle: (sectionId: string) => void;
  /** Collapse or expand every id at once, for the header control. */
  setAll: (sectionIds: string[], collapsed: boolean) => void;
}

export function useCollapsedSections(
  pageKey: string,
  /** Ids collapsed the first time a user ever opens the screen. */
  defaultCollapsed: string[] = [],
): CollapsedSections {
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [collapsed, setCollapsed] = useState<string[]>(defaultCollapsed);
  const [ready, setReady] = useState(false);
  /** Web's order, held so a save from here never discards it. */
  const widgetOrder = useRef<string[]>([]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetchWidgetLayout(token, pageKey)
      .then((layout) => {
        if (!active) return;
        widgetOrder.current = layout.widgetOrder ?? [];
        /*
         * A row that exists but has never had anything collapsed is
         * indistinguishable from no row at all — both come back as an
         * empty array. The defaults therefore apply only when the user
         * has NO stored row, which the API cannot tell us; so an empty
         * list is treated as "nothing collapsed", which is what someone
         * who expanded everything and left would expect to come back to.
         */
        setCollapsed(layout.collapsedWidgetIds ?? []);
        setReady(true);
      })
      .catch(() => {
        if (active) setReady(true); // defaults stand
      });
    return () => {
      active = false;
    };
  }, [token, pageKey]);

  const persist = useCallback(
    (next: string[]) => {
      setCollapsed(next);
      if (!token) return;
      void saveWidgetLayout(token, pageKey, {
        widgetOrder: widgetOrder.current,
        collapsedWidgetIds: next,
      }).catch(() => {
        /* Kept for this session, not remembered for the next. */
      });
    },
    [token, pageKey],
  );

  const isCollapsed = useCallback((id: string) => collapsed.includes(id), [collapsed]);

  const toggle = useCallback(
    (id: string) => {
      persist(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);
    },
    [collapsed, persist],
  );

  const setAll = useCallback(
    (ids: string[], value: boolean) => persist(value ? [...ids] : []),
    [persist],
  );

  return { ready, isCollapsed, toggle, setAll };
}

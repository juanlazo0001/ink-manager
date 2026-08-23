import type { ArtistProfile, ServiceOption, WidgetLayout } from '@ink-manager/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/context/auth';
import { fetchArtistProfile, fetchServices, fetchWidgetLayout } from '@/lib/artists';
import { resolveSectionOrder, type ArtistSectionId } from '@/lib/artistProfile';
import { screenErrorMessage } from '@/lib/screenError';

export const ARTIST_LAYOUT_PAGE_KEY = 'artist-detail';

export interface ArtistProfileData {
  artist: ArtistProfile | null;
  services: ServiceOption[];
  order: ArtistSectionId[];
  collapsed: string[];
  loading: boolean;
  /** The profile itself failed to load. The screen has nothing to show. */
  error: string | null;
  /**
   * This account has no artist profile at all — a FRONT_DESK login, say.
   * A different answer from an error, and it deserves different words.
   */
  noArtistProfile: boolean;
  reload: () => void;
  /** Adopt a server response after a save, without a second round trip. */
  applyArtist: (next: ArtistProfile) => void;
  setLayout: (next: { order: ArtistSectionId[]; collapsed: string[] }) => void;
}

/**
 * Everything the profile screens read, in one place.
 *
 * The three requests are deliberately not equal. Only the artist matters:
 * services and the saved layout each have an obvious, correct fallback
 * (no service names; the default order), so a failure in either is
 * swallowed rather than turned into an error screen. Failing the whole
 * profile because a display preference didn't load would be the wrong
 * trade every time.
 */
export function useArtistProfileData(): ArtistProfileData {
  const { session } = useAuth();
  const token = session?.token ?? null;
  const artistId = session?.profile.artist?.id ?? null;

  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [order, setOrder] = useState<ArtistSectionId[]>(() => resolveSectionOrder([]));
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadIndex, setReloadIndex] = useState(0);

  useEffect(() => {
    if (!token || !artistId) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    fetchArtistProfile(token, artistId, controller.signal)
      .then((data) => {
        if (active) setArtist(data);
      })
      .catch((err: unknown) => {
        if (active && !controller.signal.aborted) setError(screenErrorMessage(err, 'your profile'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // Non-critical, and intentionally not awaited alongside the profile:
    // the screen renders as soon as the artist arrives, and service names
    // fill in when they do.
    fetchServices(token, controller.signal)
      .then((data) => {
        if (active) setServices(data);
      })
      .catch(() => {
        /* Services just stay unnamed. */
      });

    fetchWidgetLayout(token, ARTIST_LAYOUT_PAGE_KEY, controller.signal)
      .then((layout: WidgetLayout) => {
        if (!active) return;
        setOrder(resolveSectionOrder(layout.widgetOrder));
        setCollapsed(layout.collapsedWidgetIds);
      })
      .catch(() => {
        /* Default order, nothing collapsed. */
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, artistId, reloadIndex]);

  const reload = useCallback(() => setReloadIndex((i) => i + 1), []);
  const applyArtist = useCallback((next: ArtistProfile) => setArtist(next), []);
  const setLayout = useCallback((next: { order: ArtistSectionId[]; collapsed: string[] }) => {
    setOrder(next.order);
    setCollapsed(next.collapsed);
  }, []);

  return {
    artist,
    services,
    order,
    collapsed,
    loading,
    error,
    noArtistProfile: !!session && !artistId,
    reload,
    applyArtist,
    setLayout,
  };
}

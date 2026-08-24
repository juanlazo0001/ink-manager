import type { MeResponse } from '@ink-manager/shared-types';

import { ClientsIcon, PhotoIcon, ScanIcon, TeamIcon } from '@/components/icons';

/**
 * The drawer's contents, as one manifest.
 *
 * Adding a destination is a line here — never a layout change. That is
 * the point: the previous arrangement grew by editing the account menu's
 * JSX four times, which is how it ended up mixing navigation with
 * identity in the first place.
 *
 * **Bottom tabs never appear here.** Home, Inquiries, Chat, Schedule and
 * Tasks are reachable from the tab bar, and a destination that exists in
 * two places teaches that neither is the real one.
 *
 * Gates mirror apps/web's Sidebar entries EXACTLY — including two this
 * app previously got wrong:
 *
 *   Team    web gates on `roles: ['OWNER']` plus `hideForSoloStudio`,
 *           NOT on `team.manage`. Session N used the permission, which is
 *           close but not web's rule: a FRONT_DESK granted team.manage
 *           would have seen an entry web hides, and a solo studio owner
 *           would have seen a roster of one.
 *   Flash   web gates on `flashGallery.manage`. It was ungated here,
 *           so an artist without it saw a destination the API refuses.
 */
export interface NavDestination {
  id: string;
  label: string;
  href: '/clients' | '/team' | '/flash' | '/scan';
  Icon: (props: { size?: number; color: string }) => React.ReactElement;
  /** Permission key required, if web requires one. */
  permission?: string;
  /** Roles allowed, if web restricts by role instead. */
  roles?: string[];
  /** Web hides Team for a solo studio — a roster of one is not a roster. */
  hideForSoloStudio?: boolean;
}

export const NAV_DESTINATIONS: NavDestination[] = [
  {
    id: 'clients',
    label: 'Clients',
    href: '/clients',
    Icon: ClientsIcon,
    permission: 'clients.view',
  },
  {
    id: 'team',
    label: 'Team & Permissions',
    href: '/team',
    Icon: TeamIcon,
    roles: ['OWNER'],
    hideForSoloStudio: true,
  },
  {
    id: 'flash',
    label: 'Flash Gallery',
    href: '/flash',
    Icon: PhotoIcon,
    permission: 'flashGallery.manage',
  },
  {
    id: 'scan',
    label: 'Scan',
    href: '/scan',
    Icon: ScanIcon,
    permission: 'giftCards.view',
  },
];

/**
 * What this person may actually reach.
 *
 * Hidden rather than disabled, matching web: an entry that opens a 403 is
 * worse than an entry that is not there.
 *
 * An OWNER passes every permission gate without the list needing to say
 * so — the API returns every key for that role, because `hasPermission()`
 * short-circuits to true before consulting anything.
 */
export function visibleDestinations(profile: MeResponse | undefined | null): NavDestination[] {
  if (!profile) return [];
  const permissions = profile.permissions ?? [];
  const isSolo = profile.isSoloStudio ?? false;

  return NAV_DESTINATIONS.filter((d) => {
    if (d.roles && !d.roles.includes(profile.role)) return false;
    if (d.hideForSoloStudio && isSolo) return false;
    if (d.permission && !permissions.includes(d.permission)) return false;
    return true;
  });
}

/**
 * Is this destination the screen currently showing?
 *
 * Prefix match, not equality: `/clients/abc` is still Clients, and the
 * drawer should say so when it opens over a client's detail.
 */
export function isActiveDestination(pathname: string, destination: NavDestination): boolean {
  if (pathname === destination.href) return true;
  // `/client/[id]` is the detail route for `/clients` — singular by
  // expo-router convention, so a bare prefix test would miss it.
  if (destination.href === '/clients' && pathname.startsWith('/client/')) return true;
  return pathname.startsWith(`${destination.href}/`);
}

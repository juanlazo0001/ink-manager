// Mirrors apps/api/src/lib/permissions.ts's PERMISSION_KEYS — kept in sync
// manually since this is a small monorepo without a shared types package.
export interface PermissionGroup {
  label: string
  keys: { key: string; label: string }[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { label: 'Studio', keys: [{ key: 'studio.manage', label: 'Manage studio profile, logo & website' }] },
  { label: 'Locations', keys: [{ key: 'locations.manage', label: 'Add, edit & delete locations and hours' }] },
  {
    label: 'Artists',
    keys: [
      { key: 'artists.view', label: 'View the artists list' },
      { key: 'artists.manage', label: 'Add artist profiles' },
    ],
  },
  { label: 'Clients', keys: [{ key: 'clients.manage', label: 'View & manage clients, send consent forms' }] },
  {
    label: 'Appointments',
    keys: [
      { key: 'appointments.view', label: 'View appointments' },
      { key: 'appointments.create', label: 'Create appointments' },
      { key: 'appointments.manage', label: 'Update appointment status' },
    ],
  },
]

export const CONFIGURABLE_ROLES = ['FRONT_DESK', 'ARTIST', 'CUSTOMER'] as const

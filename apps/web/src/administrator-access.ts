import type { AdministrationStatus } from '@p2p/contracts';

export function administratorAccess(
  status: Pick<AdministrationStatus, 'roles' | 'setupAvailable'>,
) {
  if (status.roles.includes('ACCESS_ADMIN')) return 'manage';
  if (status.setupAvailable) return 'bootstrap';
  if (status.roles.some((role) => role !== 'USER')) return 'granted';
  return 'request';
}

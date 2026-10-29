import type { QueryClient } from '@tanstack/react-query';
import type { AdminSourcingCommand } from './sourcing-admin-command.ts';
import type { Session } from './types.ts';
import { invalidateAdminViews } from './admin-view-authority.ts';

export type AdminAuthFailure = 'invalid' | 'unavailable';
export function adminAuthFailure(
  error: unknown,
  source: 'refresh' | 'access' = 'refresh',
): AdminAuthFailure {
  return source === 'refresh' &&
    error &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 401
    ? 'invalid'
    : 'unavailable';
}
export function currentAdminAuthFailure(
  error: unknown,
  sentGeneration: number,
  currentGeneration: number,
  source: 'refresh' | 'access' = 'refresh',
) {
  return sentGeneration === currentGeneration ? adminAuthFailure(error, source) : null;
}
export function preserveAdminJournal(
  client: QueryClient,
  owner: string | null,
  reason: AdminAuthFailure | 'logout' | 'different-owner' | 'permissions-changed',
) {
  const candidate =
    owner && (reason === 'unavailable' || reason === 'permissions-changed')
      ? client.getQueryData<AdminSourcingCommand | null>(['admin', 'sourcing-command', owner])
      : null;
  const command =
    reason === 'permissions-changed' && candidate?.phase === 'failed' ? null : candidate;
  // Remove private snapshots and stop their requests even on temporary failure.
  // Only the command belonging to the previously verified owner may survive.
  invalidateAdminViews();
  client.clear();
  if (command && owner)
    client.setQueryData(
      ['admin', 'sourcing-command', owner],
      command.phase === 'pending'
        ? {
            ...command,
            phase: 'unknown',
            uncertain: true,
            message:
              'تأیید نشست موقتاً در دسترس نیست؛ فرمان و شناسهٔ همان تلاش محفوظ‌اند. پس از تأیید دوبارهٔ همین حساب، رسید را پیگیری کنید.',
          }
        : command,
    );
}
export function acceptAdminOwner(client: QueryClient, previous: string | null, next: string) {
  if (previous && previous !== next) preserveAdminJournal(client, previous, 'different-owner');
}
export function adminPermissionsChanged(
  previous: readonly string[] | null,
  next: readonly string[],
) {
  return (
    previous !== null &&
    JSON.stringify([...new Set(previous)].sort()) !== JSON.stringify([...new Set(next)].sort())
  );
}
export function acceptAdminAuthorization(
  client: QueryClient,
  previousOwner: string | null,
  nextOwner: string,
  previousPermissions: readonly string[] | null,
  nextPermissions: readonly string[],
) {
  const ownerChanged = previousOwner !== null && previousOwner !== nextOwner,
    permissionsChanged =
      previousOwner === nextOwner && adminPermissionsChanged(previousPermissions, nextPermissions);
  if (ownerChanged) preserveAdminJournal(client, previousOwner, 'different-owner');
  else if (permissionsChanged) preserveAdminJournal(client, previousOwner, 'permissions-changed');
  return { ownerChanged, permissionsChanged };
}
export function isVerifiedAdminSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Session>;
  return (
    typeof s.accessToken === 'string' &&
    s.accessToken.length > 0 &&
    typeof s.expiresIn === 'number' &&
    Number.isFinite(s.expiresIn) &&
    s.expiresIn > 60 &&
    (s.requiresPasswordChange === undefined || s.requiresPasswordChange === false) &&
    s.requiresMfa === false &&
    s.requiresEnrollment === false &&
    (s.requiresRecovery === undefined || s.requiresRecovery === false) &&
    !!s.user &&
    typeof s.user.id === 'string' &&
    s.user.id.length > 0 &&
    s.user.id.length <= 64 &&
    typeof s.user.displayName === 'string' &&
    typeof s.user.userName === 'string' &&
    Array.isArray(s.user.permissions) &&
    s.user.permissions.every((p) => typeof p === 'string')
  );
}

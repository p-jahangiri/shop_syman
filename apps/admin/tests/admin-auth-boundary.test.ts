import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import {
  acceptAdminAuthorization,
  acceptAdminOwner,
  adminAuthFailure,
  adminPermissionsChanged,
  currentAdminAuthFailure,
  isVerifiedAdminSession,
  preserveAdminJournal,
} from '../src/auth/admin-auth-boundary.ts';
import { allowedAdminPage } from '../src/auth/admin-page-access.ts';
import { adminViewReadSignal, adminViewRevision } from '../src/auth/admin-view-authority.ts';
import { commandPermitted } from '../src/features/market/sourcing-command-protocol.ts';
import { offerSaveSchema } from '../src/api/contracts/market/offer-contract.ts';
import {
  freezeCommand,
  type AdminSourcingCommand,
} from '../src/features/market/sourcing-admin-command.ts';
import {
  offerTestAction,
  offerTestId,
  offerTestRequest,
  offerTestSave,
} from '@sayman/web-shared/testing/offer.test-fixtures.ts';

const owner = 'verified-qa-owner',
  other = 'different-qa-owner';
const key = (id: string) => ['admin', 'sourcing-command', id];
const client = () =>
  new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
const offer = (): AdminSourcingCommand =>
  freezeCommand({
    id: offerTestAction.requestId,
    kind: 'save',
    requestId: offerTestRequest,
    offerId: offerTestId,
    reference: 'SR-1',
    body: offerSaveSchema.parse(offerTestSave),
    phase: 'unknown',
    uncertain: true,
  });
const legacy = (): AdminSourcingCommand =>
  freezeCommand({
    id: 'f'.repeat(32),
    kind: 'unavailable',
    targetId: offerTestRequest,
    reference: 'SR-1',
    body: {
      requestId: 'f'.repeat(32),
      version: offerTestAction.requestVersion,
      reasonCode: 'other',
      publicMessage: 'Synthetic QA message',
    },
    phase: 'unknown',
    uncertain: true,
  });
test('transient renewal failure hides private caches but preserves exactly the owner-bound Offer or legacy command', () => {
  for (const command of [offer(), legacy()]) {
    const cache = client();
    try {
      cache.setQueryData(key(owner), command);
      cache.setQueryData(key(other), legacy());
      cache.setQueryData(['admin', 'sourcing-detail', offerTestRequest], {
        privateNote: 'Synthetic QA private note',
      });
      preserveAdminJournal(cache, owner, 'unavailable');
      assert.deepEqual(cache.getQueryData(key(owner)), command);
      assert.equal(cache.getQueryData(key(other)), undefined);
      assert.equal(cache.getQueryData(['admin', 'sourcing-detail', offerTestRequest]), undefined);
      acceptAdminOwner(cache, owner, owner);
      const kept = cache.getQueryData<AdminSourcingCommand>(key(owner))!;
      assert.equal(kept.id, command.id);
      assert.equal(JSON.stringify(kept.body), JSON.stringify(command.body));
      assert.equal(kept.uncertain, true);
    } finally {
      cache.clear();
    }
  }
});
test('an interrupted pending command becomes uncertain while its UUID, full body and target survive same-owner verification', () => {
  const cache = client();
  try {
    const pending = { ...offer(), phase: 'pending' as const, uncertain: false };
    cache.setQueryData(key(owner), pending);
    preserveAdminJournal(cache, owner, 'unavailable');
    acceptAdminOwner(cache, owner, owner);
    const kept = cache.getQueryData<AdminSourcingCommand>(key(owner))!;
    assert.equal(kept.phase, 'unknown');
    assert.equal(kept.uncertain, true);
    assert.equal(kept.id, pending.id);
    assert.deepEqual(kept.body, pending.body);
    assert.equal(Object.isFrozen(kept.body), true);
  } finally {
    cache.clear();
  }
});
test('known committed refresh phase stays known and is never converted into an unknown mutation', () => {
  const cache = client();
  try {
    const known = { ...offer(), phase: 'refresh' as const, uncertain: false };
    cache.setQueryData(key(owner), known);
    preserveAdminJournal(cache, owner, 'unavailable');
    assert.deepEqual(cache.getQueryData(key(owner)), known);
  } finally {
    cache.clear();
  }
});
test('a different verified owner, confirmed invalid session or explicit logout purges both command kinds', () => {
  for (const command of [offer(), legacy()])
    for (const reason of ['different-owner', 'invalid', 'logout'] as const) {
      const cache = client();
      try {
        cache.setQueryData(key(owner), command);
        if (reason === 'different-owner') acceptAdminOwner(cache, owner, other);
        else preserveAdminJournal(cache, owner, reason);
        assert.equal(cache.getQueryData(key(owner)), undefined);
        assert.equal(cache.getQueryData(key(other)), undefined);
      } finally {
        cache.clear();
      }
    }
  const cache = client();
  try {
    cache.setQueryData(key(owner), offer());
    preserveAdminJournal(cache, null, 'unavailable');
    assert.equal(cache.getQueryData(key(owner)), undefined);
  } finally {
    cache.clear();
  }
});
test('only a current-generation confirmed 401 invalidates; unavailable or stale auth results cannot purge a newer login', () => {
  assert.equal(adminAuthFailure({ status: 401 }), 'invalid');
  for (const error of [
    new Error('offline'),
    { status: 0 },
    { status: 403 },
    { status: 429 },
    { status: 502 },
    { status: 503 },
  ])
    assert.equal(adminAuthFailure(error), 'unavailable');
  assert.equal(currentAdminAuthFailure({ status: 401 }, 3, 3), 'invalid');
  assert.equal(currentAdminAuthFailure({ status: 502 }, 3, 3), 'unavailable');
  assert.equal(currentAdminAuthFailure({ status: 401 }, 3, 4), null);
  assert.equal(currentAdminAuthFailure(new Error('old network failure'), 3, 4), null);
  assert.equal(adminAuthFailure({ status: 401 }, 'access'), 'unavailable');
  assert.equal(currentAdminAuthFailure({ status: 401 }, 3, 3, 'access'), 'unavailable');
  assert.equal(currentAdminAuthFailure({ status: 401 }, 3, 4, 'access'), null);
});
test('the authenticated UI resumes only for a verified access session, never an MFA or malformed grant', () => {
  const session = {
    accessToken: 'synthetic-access',
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: owner, displayName: 'QA owner', userName: 'qa-owner', permissions: ['sales.read'] },
  };
  assert.equal(isVerifiedAdminSession(session), true);
  for (const invalid of [
    { ...session, requiresMfa: true },
    { ...session, requiresEnrollment: true },
    { ...session, requiresRecovery: true },
    { ...session, expiresIn: 60 },
    { ...session, accessToken: '' },
    { ...session, user: { ...session.user, id: '' } },
    { ...session, user: { ...session.user, permissions: undefined } },
  ])
    assert.equal(isVerifiedAdminSession(invalid), false);
});
test('verified same-owner permission change purges all private snapshots but preserves only the opaque pending command', () => {
  const cache = client();
  try {
    const command = offer();
    cache.setQueryData(key(owner), command);
    cache.setQueryData(key(other), legacy());
    cache.setQueryData(['admin', 'sourcing-private'], { supplier: 'private', note: 'private' });
    const signal = adminViewReadSignal(),
      revision = adminViewRevision();
    assert.deepEqual(
      acceptAdminAuthorization(
        cache,
        owner,
        owner,
        ['sales.read', 'finance.write'],
        ['inventory.read', 'inventory.write'],
      ),
      { ownerChanged: false, permissionsChanged: true },
    );
    assert.equal(signal.aborted, true);
    assert.equal(adminViewRevision(), revision + 1);
    assert.equal(adminViewReadSignal().aborted, false);
    assert.equal(cache.getQueryData(['admin', 'sourcing-private']), undefined);
    assert.equal(cache.getQueryData(key(other)), undefined);
    assert.deepEqual(cache.getQueryData(key(owner)), command);
    assert.equal(cache.getQueryCache().getAll().length, 1);
    assert.equal(
      commandPermitted(command, { sales: false, financial: false, inventory: true }),
      false,
    );
  } finally {
    cache.clear();
  }
});
test('permission set ordering or duplicates do not purge the same verified authorization', () => {
  assert.equal(
    adminPermissionsChanged(
      ['sales.read', 'sales.write'],
      ['sales.write', 'sales.read', 'sales.read'],
    ),
    false,
  );
  assert.equal(adminPermissionsChanged(null, ['sales.read']), false);
  assert.equal(adminPermissionsChanged(['sales.read'], []), true);
  const cache = client();
  try {
    cache.setQueryData(['admin', 'allowed'], { retained: true });
    const signal = adminViewReadSignal();
    assert.deepEqual(
      acceptAdminAuthorization(cache, owner, owner, ['sales.read'], ['sales.read']),
      { ownerChanged: false, permissionsChanged: false },
    );
    assert.equal(signal.aborted, false);
    assert.deepEqual(cache.getQueryData(['admin', 'allowed']), { retained: true });
  } finally {
    cache.clear();
  }
});
test('unavailable then same-owner login with changed permissions keeps its original pending UUID and body', () => {
  const cache = client();
  try {
    const command = { ...legacy(), phase: 'pending' as const, uncertain: false };
    cache.setQueryData(key(owner), command);
    preserveAdminJournal(cache, owner, 'unavailable');
    acceptAdminAuthorization(
      cache,
      owner,
      owner,
      ['sales.read', 'sales.write'],
      ['inventory.read', 'inventory.write'],
    );
    const kept = cache.getQueryData<AdminSourcingCommand>(key(owner))!;
    assert.equal(kept.phase, 'unknown');
    assert.equal(kept.uncertain, true);
    assert.equal(kept.id, command.id);
    assert.deepEqual(kept.body, command.body);
  } finally {
    cache.clear();
  }
});
test('authorization change cancels an old query and its late response cannot recreate a private snapshot', async () => {
  const cache = client();
  let resolve!: (value: unknown) => void;
  let querySignal: AbortSignal | undefined;
  try {
    const read = cache.fetchQuery({
      queryKey: ['admin', 'old-private'],
      queryFn: ({ signal }) => {
        querySignal = signal;
        return new Promise((value) => {
          resolve = value;
        });
      },
    });
    const settled = read.catch(() => undefined);
    acceptAdminAuthorization(cache, owner, owner, ['sales.read'], ['inventory.read']);
    assert.equal(querySignal?.aborted, true);
    resolve({ privateNote: 'late response' });
    await settled;
    assert.equal(cache.getQueryData(['admin', 'old-private']), undefined);
  } finally {
    cache.clear();
  }
});
test('rendered and selected pages fall back synchronously when their current read permission is absent', () => {
  const navigation = [
    { id: 'dashboard' },
    { id: 'sourcing', permission: 'sales.read' },
    { id: 'receiving', permission: 'inventory.read' },
  ] as const;
  assert.equal(
    allowedAdminPage('sourcing', navigation, ['inventory.read'], 'dashboard'),
    'dashboard',
  );
  assert.equal(
    allowedAdminPage('receiving', navigation, ['inventory.read'], 'dashboard'),
    'receiving',
  );
  assert.equal(allowedAdminPage('sourcing', navigation, ['sales.read'], 'dashboard'), 'sourcing');
  assert.equal(allowedAdminPage('dashboard', navigation, [], 'dashboard'), 'dashboard');
});

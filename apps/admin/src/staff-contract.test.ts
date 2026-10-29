import test from 'node:test';
import assert from 'node:assert/strict';
import {
  staffRoleCatalogSchema,
  staffDetailSchema,
  staffCandidateSchema,
  staffFiltersSchema,
  emptyStaffFilters,
  staffPath,
  readStaffPage,
  readStaffDetail,
  staffHistorySchema,
  staffHistoryPath,
  staffRolesPayload,
  eligibleStaffCandidate,
} from './staff-contract.ts';
const row = {
  id: 'one',
  userName: 'operator',
  displayName: 'کارمند نمونه',
  isActive: false,
  twoFactorEnabled: false,
  mfaRecoveryPending: true,
  createdAt: '2026-10-23T00:00:00+00:00',
  version: 'identity-version-1',
  roles: ['ContentManager'],
};
const role = {
  id: 'ContentManager',
  nameFa: 'مدیر محتوا',
  nameEn: 'Content manager',
  permissions: ['catalog.read', 'cms.write'],
};
test('staff page is bounded, filter-consistent and refuses private authentication fields', () => {
  const page = { schemaVersion: 1, pageSize: 50, items: [row], nextCursor: null };
  assert.equal(readStaffPage(page, emptyStaffFilters).items[0].isActive, false);
  for (const raw of [
    { ...page, items: [{ ...row, securityStamp: 'secret' }] },
    { ...page, items: [{ ...row, passwordHash: 'secret' }] },
    { ...page, items: [{ ...row, email: 'private@example.test' }] },
    { ...page, items: [row, row] },
    { ...page, nextCursor: 'more' },
  ])
    assert.throws(() => readStaffPage(raw, emptyStaffFilters));
  assert.throws(() => readStaffPage(page, { ...emptyStaffFilters, active: 'true' }));
  assert.throws(() => readStaffPage(page, { ...emptyStaffFilters, role: 'Administrator' }));
});
test('staff detail keeps inactive and recovery state and refuses stale/wrong identities', () => {
  const detail = { schemaVersion: 1, staff: row };
  assert.deepEqual(readStaffDetail(detail, 'ONE'), row);
  assert.throws(() => readStaffDetail(detail, 'another'));
  assert.equal(
    staffDetailSchema.safeParse({ ...detail, staff: { ...row, version: '' } }).success,
    false,
  );
});
test('role catalog drives payloads without silently discarding unknown assignments', () => {
  assert.equal(
    staffRoleCatalogSchema.parse({ schemaVersion: 1, roles: [role] }).roles[0].nameFa,
    'مدیر محتوا',
  );
  assert.deepEqual(staffRolesPayload(['ContentManager'], [role]), ['ContentManager']);
  assert.throws(() => staffRolesPayload([], [role]));
  assert.throws(() => staffRolesPayload(['UnknownRole'], [role]));
  assert.throws(() => staffRolesPayload(['ContentManager', 'ContentManager'], [role]));
  assert.equal(
    staffRoleCatalogSchema.safeParse({ schemaVersion: 1, roles: [role, role] }).success,
    false,
  );
});
test('candidate needs active verified contact, no staff role and no unfinished recovery', () => {
  const candidate = {
    schemaVersion: 1 as const,
    id: 'one',
    userName: 'operator',
    displayName: 'کارمند',
    isActive: true,
    contactVerified: true,
    hasPassword: true,
    alreadyStaff: false,
    mfaRecoveryPending: false,
    version: 'v1',
  };
  assert.equal(eligibleStaffCandidate(staffCandidateSchema.parse(candidate)), true);
  for (const changed of [
    { isActive: false },
    { contactVerified: false },
    { hasPassword: false },
    { alreadyStaff: true },
    { mfaRecoveryPending: true },
  ])
    assert.equal(eligibleStaffCandidate({ ...candidate, ...changed }), false);
  assert.equal(
    staffCandidateSchema.safeParse({ ...candidate, phoneNumber: 'private' }).success,
    false,
  );
});
test('history ids stay exact above JavaScript safe integer and are strictly descending', () => {
  const event = {
    id: '9007199254740993',
    action: 'STAFF_ROLE_ADDED:ContentManager',
    actorId: 'admin',
    actorName: 'مدیر',
    at: '2026-10-23T00:00:00Z',
    traceId: 'trace',
  };
  const page = { schemaVersion: 1, pageSize: 50, items: [event], nextCursor: null };
  assert.equal(staffHistorySchema.parse(page).items[0].id, '9007199254740993');
  for (const raw of [
    { ...page, items: [event, event] },
    { ...page, items: [{ ...event, id: 9007199254740992 }] },
    { ...page, items: [{ ...event, id: '9223372036854775808' }] },
    { ...page, items: [{ ...event, id: 'not-a-number' }] },
    { ...page, items: [{ ...event, id: '' }, event] },
    { ...page, items: [{ ...event, recoveryCode: 'secret' }] },
  ])
    assert.equal(staffHistorySchema.safeParse(raw).success, false);
});
test('staff filters and cursors are encoded with explicit bounds and no candidate identifier in URLs', () => {
  assert.match(
    staffPath({ ...emptyStaffFilters, role: 'ContentManager', query: 'کارمند' }, null),
    /role=ContentManager/,
  );
  assert.equal(staffHistoryPath('one', null), '/admin/staff/one/history');
  assert.throws(() => staffHistoryPath('bad/id', null));
  assert.throws(() => staffPath(emptyStaffFilters, '!'));
  assert.equal(
    staffFiltersSchema.safeParse({ ...emptyStaffFilters, query: 'a b c d e f g h i' }).success,
    false,
  );
});

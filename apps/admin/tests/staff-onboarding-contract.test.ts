import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialStaffPasswordSchema,
  staffCreationPayload,
  readStaffCreation,
} from '../src/api/contracts/staff/staff-onboarding-contract.ts';
import { isVerifiedAdminSession } from '../src/auth/admin-auth-boundary.ts';
import {
  clearStaffCreationCommand,
  readStaffCreationCommand,
  rememberStaffCreationCommand,
} from '../src/state/staff/staff-creation-journal.ts';
const id = '3bf6bd02-62b3-4f40-9382-a322d0758994';
const role = {
  id: 'ContentManager',
  nameFa: 'محتوا',
  nameEn: 'Content',
  permissions: ['cms.read'],
};
const password = 'Synthetic-Only!123';
const values = {
  userName: 'Operator.One',
  displayName: 'همکار نمونه',
  email: '',
  initialPassword: password,
};
const row = {
  id: 'staff-one',
  userName: 'operator.one',
  displayName: 'همکار نمونه',
  isActive: true,
  twoFactorEnabled: false,
  mfaRecoveryPending: false,
  roles: [role.id],
  version: 'v1',
  createdAt: '2026-10-29T00:00:00Z',
  provisionedByAdministrator: true,
  requiresPasswordChange: true,
};
test('new staff account omits unprovided email and binds only selected supported roles', () => {
  const command = staffCreationPayload(values, [role.id], [role], id);
  assert.equal(command.userName, 'operator.one');
  assert.equal('email' in command, false);
  assert.equal(command.initialPassword, password);
  assert.throws(() => staffCreationPayload(values, [], [role], id));
  assert.throws(() => staffCreationPayload(values, ['Administrator'], [role], id));
  for (const initialPassword of [
    'short',
    'NoDigitsOrSymbol',
    'aA123456789!\u0000',
    'aA123456789!' + String.fromCharCode(0xd800),
  ])
    assert.throws(() =>
      staffCreationPayload({ ...values, initialPassword }, [role.id], [role], id),
    );
});
test('initial password grant is never an accepted operational session', () => {
  const base = {
    accessToken: 'synthetic-token',
    expiresIn: 300,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'staff-one', displayName: 'Test', userName: 'test', permissions: ['staff.write'] },
  };
  assert.equal(isVerifiedAdminSession(base), true);
  for (const requiresPasswordChange of [true, 'true', 0, null])
    assert.equal(isVerifiedAdminSession({ ...base, requiresPasswordChange }), false);
  assert.equal(
    initialStaffPasswordSchema.safeParse({ newPassword: password, confirmPassword: 'different' })
      .success,
    false,
  );
  assert.equal(
    initialStaffPasswordSchema.safeParse({ newPassword: password, confirmPassword: password })
      .success,
    true,
  );
});
test('creation receipt is exact command-bound metadata and rejects secret-bearing or incomplete output', () => {
  const receipt = { schemaVersion: 1, requestId: id, replayed: false, staff: row };
  assert.equal(readStaffCreation(receipt, id).staff.id, row.id);
  assert.throws(() => readStaffCreation({ ...receipt, requestId: crypto.randomUUID() }, id));
  assert.throws(() => readStaffCreation({ ...receipt, initialPassword: password }, id));
  assert.throws(() =>
    readStaffCreation({ ...receipt, staff: { ...row, requiresPasswordChange: false } }, id),
  );
  assert.throws(() =>
    readStaffCreation({ ...receipt, staff: { ...row, passwordHash: 'hidden' } }, id),
  );
});
test('reload journal stores only UUID and is scoped to the verified account', () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  rememberStaffCreationCommand(store, 'admin-one', id);
  assert.deepEqual([...data.values()], [id]);
  assert.equal(readStaffCreationCommand(store, 'admin-two'), null);
  clearStaffCreationCommand(store, 'admin-two', id);
  assert.equal(readStaffCreationCommand(store, 'admin-one'), id);
  clearStaffCreationCommand(store, 'admin-one', id);
  assert.equal(data.size, 0);
  assert.throws(() =>
    rememberStaffCreationCommand({ ...store, setItem: () => {} }, 'admin-one', id),
  );
});

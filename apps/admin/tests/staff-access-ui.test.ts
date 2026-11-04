import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import {
  readStaffDetail,
  staffRolesPayload,
  type StaffRole,
  type StaffRow,
} from '../src/api/contracts/staff/staff-contract.ts';
import {
  normalizeMfaCode,
  recoveryBatchSchema,
  recoveryStatusSchema,
} from '../src/api/contracts/staff/mfa-recovery-contract.ts';

const staff: StaffRow = {
  id: 'sample-account',
  userName: 'sample-user',
  displayName: 'Sample staff',
  isActive: true,
  twoFactorEnabled: true,
  mfaRecoveryPending: false,
  createdAt: '2026-11-03T10:00:00Z',
  version: 'current-version',
  roles: ['Sales'],
};
const roles: StaffRole[] = [
  { id: 'Sales', nameFa: 'فروش', nameEn: 'Sales', permissions: ['sales.read'] },
  { id: 'Support', nameFa: 'پشتیبانی', nameEn: 'Support', permissions: ['support.read'] },
];

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

test('staff access skips unchanged submissions and locks an ambiguous change until reload', async () => {
  const commands: unknown[] = [];
  const harness = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/staff/staff.tsx', import.meta.url)),
    {
      '../../components/tables/admin-table': { AdminTable: 'AdminTable' },
      '../../features/staff/staff-role-choices': { StaffRoleChoices: 'StaffRoleChoices' },
      '../../features/staff/staff-create': { StaffCreate: 'StaffCreate' },
      '../../components/filters/admin-filters': { AdminFilterForm: 'AdminFilterForm' },
      '@tanstack/react-query': { useQueryClient: () => ({}) },
      '../../api/api': {
        ApiError,
        save: (_path: string, input: unknown) => {
          commands.push(input);
          throw new ApiError(0, 'transport');
        },
      },
      '../../components/ui': { ErrorBox: 'ErrorBox', Check: 'Check' },
      '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
      '../../api/contracts/staff/staff-contract': { readStaffDetail, staffRolesPayload },
      '../../styles/staff/staff-security.css': {},
    },
    {},
    'export { StaffEditForm };',
  );
  harness.mount('StaffEditForm', {
    item: staff,
    roles,
    writable: true,
    onBusy() {},
    onReload() {},
    onDone() {
      assert.fail('Unconfirmed mutation must not show success');
    },
  });
  const find = (type: string) => {
    const node = uiElements(harness.tree()).find((item) => item.type === type);
    assert.ok(node);
    return node;
  };
  const submit = () =>
    (find('form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  await submit();
  assert.equal(commands.length, 0);
  (find('StaffRoleChoices').props.onChange as (value: string[]) => void)(['Support']);
  await harness.settle();
  await submit();
  await harness.settle();
  assert.equal(commands.length, 0);
  assert.match(uiText(harness.tree()), /نقش‌های برداشته/);
  await submit();
  await harness.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [
    { roles: ['Support'], isActive: true, version: 'current-version' },
  ]);
  assert.match(uiText(harness.tree()), /دریافت وضعیت تازه/);
  await submit();
  assert.equal(commands.length, 1);
});

test('recovery codes rotate only after explicit review and a confirmed request clears input secrets', async () => {
  const commands: unknown[] = [];
  const codes = Array.from({ length: 10 }, (_, i) => '0000000' + i + '-00000000-00000000-00000000');
  const harness = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/staff/mfa-recovery.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {
        useQuery: () => ({ data: { remainingCodes: 3 }, refetch() {} }),
      },
      '../../api/api': {
        ApiError,
        save: (_path: string, input: unknown) => {
          commands.push(input);
          return Promise.resolve({ schemaVersion: 1, generatedAt: staff.createdAt, codes });
        },
      },
      '../../components/ui': { ErrorBox: 'ErrorBox', Field: 'Field' },
      '../../features/staff/staff-password': { StaffPasswordForm: 'StaffPasswordForm' },
      '../../components/forms/password-input': { PasswordInput: 'PasswordInput' },
      '../../auth/admin-view-authority': { adminViewRevision: () => 0 },
      '../../api/contracts/staff/mfa-recovery-contract': {
        normalizeMfaCode,
        recoveryBatchSchema,
        recoveryStatusSchema,
      },
      '../../styles/staff/staff-security.css': {},
    },
  );
  harness.mount('SecurityPage', { onPasswordChanged() {} });
  const find = (type: string, content?: string) => {
    const node = uiElements(harness.tree()).find(
      (item) => item.type === type && (!content || uiText(item).includes(content)),
    );
    assert.ok(node);
    return node;
  };
  (find('button', 'کدهای پشتیبان').props.onClick as () => void)();
  await harness.settle();
  (find('PasswordInput').props.onChange as (event: unknown) => void)({
    target: { value: 'synthetic' },
  });
  (find('input').props.onChange as (event: unknown) => void)({ target: { value: '۱۲۳۴۵۶' } });
  await harness.settle();
  const submit = () =>
    (find('form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  await submit();
  await harness.settle();
  assert.equal(commands.length, 0);
  assert.match(uiText(harness.tree()), /تأیید و تولید کدهای تازه/);
  await submit();
  await harness.settle();
  assert.equal(commands.length, 1);
  assert.equal(JSON.stringify(commands[0]), '{"password":"synthetic","code":"123456"}');
  assert.equal(find('PasswordInput').props.value, '');
  assert.equal(find('input').props.value, '');
  assert.match(uiText(harness.tree()), /این مجموعه فقط همین بار نمایش داده می‌شود/);
});

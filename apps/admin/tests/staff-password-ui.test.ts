import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  type TestElement,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import { normalizeMfaCode } from '../src/api/contracts/staff/mfa-recovery-contract.ts';

class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super('synthetic transport error');
    this.status = status;
  }
}
function setup() {
  let changed = 0;
  const requests: { path: string; body: Record<string, string>; responseType: string }[] = [];
  let reply: () => Promise<{ status: number }> = async () => ({ status: 204 });
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/features/staff/staff-password.tsx', import.meta.url)),
    {
      '../../api/api': {
        ApiError,
        api: (path: string, init: { body: string }, responseType: string) => {
          requests.push({ path, body: JSON.parse(init.body), responseType });
          return reply();
        },
      },
      '../../components/ui': { ErrorBox: 'ErrorBox', Field: 'Field' },
      '../../components/forms/password-input': { PasswordInput: 'PasswordInput' },
      '../../api/contracts/staff/mfa-recovery-contract': { normalizeMfaCode },
    },
  );
  h.mount('StaffPasswordForm', {
    onChanged() {
      changed++;
    },
  });
  const node = (type: string, label?: string): TestElement => {
    const result = uiElements(h.tree()).find(
      (v) => v.type === type && (!label || v.props['aria-label'] === label),
    );
    assert.ok(result);
    return result;
  };
  async function change(label: string, value: string) {
    const control = label === 'code' ? node('input') : node('PasswordInput', label);
    (control.props.onChange as (event: unknown) => void)({ target: { value } });
    await h.settle();
  }
  async function fill(next = 'Synthetic-new-47!', confirmation = next) {
    await change('رمز فعلی', 'synthetic-current');
    await change('رمز تازه', next);
    await change('تکرار رمز تازه', confirmation);
    await change('code', '۱۲۳۴۵۶');
  }
  const submit = () =>
    (node('form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  return {
    h,
    node,
    fill,
    submit,
    requests,
    changed: () => changed,
    reply(value: typeof reply) {
      reply = value;
    },
  };
}

test('staff password form sends own proof once, normalizes only the OTP, and clears all secrets on success', async () => {
  const s = setup();
  await s.fill();
  await s.submit();
  await s.h.settle();
  assert.equal(s.changed(), 1);
  assert.equal(s.requests.length, 1);
  assert.deepEqual(s.requests[0], {
    path: '/auth/staff/change-password',
    responseType: 'response',
    body: {
      currentPassword: 'synthetic-current',
      newPassword: 'Synthetic-new-47!',
      code: '123456',
    },
  });
  for (const v of uiElements(s.h.tree()).filter((v) =>
    ['PasswordInput', 'input'].includes(String(v.type)),
  ))
    assert.equal(v.props.value, '');
});
test('mismatched confirmation never sends a command', async () => {
  const s = setup();
  await s.fill('Synthetic-new-47!', 'different');
  await s.submit();
  await s.h.settle();
  assert.equal(s.requests.length, 0);
  assert.equal(s.changed(), 0);
});
test('a locally weak new password never consumes a fresh authenticator code', async () => {
  const s = setup();
  await s.fill('syntheticpassword');
  await s.submit();
  await s.h.settle();
  assert.equal(s.requests.length, 0);
  assert.equal(s.node('input').props.value, '123456');
});
test('a double submit while awaiting transport sends one command', async () => {
  const s = setup();
  let resolve!: (value: { status: number }) => void;
  s.reply(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await s.fill();
  const first = s.submit();
  await s.submit();
  assert.equal(s.requests.length, 1);
  resolve({ status: 204 });
  await first;
  await s.h.settle();
  assert.equal(s.changed(), 1);
});
test('ambiguous change is never repeated and offers explicit return to login', async () => {
  const s = setup();
  s.reply(async () => {
    throw new ApiError(0);
  });
  await s.fill();
  await s.submit();
  await s.h.settle();
  assert.equal(s.node('fieldset').props.disabled, true);
  await s.submit();
  assert.equal(s.requests.length, 1);
  assert.equal(s.changed(), 0);
});
test('rejected proof clears secrets without pretending the password changed', async () => {
  const s = setup();
  s.reply(async () => {
    throw new ApiError(400);
  });
  await s.fill();
  await s.submit();
  await s.h.settle();
  assert.equal(s.node('fieldset').props.disabled, false);
  assert.equal(s.changed(), 0);
  assert.equal(s.node('PasswordInput', 'رمز فعلی').props.value, '');
});
test('password visibility preserves the value and forwards registration events while reporting Caps Lock', async () => {
  let keyEvents = 0,
    blurs = 0;
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/components/forms/password-input.tsx', import.meta.url)),
    {},
  );
  h.mount('PasswordInput', {
    value: 'synthetic-value',
    autoComplete: 'current-password',
    onKeyUp() {
      keyEvents++;
    },
    onBlur() {
      blurs++;
    },
  });
  const find = (type: string) => uiElements(h.tree()).find((v) => v.type === type)!;
  assert.equal(find('input').props.type, 'password');
  (find('button').props.onClick as () => void)();
  await h.settle();
  assert.equal(find('input').props.type, 'text');
  assert.equal(find('input').props.value, 'synthetic-value');
  assert.equal(find('button').props.type, 'button');
  assert.equal(find('button').props['aria-pressed'], true);
  (find('input').props.onKeyUp as (event: unknown) => void)({ getModifierState: () => true });
  await h.settle();
  assert.ok(uiElements(h.tree()).some((v) => v.props.role === 'status'));
  assert.equal(keyEvents, 1);
  (find('input').props.onBlur as (event: unknown) => void)({});
  await h.settle();
  assert.equal(blurs, 1);
  assert.ok(!uiElements(h.tree()).some((v) => v.props.role === 'status'));
});

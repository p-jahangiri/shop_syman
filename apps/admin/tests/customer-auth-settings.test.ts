import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import swc from '@swc/core';
import * as settings from '../src/features/content/customer-auth-settings.ts';

const baseline = {
  mobileOtp: true,
  registration: true,
  passwordReset: true,
  emailPassword: true,
  usernamePassword: false,
};

test('OTP-only draft intent is valid while the last requested login cannot be removed', () => {
  assert.equal(settings.hasSupportedCustomerLogin(baseline), true);
  const otpOnly = settings.changeCustomerLogin(baseline, 'emailPassword', false)!;
  assert.deepEqual(otpOnly, { ...baseline, emailPassword: false });
  assert.equal(settings.hasSupportedCustomerLogin(otpOnly), true);
  assert.equal(settings.changeCustomerLogin(otpOnly, 'mobileOtp', false), null);
  const withUsername = settings.changeCustomerLogin(otpOnly, 'usernamePassword', true)!;
  assert.deepEqual(settings.changeCustomerLogin(withUsername, 'mobileOtp', false), {
    ...baseline,
    emailPassword: false,
    mobileOtp: false,
    usernamePassword: true,
  });
  assert.deepEqual(baseline, {
    mobileOtp: true,
    registration: true,
    passwordReset: true,
    emailPassword: true,
    usernamePassword: false,
  });
});

test('all draft login combinations preserve unrelated intent and registration is not a login method', () => {
  for (let flags = 0; flags < 8; flags++) {
    const value = {
      emailPassword: Boolean(flags & 1),
      usernamePassword: Boolean(flags & 2),
      mobileOtp: Boolean(flags & 4),
      registration: true,
      passwordReset: true,
      futureFlag: true,
    };
    assert.equal(settings.hasSupportedCustomerLogin(value), flags !== 0);
    for (const { key } of settings.customerLoginChoices) {
      for (const enabled of [true, false]) {
        const expected = { ...value, [key]: enabled },
          next = settings.changeCustomerLogin(value, key, enabled);
        assert.deepEqual(
          next,
          expected.emailPassword || expected.usernamePassword || expected.mobileOtp
            ? expected
            : null,
        );
      }
    }
    assert.equal(value.registration, true);
    assert.equal(value.passwordReset, true);
    assert.equal(value.futureFlag, true);
  }
  assert.equal(
    settings.hasSupportedCustomerLogin({ registration: true, passwordReset: true }),
    false,
  );
});

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const jsx = (type: unknown, props: Element['props']) => ({ type, props });
const code = swc.transformSync(
  fs.readFileSync(
    new URL('../src/features/content/customer-auth-settings-editor.tsx', import.meta.url),
    'utf8',
  ),
  {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  },
).code;

function view(initial: Record<string, boolean>) {
  const exported: Record<string, unknown> = {};
  let value = { ...initial };
  let error: string | undefined;
  const changes: Record<string, boolean>[] = [];
  vm.runInNewContext(code, {
    exports: exported,
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return { useState: () => [error, (next: string | undefined) => (error = next)] };
      if (name === '../../components/ui') return { Check: 'Check' };
      if (name === './customer-auth-settings') return settings;
      throw Error('Unexpected module ' + name);
    },
  });
  const editor = exported.CustomerAuthSettingsEditor as (props: unknown) => Element;
  function render() {
    const nodes: Element[] = [];
    function visit(value: unknown) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && 'props' in value) {
        const node = value as Element;
        nodes.push(node);
        visit(node.props.children);
      }
    }
    visit(
      editor({
        value,
        onChange(next: Record<string, boolean>) {
          changes.push(next);
          value = next;
        },
      }),
    );
    return nodes;
  }
  return { render, changes };
}

test('the actual editor exposes OTP and registration intent; only password reset is disabled', () => {
  const editor = view(baseline);
  const nodes = editor.render();
  const checks = nodes.filter((node) => node.type === 'Check');
  assert.equal(checks.length, 5);
  assert.equal(checks.filter((node) => node.props.disabled === true).length, 1);
  assert.ok(
    checks
      .filter((node) => node.props.disabled === true)
      .every((node) => node.props.checked === false),
  );
  assert.equal(checks.find((node) => node.props.label === 'ورود با کد پیامک')?.props.checked, true);
  assert.equal(
    checks.find((node) => node.props.label === 'ثبت‌نام پس از تأیید شماره با کد پیامک')?.props
      .checked,
    true,
  );
  assert.equal(editor.changes.length, 0, 'opening the editor must not clear stored legacy intent');
});

test('the actual editor permits OTP-only intent and refuses disabling its final login choice', () => {
  const editor = view({ ...baseline, emailPassword: false });
  let checks = editor.render().filter((node) => node.type === 'Check');
  (checks[2].props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.equal(editor.changes.length, 0);
  assert.ok(editor.render().some((node) => node.props.role === 'alert'));
  checks = editor.render().filter((node) => node.type === 'Check');
  (checks[0].props.onChange as (event: unknown) => void)({ target: { checked: true } });
  checks = editor.render().filter((node) => node.type === 'Check');
  (checks[2].props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.deepEqual(editor.changes.at(-1), {
    ...baseline,
    emailPassword: true,
    mobileOtp: false,
  });
  assert.equal(
    editor.render().some((node) => node.props.role === 'alert'),
    false,
  );
});

test('the actual editor explains publication-only continuity checks without silently forcing settings', () => {
  const editor = view(baseline);
  const text = JSON.stringify(editor.render());
  assert.match(text, /هنگام انتشار یا بازگردانی/);
  assert.match(text, /پیش‌نویس حفظ می‌شود/);
  assert.equal(editor.changes.length, 0);
  assert.match(settings.customerLoginContinuityMessage, /منتشر یا بازگردانی نشد/);
  assert.match(settings.customerLoginContinuityMessage, /شمارهٔ تأییدشده/);
  assert.match(text, /آمادگی واقعی سرویس/);
  assert.match(text, /روی سرور بررسی/);
  assert.match(text, /SMS.ir/);
  assert.match(text, /Authenticator کارکنان مستقل‌اند/);
  let checks = editor.render().filter((node) => node.type === 'Check');
  (checks[1].props.onChange as (event: unknown) => void)({ target: { checked: true } });
  checks = editor.render().filter((node) => node.type === 'Check');
  (checks[0].props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.deepEqual(editor.changes.at(-1), {
    ...baseline,
    emailPassword: false,
    usernamePassword: true,
  });
  assert.equal(editor.changes.length, 2, 'editing a draft must not silently force both methods');
  const after = editor.render();
  assert.match(JSON.stringify(after), /هنگام انتشار یا بازگردانی/);
  assert.match(JSON.stringify(after), /پیش‌نویس حفظ می‌شود/);
  assert.equal(
    after.some((node) => node.props.role === 'alert'),
    false,
  );
});

test('a legacy unusable draft can be repaired using OTP alone without pretending provider readiness', () => {
  const editor = view({ ...baseline, emailPassword: false, mobileOtp: false });
  const nodes = editor.render();
  assert.ok(nodes.some((node) => node.props.role === 'alert'));
  const otp = nodes.find(
    (node) => node.type === 'Check' && node.props.label === 'ورود با کد پیامک',
  )!;
  (otp.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  assert.equal(editor.changes.at(-1)?.mobileOtp, true);
  assert.equal(editor.changes.at(-1)?.emailPassword, false);
  assert.equal(editor.changes.at(-1)?.usernamePassword, false);
  assert.equal(
    editor.render().some((node) => node.props.role === 'alert'),
    false,
  );
});

test('registration intent is independently editable and requires verified OTP in copy without silently enabling it', () => {
  const value = { ...baseline, mobileOtp: false, registration: false },
    editor = view(value);
  const registration = editor
    .render()
    .find(
      (node) =>
        node.type === 'Check' && node.props.label === 'ثبت‌نام پس از تأیید شماره با کد پیامک',
    )!;
  (registration.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  assert.deepEqual({ ...editor.changes.at(-1) }, { ...value, registration: true });
  const text = JSON.stringify(editor.render());
  assert.match(text, /فقط پس از تأیید موفق شماره/);
  assert.match(text, /روشن‌کردن ثبت‌نام، ورود پیامکی را خودکار روشن نمی‌کند/);
  assert.match(text, /Sandbox هم هویت مشتری را تأیید نمی‌کند/);
  assert.match(text, /بازیابی رمز فعلاً غیرفعال است/);
  const reset = editor
    .render()
    .find((node) => node.type === 'Check' && node.props.label === 'بازیابی رمز با تأیید هویت')!;
  assert.equal(reset.props.disabled, true);
  assert.equal(reset.props.checked, false);
  assert.equal(reset.props.onChange, undefined);
  assert.equal(
    editor.changes.at(-1)?.passwordReset,
    true,
    'unsupported legacy intent must not be silently rewritten',
  );
});

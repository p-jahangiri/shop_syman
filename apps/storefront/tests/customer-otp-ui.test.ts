import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as otpContract from '../lib/auth/customer-otp-contract.ts';
import { CustomerOtpFlow } from '../lib/auth/customer-otp-flow.ts';
import {
  CustomerSessionStore,
  SessionError,
  type CustomerSession,
} from '../lib/account/customer-session.ts';
import type { OtpChallenge, OtpRequest } from '../lib/auth/customer-otp-contract.ts';
const session: CustomerSession = {
  accessToken: 'synthetic-access-token-never-persisted',
  expiresIn: 600,
  requiresMfa: false,
  requiresEnrollment: false,
  user: { id: 'synthetic-owner', displayName: 'Synthetic', userName: 'synthetic' },
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
const submit = { preventDefault() {} };
const lock = async <T>(run: () => Promise<T>) => run();
async function otpUi(locale = 'fa', registration = true) {
  let clock = Date.parse('2026-10-31T10:00:00Z');
  const challenge: OtpChallenge = {
    schemaVersion: 1,
    challengeId: 'a'.repeat(32),
    expiresAt: '2026-10-31T10:05:00Z',
    resendAt: '2026-10-31T10:01:00Z',
    delivery: 'accepted',
  };
  let requester = async (_input: OtpRequest) => challenge;
  let verifier = async () => session;
  const store = new CustomerSessionStore(
    async () => verifier(),
    async () => {
      throw new SessionError('invalid');
    },
    lock,
    () => false,
  );
  await store.restore();
  const mfa: CustomerSession[] = [],
    ticks = new Set<() => void>();
  class Flow extends CustomerOtpFlow {
    constructor(verify: CustomerSessionStore['loginOtp'], revision: () => number) {
      super(
        verify,
        revision,
        (input) => requester(input),
        () => clock,
        () => 'b'.repeat(32),
      );
    }
  }
  const h = digitalUiHarness(
    'apps/storefront/components/auth/customer-otp-login.tsx',
    {
      '@/lib/auth/customer-otp-flow': { CustomerOtpFlow: Flow },
      '@/lib/auth/customer-otp-contract': otpContract,
      './auth-provider': { useCustomerSession: () => ({ store }) },
      '../navigation/locale-provider': { useI18n: () => ({ locale, digits: String }) },
      '../shared/ui': { Button: 'Button' },
      './customer-otp-login.css': {},
    },
    {
      Date: { now: () => clock },
      setInterval: (callback: () => void) => {
        ticks.add(callback);
        return callback;
      },
      clearInterval: (callback: () => void) => ticks.delete(callback),
      requestAnimationFrame: (callback: () => void) => callback(),
    },
  );
  h.mount('CustomerOtpLogin', { registration, onMfa: (value: CustomerSession) => mfa.push(value) });
  await h.settle();
  return {
    ...h,
    mfa,
    store,
    challenge,
    request(next: typeof requester) {
      requester = next;
    },
    verify(next: typeof verifier) {
      verifier = next;
    },
    input(id: string, value: string) {
      const input = uiElements(h.rerender()).find(
        (node) => node.type === 'input' && node.props.id === id,
      );
      assert.ok(input, 'Missing input: ' + id);
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      h.rerender();
    },
    form() {
      const form = uiElements(h.rerender()).find((node) => node.type === 'form');
      assert.ok(form);
      return form.props.onSubmit as (event: unknown) => Promise<void>;
    },
    tick(ms: number) {
      clock += ms;
      for (const tick of ticks) tick();
      h.rerender();
    },
  };
}

test('actual OTP form has FA/EN copy, labelled tel input and no premature account creation', async () => {
  for (const locale of ['fa', 'en']) {
    const h = await otpUi(locale);
    const nodes = uiElements(h.tree()),
      input = nodes.find((node) => node.type === 'input')!;
    assert.equal(input.props.id, 'live-mobile');
    assert.equal(input.props.type, 'tel');
    assert.equal(input.props.autoComplete, 'tel');
    assert.equal(input.props.dir, 'ltr');
    assert.ok(nodes.some((node) => node.type === 'label' && node.props.htmlFor === input.props.id));
    assert.ok(
      uiText(h.tree()).includes(
        locale === 'fa' ? 'فقط پس از تأیید کد' : 'only after the code is verified',
      ),
    );
    assert.equal(h.store.snapshot().status, 'guest');
    h.unmount();
  }
  const existing = await otpUi('en', false);
  assert.ok(uiText(existing.tree()).includes('verified mobile number'));
  assert.equal(uiText(existing.tree()).includes('created'), false);
  existing.unmount();
});
test('actual request handler prevents duplicate paid sends and renders accessible code entry/countdown from server response', async () => {
  const h = await otpUi('en'),
    reply = deferred<OtpChallenge>();
  let calls = 0;
  h.request(async (input) => {
    calls++;
    assert.equal(input.mobile, '+989120000000');
    return reply.promise;
  });
  h.input('live-mobile', '۰۹۱۲۰۰۰۰۰۰۰');
  const send = h.form();
  const first = send(submit),
    second = send(submit);
  assert.equal(calls, 1);
  reply.resolve(h.challenge);
  await Promise.all([first, second]);
  h.rerender();
  await h.settle();
  const nodes = uiElements(h.tree()),
    code = nodes.find((node) => node.type === 'input')!;
  assert.equal(code.props.id, 'live-otp-code');
  assert.equal(code.props.autoComplete, 'one-time-code');
  assert.equal(code.props.inputMode, 'numeric');
  assert.equal(code.props.pattern, '[0-9]{6}');
  assert.equal(code.props.maxLength, 6);
  assert.ok(nodes.some((node) => node.type === 'label' && node.props.htmlFor === code.props.id));
  assert.ok(uiText(h.tree()).includes('accepted'));
  assert.ok(uiText(h.tree()).includes('300 seconds'));
  assert.ok(uiText(h.tree()).includes('60 seconds'));
  assert.equal(calls, 1);
  h.tick(60000);
  assert.equal(calls, 1, 'Countdown does not automatically send');
  assert.ok(uiText(h.tree()).includes('Request a new code'));
  h.unmount();
});
test('unknown delivery uses truthful copy and permits manual code verification without automatic retry', async () => {
  const h = await otpUi('en');
  h.request(async () => ({ ...h.challenge, delivery: 'unknown' }));
  h.input('live-mobile', '09120000000');
  await h.form()(submit);
  h.rerender();
  await h.settle();
  assert.ok(uiText(h.tree()).includes('Delivery is unknown'));
  assert.equal(uiText(h.tree()).includes('was delivered'), false);
  h.input('live-otp-code', '۰۰۱۲۳۴');
  assert.equal(uiElements(h.tree()).find((node) => node.type === 'input')?.props.value, '001234');
  await h.form()(submit);
  assert.equal(h.store.snapshot().status, 'member');
  assert.deepEqual(h.mfa, []);
  h.unmount();
  h.store.remote('signout');
});
test('lost request UI offers explicit same-request recovery, never a sent/delivered claim', async () => {
  const h = await otpUi('en');
  let calls = 0;
  h.request(async () => {
    calls++;
    throw new otpContract.OtpError('unknown');
  });
  h.input('live-mobile', '09120000000');
  await h.form()(submit);
  h.rerender();
  await h.settle();
  assert.equal(calls, 1);
  assert.ok(uiText(h.tree()).includes('Check the same request again'));
  assert.ok(uiElements(h.tree()).some((node) => node.props.role === 'alert'));
  assert.equal(uiText(h.tree()).includes('accepted'), false);
  h.tick(300000);
  assert.equal(calls, 1);
  h.unmount();
});
test('OTP MFA result reaches the existing second step while member state remains guest', async () => {
  const h = await otpUi('en');
  h.verify(async () => ({ ...session, requiresMfa: true }));
  h.input('live-mobile', '09120000000');
  await h.form()(submit);
  await h.settle();
  h.input('live-otp-code', '123456');
  await h.form()(submit);
  assert.equal(h.store.snapshot().status, 'guest');
  assert.equal(h.mfa.length, 1);
  assert.equal(h.mfa[0].requiresMfa, true);
  h.unmount();
});
test('actual change-number and unmount handlers fence late verify from creating a local member view', async () => {
  for (const action of ['edit', 'unmount']) {
    const h = await otpUi('en'),
      reply = deferred<CustomerSession>();
    h.verify(() => reply.promise);
    h.input('live-mobile', '09120000000');
    await h.form()(submit);
    await h.settle();
    h.input('live-otp-code', '123456');
    const verify = h.form()(submit);
    if (action === 'unmount') h.unmount();
    else {
      const change = uiElements(h.rerender()).find(
        (node) => node.type === 'button' && uiText(node).includes('Change number'),
      )!;
      (change.props.onClick as () => void)();
      h.rerender();
      assert.equal(
        uiElements(h.tree()).find((node) => node.type === 'input')?.props.id,
        'live-mobile',
      );
    }
    reply.resolve(session);
    await verify;
    assert.equal(h.store.snapshot().status, 'guest');
    assert.equal(h.mfa.length, 0);
    h.unmount();
  }
});

function connected(
  settings: {
    mobileOtp: boolean;
    emailPassword: boolean;
    usernamePassword: boolean;
    registration: boolean;
  },
  locale = 'en',
) {
  const store = {
    viewRevision: () => 1,
    snapshot: () => ({ status: 'guest', session: null, logoutPending: false }),
  };
  const h = digitalUiHarness('apps/storefront/components/account/connected-account.tsx', {
    '../auth/auth-provider': { useCustomerSession: () => ({ store, ...store.snapshot() }) },
    '../navigation/localized-link': { useRouter: () => ({ replace() {} }) },
    'next/navigation': { useSearchParams: () => new URLSearchParams() },
    '@sayman/web-shared/lib/orders/order-form.ts': { accountReturnTo: () => null },
    '@/lib/auth/customer-otp-contract': otpContract,
    '../shared/ui': { Button: 'Button' },
    '../navigation/locale-provider': {
      useI18n: () => ({ locale, t: (value: string) => value }),
      useStorefront: () => ({ authSettings: settings }),
    },
    './customer-account-workspace': { CustomerAccountWorkspace: 'CustomerAccountWorkspace' },
    '../auth/customer-otp-login': { CustomerOtpLogin: 'CustomerOtpLogin' },
  });
  h.mount('ConnectedAccount', {});
  return h;
}
test('ConnectedAccount uses only authoritative active OTP/registration flags and preserves the password fallback', () => {
  for (const registration of [true, false]) {
    const h = connected({
      mobileOtp: true,
      emailPassword: true,
      usernamePassword: true,
      registration,
    });
    const otp = uiElements(h.tree()).find((node) => node.type === 'CustomerOtpLogin')!;
    assert.equal(otp.props.registration, registration);
    const password = uiElements(h.tree()).find(
      (node) => node.type === 'button' && uiText(node).includes('Password'),
    )!;
    assert.ok(password);
    (password.props.onClick as () => void)();
    h.rerender();
    assert.ok(
      uiElements(h.tree()).some(
        (node) => node.type === 'input' && node.props.id === 'live-password',
      ),
    );
    assert.equal(
      uiElements(h.tree()).some((node) => node.type === 'CustomerOtpLogin'),
      false,
    );
    h.unmount();
  }
  const disabled = connected({
    mobileOtp: false,
    emailPassword: true,
    usernamePassword: false,
    registration: true,
  });
  assert.equal(
    uiElements(disabled.tree()).some((node) => node.type === 'CustomerOtpLogin'),
    false,
  );
  assert.ok(
    uiElements(disabled.tree()).some(
      (node) => node.type === 'input' && node.props.type === 'password',
    ),
  );
  disabled.unmount();
});
test('ConnectedAccount OTP MFA callback reveals ordinary Authenticator input without a password-only flag dependency', () => {
  const h = connected({
    mobileOtp: true,
    emailPassword: false,
    usernamePassword: false,
    registration: false,
  });
  const otp = uiElements(h.tree()).find((node) => node.type === 'CustomerOtpLogin')!;
  (otp.props.onMfa as (value: CustomerSession) => void)({ ...session, requiresMfa: true });
  h.rerender();
  const mfa = uiElements(h.tree()).find(
    (node) => node.type === 'input' && node.props.id === 'live-mfa',
  );
  assert.ok(mfa);
  assert.equal(mfa.props.autoComplete, 'one-time-code');
  assert.equal(
    uiElements(h.tree()).some((node) => node.type === 'CustomerOtpLogin'),
    false,
  );
  h.unmount();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIranMobile,
  normalizeOtpDigits,
  otpChallengeSchema,
  otpRequestSchema,
  otpVerifySchema,
  otpTiming,
  requestOtp,
  OtpError,
  type OtpChallenge,
  type OtpRequest,
  type OtpErrorKind,
} from '../lib/auth/customer-otp-contract.ts';
import { CustomerOtpFlow, type OtpVerifier } from '../lib/auth/customer-otp-flow.ts';
import { proxyAuth } from '../lib/auth/auth-proxy.ts';
import {
  CustomerSessionStore,
  SessionError,
  authRequest,
  type CustomerSession,
} from '../lib/account/customer-session.ts';

const id = 'a'.repeat(32),
  mobile = '+989120000000',
  start = Date.parse('2026-10-31T10:00:00Z'),
  challenge: OtpChallenge = {
    schemaVersion: 1,
    challengeId: id,
    expiresAt: '2026-10-31T10:05:00.0000000Z',
    resendAt: '2026-10-31T10:01:00.0000000Z',
    delivery: 'accepted',
  },
  session: CustomerSession = {
    accessToken: 'synthetic-session-token-not-persisted',
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
const kind = (expected: OtpErrorKind) => (error: unknown) =>
  error instanceof OtpError && error.kind === expected;
const lock = async <T>(run: () => Promise<T>) => run();
const guest = async () => {
  throw new SessionError('invalid');
};

test('Iran phone normalization supports Persian/Arabic digits and only explicit Iranian mobile formats', () => {
  for (const raw of [
    '۰۹۱۲۰۰۰۰۰۰۰',
    '٠٩١٢٠٠٠٠٠٠٠',
    '09120000000',
    '+989120000000',
    '00989120000000',
    ' 09120000000 ',
  ])
    assert.equal(normalizeIranMobile(raw), mobile, raw);
  for (const raw of [
    '9120000000',
    '989120000000',
    '+9719120000000',
    '02120000000',
    '0912 0000000',
    '0912-0000000',
    '091200000000',
    '0912000000',
    '０９１２０００００００',
    '09120000000\u200b',
    '+98912\n0000000',
    'x'.repeat(33),
  ])
    assert.equal(normalizeIranMobile(raw), null, raw);
  assert.equal(normalizeOtpDigits('۰٠۱١۲٢۳٣۴٤۵٥۶٦۷٧۸٨۹٩'), '00112233445566778899');
});
test('strict challenge/request contracts reject credentials, extra authority, non-UTC dates and impossible deadlines', () => {
  assert.deepEqual(otpChallengeSchema.parse(challenge), challenge);
  assert.equal(otpRequestSchema.safeParse({ mobile, requestId: id }).success, true);
  for (const value of [
    { mobile: '09120000000', requestId: id },
    { mobile, requestId: id.toUpperCase() },
    { mobile, requestId: id, userId: 'other' },
  ])
    assert.equal(otpRequestSchema.safeParse(value).success, false);
  for (const value of [
    { ...challenge, code: '123456' },
    { ...challenge, accessToken: session.accessToken },
    { ...challenge, userId: session.user.id },
    { ...challenge, delivery: 'delivered' },
    { ...challenge, schemaVersion: 2 },
    { ...challenge, expiresAt: '2026-10-31T10:05:00+00:00' },
    { ...challenge, expiresAt: '2026-02-30T10:05:00Z' },
    { ...challenge, expiresAt: '2026-10-31T10:05:00.12345678Z' },
    { ...challenge, resendAt: challenge.expiresAt },
    { ...challenge, challengeId: id + 'a' },
  ])
    assert.equal(otpChallengeSchema.safeParse(value).success, false);
  assert.equal(otpVerifySchema.safeParse({ challengeId: id, code: '001234' }).success, true);
  for (const code of ['۱۲۳۴۵۶', '12345', '1234567', '123 45', '+12345', '12345\n'])
    assert.equal(otpVerifySchema.safeParse({ challengeId: id, code }).success, false);
  assert.equal(
    otpVerifySchema.safeParse({ challengeId: id, code: '123456', mobile }).success,
    false,
  );
});
test('server timestamps drive expiry and resend boundaries without browser-created deadlines', () => {
  assert.deepEqual(otpTiming(challenge, start), { expiresIn: 300, resendIn: 60 });
  assert.deepEqual(otpTiming(challenge, start + 59999), { expiresIn: 241, resendIn: 1 });
  assert.deepEqual(otpTiming(challenge, start + 60000), { expiresIn: 240, resendIn: 0 });
  assert.deepEqual(otpTiming(challenge, start + 300000), { expiresIn: 0, resendIn: 0 });
});
test('challenge transport sends one canonical private POST independent of session/token machinery', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, '/api/auth/otp');
    assert.equal(init.method, 'POST');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'same-origin');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
      'content-type': 'application/json',
    });
    assert.deepEqual(JSON.parse(String(init.body)), { mobile, requestId: id });
    return Response.json(challenge);
  });
  assert.deepEqual(await requestOtp({ mobile, requestId: id }), challenge);
  await assert.rejects(requestOtp({ mobile: 'invalid', requestId: id }), kind('input'));
  assert.equal(calls, 1);
});
test('lost/malformed challenge responses remain unknown with no automatic send retry or false session', async (t) => {
  let calls = 0;
  for (const reply of [
    () => {
      throw new TypeError('Synthetic network failure');
    },
    () => Response.json(session),
    () => Response.json({ ...challenge, code: '123456' }),
    () => Response.json(challenge, { status: 201 }),
    () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return reply();
    });
    await assert.rejects(requestOtp({ mobile, requestId: id }), kind('unknown'));
    mocked.mock.restore();
  }
  assert.equal(calls, 5);
});
test('only safe public status mappings reach customer errors for request and verify', async (t) => {
  for (const [status, title, expected] of [
    [400, 'invalid_otp', 'input'],
    [401, 'otp_invalid', 'invalid'],
    [410, 'otp_expired', 'expired'],
    [429, 'otp_cooldown', 'cooldown'],
    [429, 'otp_rate_limited', 'limited'],
    [503, 'otp_delivery_rejected', 'unavailable'],
    [503, 'provider_private_detail', 'unavailable'],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ title, detail: 'Synthetic private detail' }, { status }),
    );
    const requestExpected =
      status === 401 || status === 410 || title === 'provider_private_detail'
        ? 'unknown'
        : expected;
    await assert.rejects(requestOtp({ mobile, requestId: id }), kind(requestExpected));
    await assert.rejects(
      authRequest('otp/verify', { challengeId: id, code: '001234' }),
      kind(expected),
    );
    mock.mock.restore();
  }
});

test('a lost BFF-to-API response becomes otp_unknown and manual recovery replays the original idempotency key without automatic retry', async (t) => {
  let attempts = 0,
    ids = 0;
  const received: OtpRequest[] = [];
  const origin = 'http://127.0.0.1:3000';
  const environment = {
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_PUBLIC_URL: origin,
    SHOP_DATA_MODE: 'api',
  };
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
    proxyAuth(
      new Request(origin + '/api/auth/otp', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: String(init.body),
      }),
      ['otp'],
      environment,
      async (_url, upstream) => {
        attempts++;
        received.push(JSON.parse(String(upstream?.body)));
        if (attempts === 1) throw new Error('Synthetic lost response after server commit');
        return Response.json(challenge);
      },
    ),
  );
  const flow = new CustomerOtpFlow(
    async () => session,
    () => 1,
    requestOtp,
    () => start,
    () => (++ids === 1 ? id : 'b'.repeat(32)),
  );
  flow.setMobile('09120000000');
  await flow.requestCode();
  assert.equal(flow.snapshot().error, 'unknown');
  assert.equal(flow.snapshot().unknownRequest, true);
  assert.equal(attempts, 1);
  assert.equal(ids, 1);
  await flow.requestCode();
  assert.equal(attempts, 2);
  assert.deepEqual(received[1], received[0]);
  assert.equal(ids, 1);
  assert.deepEqual(flow.snapshot().challenge, challenge);
});
test('generic service failures and transaction conflicts preserve recovery intent; explicit known rejection is terminal', async (t) => {
  for (const [status, title, retain] of [
    [503, 'otp_unknown', true],
    [503, 'otp_unavailable', true],
    [503, 'unavailable', true],
    [502, 'unrecognized', true],
    [409, 'transaction_conflict', true],
    [429, 'otp_cooldown', true],
    [429, 'otp_rate_limited', true],
    [503, 'otp_delivery_rejected', false],
    [400, 'invalid_otp', false],
  ] as const) {
    const requests: OtpRequest[] = [];
    let ids = 0;
    const mock = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return requests.length === 1
        ? Response.json({ title }, { status })
        : Response.json(challenge);
    });
    const flow = new CustomerOtpFlow(
      async () => session,
      () => 1,
      requestOtp,
      () => start,
      () => (++ids === 1 ? id : 'b'.repeat(32)),
    );
    flow.setMobile('09120000000');
    await flow.requestCode();
    assert.equal(requests.length, 1, 'No automatic retry');
    assert.equal(flow.snapshot().unknownRequest, retain);
    await flow.requestCode();
    assert.equal(requests[1].requestId, retain ? id : 'b'.repeat(32));
    mock.mock.restore();
  }
});

test('flow gates duplicate requests synchronously and discards a late response after phone editing', async () => {
  const reply = deferred<OtpChallenge>();
  const requests: OtpRequest[] = [];
  const flow = new CustomerOtpFlow(
    async () => session,
    () => 1,
    async (input) => {
      requests.push(input);
      return reply.promise;
    },
    () => start,
    () => id,
  );
  flow.setMobile('۰۹۱۲۰۰۰۰۰۰۰');
  const first = flow.requestCode(),
    second = flow.requestCode();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { mobile, requestId: id });
  flow.setMobile('09130000000');
  reply.resolve(challenge);
  await Promise.all([first, second]);
  assert.equal(flow.snapshot().challenge, null);
  assert.equal(flow.snapshot().mobile, '09130000000');
  assert.equal(flow.snapshot().busy, null);
});
test('unknown send recovery retains one request key in RAM and an explicit later resend gets a new key', async () => {
  let clock = start,
    attempts = 0,
    ids = 0;
  const requests: OtpRequest[] = [];
  const flow = new CustomerOtpFlow(
    async () => session,
    () => 1,
    async (input) => {
      requests.push(input);
      if (++attempts === 1) throw new OtpError('unknown');
      return challenge;
    },
    () => clock,
    () => (++ids === 1 ? id : 'b'.repeat(32)),
  );
  flow.setMobile('09120000000');
  await flow.requestCode();
  assert.equal(flow.snapshot().unknownRequest, true);
  assert.equal(attempts, 1);
  await flow.requestCode();
  assert.equal(attempts, 2);
  assert.deepEqual(requests[1], requests[0]);
  await flow.requestCode();
  assert.equal(attempts, 2);
  assert.equal(flow.snapshot().error, 'cooldown');
  clock += 60000;
  assert.equal(attempts, 2, 'Time alone never sends another message');
  await flow.requestCode();
  assert.equal(attempts, 3);
  assert.equal(requests[2].requestId, 'b'.repeat(32));
});
test('unknown delivery remains verifiable, duplicate verify is gated and leading zero/normalized digits survive', async () => {
  const response = deferred<CustomerSession>();
  let calls = 0;
  const flow = new CustomerOtpFlow(
    async (challengeId, code, current) => {
      calls++;
      assert.equal(challengeId, id);
      assert.equal(code, '001234');
      assert.equal(current(), true);
      return response.promise;
    },
    () => 1,
    async () => ({ ...challenge, delivery: 'unknown' }),
    () => start,
  );
  flow.setMobile('09120000000');
  await flow.requestCode();
  flow.setCode('۰۰١٢۳۴');
  const first = flow.verify(),
    second = flow.verify();
  assert.equal(calls, 1);
  response.resolve(session);
  assert.deepEqual(await first, session);
  assert.equal(await second, null);
  assert.equal(flow.snapshot().code, '');
  assert.equal(flow.snapshot().challenge, null);
});
test('flow refuses verification at actual expiry and clears wrong codes without guessing that a delivery failed', async () => {
  let clock = start,
    calls = 0;
  const flow = new CustomerOtpFlow(
    async () => {
      calls++;
      throw new OtpError('invalid');
    },
    () => 1,
    async () => challenge,
    () => clock,
  );
  flow.setMobile('09120000000');
  await flow.requestCode();
  flow.setCode('123456');
  await flow.verify();
  assert.equal(flow.snapshot().error, 'invalid');
  assert.equal(flow.snapshot().code, '');
  assert.deepEqual(flow.snapshot().challenge, challenge);
  clock += 300000;
  flow.setCode('123456');
  await flow.verify();
  assert.equal(flow.snapshot().error, 'expired');
  assert.equal(calls, 1);
});
test('unmount erases challenge/code/request intent and fences late verification and send responses', async () => {
  for (const phase of ['request', 'verify']) {
    const sendReply = deferred<OtpChallenge>(),
      verifyReply = deferred<CustomerSession>();
    let isCurrent: (() => boolean) | null = null;
    const verifier: OtpVerifier = async (_id, _code, current) => {
      isCurrent = current;
      return verifyReply.promise;
    };
    const flow = new CustomerOtpFlow(
      verifier,
      () => 1,
      () => (phase === 'request' ? sendReply.promise : Promise.resolve(challenge)),
      () => start,
    );
    flow.setMobile('09120000000');
    const send = flow.requestCode();
    if (phase === 'verify') await send;
    flow.setCode('123456');
    const verification = phase === 'verify' ? flow.verify() : Promise.resolve(null);
    flow.dispose();
    assert.equal(flow.snapshot().mobile, '');
    assert.equal(flow.snapshot().code, '');
    assert.equal(flow.snapshot().challenge, null);
    if (isCurrent) assert.equal((isCurrent as () => boolean)(), false);
    sendReply.resolve(challenge);
    verifyReply.resolve(session);
    await send;
    assert.equal(await verification, null);
    assert.equal(flow.snapshot().challenge, null);
  }
});
test('an identity change during send hides its late result and leaves the flow recoverable', async () => {
  let revision = 1;
  const reply = deferred<OtpChallenge>();
  const flow = new CustomerOtpFlow(
    async () => session,
    () => revision,
    () => reply.promise,
    () => start,
  );
  flow.setMobile('09120000000');
  const send = flow.requestCode();
  revision++;
  reply.resolve(challenge);
  await send;
  assert.equal(flow.snapshot().challenge, null);
  assert.equal(flow.snapshot().busy, null);
  assert.equal(flow.snapshot().error, 'changed');
});
test('an idle challenge cannot be used after logout or another identity revision', async () => {
  let revision = 1,
    calls = 0;
  const flow = new CustomerOtpFlow(
    async () => {
      calls++;
      return session;
    },
    () => revision,
    async () => challenge,
    () => start,
  );
  flow.setMobile('09120000000');
  await flow.requestCode();
  flow.setCode('123456');
  revision++;
  await flow.verify();
  assert.equal(calls, 0);
  assert.equal(flow.snapshot().challenge, null);
  assert.equal(flow.snapshot().code, '');
  assert.equal(flow.snapshot().error, 'changed');
});
test('an invalid OTP attempt may be retried on the same challenge after the store rotates its login epoch', async () => {
  let calls = 0;
  const store = new CustomerSessionStore(
    async () => {
      if (++calls === 1) throw new OtpError('invalid');
      return session;
    },
    guest,
    lock,
    () => false,
  );
  await store.restore();
  const flow = new CustomerOtpFlow(
    store.loginOtp,
    store.viewRevision,
    async () => challenge,
    () => start,
  );
  flow.setMobile('09120000000');
  await flow.requestCode();
  flow.setCode('123456');
  await flow.verify();
  assert.equal(flow.snapshot().error, 'invalid');
  assert.deepEqual(flow.snapshot().challenge, challenge);
  flow.setCode('001234');
  assert.deepEqual(await flow.verify(), session);
  assert.equal(store.snapshot().status, 'member');
  store.remote('signout');
});
test('OTP login uses the shared session lock, exact body, memory session and existing signin broadcast', async () => {
  let locked = false;
  const events: string[] = [];
  const store = new CustomerSessionStore(
    async (path, body, token) => {
      assert.equal(locked, true);
      assert.equal(path, 'otp/verify');
      assert.equal(token, undefined);
      assert.deepEqual(body, { challengeId: id, code: '001234' });
      return session;
    },
    guest,
    async (run) => {
      locked = true;
      try {
        return await run();
      } finally {
        locked = false;
      }
    },
    () => false,
    (event) => events.push(event),
  );
  await store.restore();
  await assert.rejects(store.loginOtp(id, '۱۲۳۴۵۶'), kind('input'));
  await store.loginOtp(id, '001234');
  assert.equal(store.snapshot().status, 'member');
  assert.equal(store.snapshot().session?.user.id, session.user.id);
  assert.deepEqual(events, ['signin']);
  store.remote('signout');
});
test('customer OTP MFA remains pending until ordinary Authenticator verification completes', async () => {
  const events: string[] = [];
  const store = new CustomerSessionStore(
    async (path, body, token) => {
      if (path === 'otp/verify') return { ...session, requiresMfa: true };
      assert.equal(path, 'mfa/verify');
      assert.deepEqual(body, { code: '654321' });
      assert.equal(token, session.accessToken);
      return session;
    },
    guest,
    lock,
    () => false,
    (event) => events.push(event),
  );
  await store.restore();
  const pending = await store.loginOtp(id, '123456');
  assert.equal(pending.requiresMfa, true);
  assert.equal(store.snapshot().status, 'guest');
  assert.deepEqual(events, []);
  await store.login('', '', pending.accessToken, '654321');
  assert.equal(store.snapshot().status, 'member');
  assert.deepEqual(events, ['signin']);
  store.remote('signout');
});
test('late OTP verification cannot sign in after remote logout, number edit or unmount; duplicates do not send twice', async () => {
  for (const reason of ['remote', 'edit']) {
    const reply = deferred<CustomerSession>();
    let calls = 0,
      current = true;
    const store = new CustomerSessionStore(
      async () => {
        calls++;
        return reply.promise;
      },
      guest,
      lock,
      () => false,
    );
    await store.restore();
    const task = store.loginOtp(id, '123456', () => current);
    await assert.rejects(store.loginOtp(id, '123456'), kind('limited'));
    assert.equal(calls, 1);
    if (reason === 'remote') store.remote('signout');
    else current = false;
    reply.resolve(session);
    await assert.rejects(
      task,
      (error) => error instanceof SessionError && error.kind === 'changed',
    );
    assert.equal(store.snapshot().status, 'guest');
  }
});
test('queued OTP verification observes the current guard before making a network call', async () => {
  const release = deferred<void>();
  let calls = 0,
    current = true;
  const store = new CustomerSessionStore(
    async () => {
      calls++;
      return session;
    },
    guest,
    async (run) => {
      await release.promise;
      return run();
    },
    () => false,
  );
  await store.restore();
  const task = store.loginOtp(id, '123456', () => current);
  current = false;
  release.resolve();
  await assert.rejects(task, (error) => error instanceof SessionError && error.kind === 'changed');
  assert.equal(calls, 0);
});

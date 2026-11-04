import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyAuth } from '../lib/auth/auth-proxy.ts';
const origin = 'http://127.0.0.1:3000',
  environment = {
    SHOP_API_URL: 'http://127.0.0.1:5080',
    SHOP_PUBLIC_URL: origin,
    SHOP_DATA_MODE: 'api',
  },
  id = 'a'.repeat(32),
  input = { mobile: '+989120000000', requestId: id },
  verify = { challengeId: id, code: '001234' },
  challenge = {
    schemaVersion: 1,
    challengeId: id,
    expiresAt: '2026-10-31T10:05:00.0000000Z',
    resendAt: '2026-10-31T10:01:00.0000000Z',
    delivery: 'accepted',
  },
  session = {
    accessToken: 'synthetic-access-token-not-persisted',
    expiresIn: 600,
    requiresMfa: false,
    requiresEnrollment: false,
    user: { id: 'synthetic-owner', displayName: 'Synthetic', userName: 'synthetic' },
  };
const request = (
  path = 'otp',
  body: unknown = input,
  headers: Record<string, string> = {},
  method = 'POST',
) =>
  new Request(origin + '/api/auth/' + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
const never: typeof fetch = async () => {
  throw new Error('No upstream call expected');
};
function privateResponse(response: Response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
}

test('auth proxy adds only exact OTP routes and keeps mutations origin-bound and private', async () => {
  for (const [path, method, headers, expected] of [
    ['otp', 'GET', {}, 404],
    ['otp/verify', 'GET', {}, 404],
    ['otp/send', 'POST', {}, 404],
    ['otp/verify/extra', 'POST', {}, 404],
    ['../admin', 'POST', {}, 404],
    ['otp', 'POST', { Origin: 'https://other.example' }, 403],
    ['otp/verify', 'POST', { Origin: '' }, 403],
    ['otp', 'POST', { 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['otp', 'POST', { 'Content-Type': 'text/plain' }, 415],
    ['otp', 'POST', { 'Content-Length': '16001' }, 413],
  ] as const) {
    const response = await proxyAuth(
      request(path, input, headers, method),
      path.split('/'),
      environment,
      never,
    );
    assert.equal(response.status, expected);
    privateResponse(response);
  }
  for (const settings of [
    { ...environment, SHOP_DATA_MODE: 'preview' },
    { ...environment, SHOP_API_URL: undefined },
  ])
    assert.equal((await proxyAuth(request(), ['otp'], settings, never)).status, 503);
});
test('OTP BFF rejects extra authority, noncanonical phones/codes, malformed JSON, queries and streamed over-capacity bodies', async () => {
  for (const [path, body] of [
    ['otp', { ...input, userId: 'other' }],
    ['otp', { ...input, mobile: '09120000000' }],
    ['otp', { ...input, templateId: 123456 }],
    ['otp', { ...input, requestId: id + '\n' }],
    ['otp/verify', { ...verify, code: '123456\n' }],
    ['otp/verify', { ...verify, code: '۱۲۳۴۵۶' }],
    ['otp/verify', { ...verify, userId: 'other' }],
    ['otp/verify', { ...verify, mobile: input.mobile }],
  ] as const)
    assert.equal(
      (await proxyAuth(request(path, body), path.split('/'), environment, never)).status,
      400,
    );
  const malformed = new Request(origin + '/api/auth/otp', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{bad',
  });
  assert.equal((await proxyAuth(malformed, ['otp'], environment, never)).status, 400);
  assert.equal(
    (await proxyAuth(request('otp?code=123456'), ['otp'], environment, never)).status,
    400,
  );
  assert.equal(
    (await proxyAuth(request('otp', { payload: 'x'.repeat(16001) }), ['otp'], environment, never))
      .status,
    413,
  );
});
test('OTP BFF forwards exactly one canonical POST with no bearer, cookies, forged IP or staff headers', async () => {
  for (const path of ['otp', 'otp/verify']) {
    let calls = 0;
    const body = path === 'otp' ? input : verify;
    const response = await proxyAuth(
      request(path, body, {
        Authorization: 'Bearer must-not-forward',
        Cookie: 'sayman_refresh=corrupt; other=private',
        'X-Forwarded-For': '198.51.100.1',
        'X-Real-IP': '198.51.100.2',
        'X-Sayman-Admin': '1',
        Forwarded: 'for=198.51.100.3',
      }),
      path.split('/'),
      environment,
      async (url, init) => {
        calls++;
        assert.equal(url, environment.SHOP_API_URL + '/api/auth/' + path);
        assert.equal(init?.method, 'POST');
        assert.equal(init?.cache, 'no-store');
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.credentials, 'omit');
        assert.ok(init?.signal instanceof AbortSignal);
        assert.deepEqual(Object.fromEntries(new Headers(init?.headers)), {
          'content-type': 'application/json',
          origin,
          'x-sayman-client': 'storefront',
        });
        assert.deepEqual(JSON.parse(String(init?.body)), body);
        return Response.json(path === 'otp' ? challenge : session);
      },
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    privateResponse(response);
  }
});
test('challenge BFF exposes only strict public challenge metadata and never forwards cookies or identity credentials', async () => {
  for (const reply of [
    () => Response.json({ ...challenge, code: '123456' }),
    () => Response.json({ ...challenge, accessToken: session.accessToken }),
    () => Response.json({ ...challenge, userId: 'synthetic-owner' }),
    () => Response.json({ ...challenge, delivery: 'delivered' }),
    () => Response.json(challenge, { status: 201 }),
    () => new Response(null, { status: 204 }),
    () => new Response(JSON.stringify(challenge), { headers: { 'Content-Type': 'text/plain' } }),
    () =>
      Response.json(challenge, {
        headers: { 'Set-Cookie': 'sayman_refresh=' + 'b'.repeat(64) + '; Max-Age=300' },
      }),
    () => new Response('x'.repeat(32769)),
  ]) {
    const response = await proxyAuth(request(), ['otp'], environment, async () => reply());
    assert.equal(response.status, 503);
    assert.equal(response.headers.has('Set-Cookie'), false);
    assert.deepEqual(await response.json(), { title: 'otp_unknown' });
    privateResponse(response);
  }
});
test('verify BFF retains safe refresh cookie handling and customer DTO projection including pending MFA', async () => {
  for (const requiresMfa of [false, true]) {
    const value = {
      ...session,
      requiresMfa,
      refreshToken: 'must-not-leak',
      user: { ...session.user, permissions: ['staff'], phoneNumber: 'must-not-leak' },
    };
    const response = await proxyAuth(
      request('otp/verify', verify),
      ['otp', 'verify'],
      environment,
      async () =>
        Response.json(value, {
          headers: {
            'Set-Cookie': 'sayman_refresh=' + 'b'.repeat(64) + '; Path=/wrong; Max-Age=300',
          },
        }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...session, requiresMfa });
    assert.equal(
      response.headers.get('Set-Cookie'),
      'sayman_refresh=' +
        'b'.repeat(64) +
        '; Path=/api/auth; Max-Age=300; HttpOnly; SameSite=Strict',
    );
    privateResponse(response);
  }
  const invalid = await proxyAuth(
    request('otp/verify', verify),
    ['otp', 'verify'],
    environment,
    async () => Response.json(session, { headers: { 'Set-Cookie': 'foreign=bad' } }),
  );
  assert.equal(invalid.status, 503);
  assert.equal(invalid.headers.has('Set-Cookie'), false);
});
test('OTP BFF whitelists only public status-matched error codes and a bounded Retry-After, without provider details', async () => {
  for (const [status, title, expected] of [
    [400, 'invalid_otp', 'invalid_otp'],
    [401, 'otp_invalid', 'otp_invalid'],
    [410, 'otp_expired', 'otp_expired'],
    [429, 'otp_cooldown', 'otp_cooldown'],
    [429, 'otp_rate_limited', 'otp_rate_limited'],
    [503, 'otp_unavailable', 'otp_unavailable'],
    [503, 'otp_delivery_rejected', 'otp_delivery_rejected'],
    [401, 'otp_cooldown', 'invalid_credentials'],
    [500, 'private_provider_detail', 'unavailable'],
  ] as const) {
    const response = await proxyAuth(
      request('otp/verify', verify),
      ['otp', 'verify'],
      environment,
      async () =>
        Response.json(
          { title, detail: 'must-not-leak', apiKey: 'must-not-leak' },
          { status, headers: { 'Retry-After': '60' } },
        ),
    );
    assert.equal(response.status, status === 500 ? 503 : status);
    assert.deepEqual(await response.json(), { title: expected });
    assert.equal(response.headers.get('Retry-After'), status === 429 ? '60' : null);
    privateResponse(response);
  }
  for (const retry of ['999999', '-1', '0', 'later', 'Sun, 01 Nov 2026 00:00:00 GMT']) {
    const response = await proxyAuth(request(), ['otp'], environment, async () =>
      Response.json({ title: 'otp_cooldown' }, { status: 429, headers: { 'Retry-After': retry } }),
    );
    assert.equal(response.headers.has('Retry-After'), false);
  }
});
test('upstream exceptions never retry, set cookies or reveal a raw failure', async () => {
  let calls = 0;
  const response = await proxyAuth(request(), ['otp'], environment, async () => {
    calls++;
    throw new Error('Synthetic secret failure');
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 503);
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.deepEqual(await response.json(), { title: 'otp_unknown' });
  privateResponse(response);
});
test('legacy password/MFA/refresh/logout routes retain refresh-cookie and bearer behavior', async () => {
  for (const path of ['password', 'mfa/verify', 'refresh', 'logout']) {
    const cookie = 'a'.repeat(64);
    const response = await proxyAuth(
      request(
        path,
        {},
        {
          Authorization: 'Bearer synthetic-existing-token',
          Cookie: 'sayman_refresh=' + cookie + '; unrelated=not-forwarded',
        },
      ),
      path.split('/'),
      environment,
      async (_url, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('Authorization'), 'Bearer synthetic-existing-token');
        assert.equal(headers.get('Cookie'), 'sayman_refresh=' + cookie);
        return path === 'logout' ? new Response(null, { status: 204 }) : Response.json(session);
      },
    );
    assert.equal(response.status, path === 'logout' ? 204 : 200);
    privateResponse(response);
  }
});

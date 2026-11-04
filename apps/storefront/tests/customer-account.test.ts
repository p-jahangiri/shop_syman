import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerAccountProfileSchema,
  updateCustomerProfileSchema,
  changeCustomerPasswordSchema,
  isCustomerAccountPath,
} from '../lib/account/customer-account-contract.ts';
import {
  CustomerAccountError,
  readCustomerAccount,
  updateCustomerProfile,
  changeCustomerPassword,
} from '../lib/account/customer-account-client.ts';
import { proxyCustomerAccount } from '../lib/account/customer-account-proxy.ts';

const owner = 'a'.repeat(32),
  origin = 'https://shop.example',
  bearer = 'Bearer ' + 'synthetic-account-token-'.repeat(2),
  profile = {
    id: owner,
    userName: 'synthetic-customer',
    displayName: 'نام آزمایشی',
    email: 'synthetic@example.test',
    emailConfirmed: true,
    phoneNumber: null,
    phoneNumberConfirmed: false,
    createdAt: '2026-10-30T00:00:00.1234567Z',
    passwordEnabled: true,
    twoFactorEnabled: false,
    version: 'synthetic-version-1',
  },
  environment = {
    SHOP_API_URL: 'https://api.example',
    SHOP_PUBLIC_URL: origin,
    SHOP_DATA_MODE: 'api',
  },
  password = { currentPassword: 'Current!Password42', newPassword: 'New!Password43' },
  update = { displayName: 'نام تازهٔ آزمایشی', version: profile.version },
  never: typeof fetch = async () => {
    throw Error('No upstream call allowed');
  };
function request(
  method = 'GET',
  path = '/api/account/profile',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(origin + path, {
    method,
    headers: {
      Origin: origin,
      Authorization: bearer,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('customer account contracts retain UTC and Unicode while rejecting hidden, privileged and oversized fields', () => {
  assert.deepEqual(customerAccountProfileSchema.parse(profile), profile);
  assert.equal(updateCustomerProfileSchema.safeParse(update).success, true);
  assert.equal(changeCustomerPasswordSchema.safeParse(password).success, true);
  assert.equal(
    customerAccountProfileSchema.safeParse({ ...profile, displayName: '' }).success,
    true,
  );
  assert.equal(
    updateCustomerProfileSchema.safeParse({ ...update, displayName: '' }).success,
    false,
  );
  for (const value of [
    { ...profile, securityStamp: 'hidden' },
    { ...profile, roles: ['Administrator'] },
    { ...profile, createdAt: '2026-10-30T03:30:00+03:30' },
    { ...profile, version: 'x'.repeat(129) },
    { ...profile, email: 'address\n@example.test' },
    { ...profile, phoneNumber: '+98\u202e123' },
  ])
    assert.equal(customerAccountProfileSchema.safeParse(value).success, false);
  for (const value of [
    { ...update, displayName: ' نام ' },
    { ...update, displayName: '' },
    { ...update, displayName: 'a'.repeat(201) },
    { ...update, displayName: 'x\u0000x' },
    { ...update, displayName: 'x\u202ex' },
    { ...update, displayName: '\ud800' },
    { ...update, emailConfirmed: true },
    { ...update, id: 'b'.repeat(32) },
    { ...update, twoFactorEnabled: false },
  ])
    assert.equal(updateCustomerProfileSchema.safeParse(value).success, false);
  for (const value of [
    { ...password, currentPassword: '' },
    { ...password, currentPassword: 'a'.repeat(129) },
    { ...password, newPassword: 'a'.repeat(11) },
    { ...password, newPassword: 'a'.repeat(129) },
    { ...password, ownerId: owner },
  ])
    assert.equal(changeCustomerPasswordSchema.safeParse(value).success, false);
});

test('account proxy permits only HTTPS or explicit loopback HTTP API origins', async () => {
  for (const api of ['http://api.example', 'http://10.0.0.1:5080', 'http://127.0.0.1.evil.example'])
    assert.equal(
      (
        await proxyCustomerAccount(
          request(),
          ['profile'],
          { ...environment, SHOP_API_URL: api },
          never,
        )
      ).status,
      503,
    );
  for (const api of [
    'http://127.0.0.1:5080',
    'http://localhost:5080',
    'http://[::1]:5080',
    'https://api.example',
  ]) {
    let calls = 0;
    const response = await proxyCustomerAccount(
      request(),
      ['profile'],
      { ...environment, SHOP_API_URL: api },
      async (url) => {
        calls++;
        assert.equal(url, api + '/api/account/profile');
        return Response.json(profile);
      },
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  }
});

test('account command parsing rejects duplicate raw or escaped keys before normalization', async () => {
  for (const [method, path, raw] of [
    ['PUT', 'profile', '{"displayName":"old","displayName":"new","version":"v"}'],
    ['PUT', 'profile', '{"displayName":"old","display\\u004eame":"new","version":"v"}'],
    ['PUT', 'profile', '{"displayName":"new","version":"v1","version":"v2"}'],
    [
      'POST',
      'password',
      '{"currentPassword":"secret","currentPassword":"override","newPassword":"New!Password43"}',
    ],
    [
      'POST',
      'password',
      '{"currentPassword":"secret","newPassword":"New!Password43","new\\u0050assword":"Other!Password44"}',
    ],
  ]) {
    const req = new Request(origin + '/api/account/' + path, {
      method,
      headers: { Origin: origin, Authorization: bearer, 'Content-Type': 'application/json' },
      body: raw,
    });
    assert.equal((await proxyCustomerAccount(req, [path], environment, never)).status, 400);
  }
  const punctuation = { currentPassword: 'old"\\\nSecret42!', newPassword: 'new"\\\nSecret43!' };
  const success = await proxyCustomerAccount(
    request('POST', '/api/account/password', punctuation),
    ['password'],
    environment,
    async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), punctuation);
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(success.status, 204);
});

test('password204 accepts actual expired refresh-cookie deletions while dropping cookie headers and rejecting credential cookies', async () => {
  const actual = new Headers();
  actual.append(
    'Set-Cookie',
    '__Host-sayman_refresh=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=strict; httponly',
  );
  actual.append(
    'Set-Cookie',
    'sayman_refresh=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/api/auth; secure; samesite=strict; httponly',
  );
  for (const cookies of [
    actual,
    new Headers({
      'Set-Cookie': '__Host-sayman_refresh=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    }),
  ]) {
    const response = await proxyCustomerAccount(
      request('POST', '/api/account/password', password),
      ['password'],
      environment,
      async () => new Response(null, { status: 204, headers: cookies }),
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.has('Set-Cookie'), false);
    assert.equal(await response.text(), '');
  }
  const localDeletion = await proxyCustomerAccount(
    request('POST', '/api/account/password', password),
    ['password'],
    { ...environment, SHOP_PUBLIC_URL: 'http://127.0.0.1:3000' },
    never,
  );
  assert.equal(
    localDeletion.status,
    403,
    'Origin remains required even for valid local infrastructure',
  );
  for (const cookie of [
    '__Host-sayman_refresh=' + 'a'.repeat(64) + '; Path=/; Secure; Max-Age=600; SameSite=Strict',
    '__Host-sayman_refresh=; Path=/; Secure; Max-Age=600; SameSite=Strict',
    '__Host-sayman_refresh=; Path=/; Max-Age=0; SameSite=Strict',
    '__Host-sayman_refresh=; Path=/; Secure; Max-Age=0; Domain=example',
    'sayman_admin_refresh=; Path=/; Secure; Max-Age=0',
    'unrelated=; Path=/; Max-Age=0',
    '__Host-sayman_refresh=; Path=/; Secure; Expires=Thu, 01 Jan 2099 00:00:00 GMT',
  ]) {
    const response = await proxyCustomerAccount(
      request('POST', '/api/account/password', password),
      ['password'],
      environment,
      async () => new Response(null, { status: 204, headers: { 'Set-Cookie': cookie } }),
    );
    assert.equal(response.status, 503, cookie.split(';')[0]);
  }
});

test('private account path grammar allows only exact profile reads/name updates and password command', () => {
  for (const [path, method] of [
    ['/api/account/profile', 'GET'],
    ['/api/account/profile', 'PUT'],
    ['/api/account/password', 'POST'],
  ])
    assert.equal(isCustomerAccountPath(path, method), true);
  for (const [path, method] of [
    ['/api/account/profile', 'POST'],
    ['/api/account/profile', 'PATCH'],
    ['/api/account/password', 'GET'],
    ['/api/account/password', 'PUT'],
    ['/api/account/profile/', 'GET'],
    ['/api/account/profile?owner=' + owner, 'GET'],
    ['/api/account/profile#private', 'GET'],
    ['/api/account/profile/../password', 'POST'],
    ['/api/account/%70rofile', 'GET'],
    ['https://evil.example/api/account/profile', 'GET'],
  ])
    assert.equal(isCustomerAccountPath(path, method), false, path);
});

test('account proxy denies unconfigured, forged routes and incorrect methods before fetching', async () => {
  assert.equal(
    (
      await proxyCustomerAccount(
        request(),
        ['profile'],
        { ...environment, SHOP_DATA_MODE: 'preview' },
        never,
      )
    ).status,
    503,
  );
  for (const api of [
    'https://user:secret@api.example',
    'https://api.example/admin',
    'https://api.example?query=1',
    'file:///tmp/private',
  ])
    assert.equal(
      (
        await proxyCustomerAccount(
          request(),
          ['profile'],
          { ...environment, SHOP_API_URL: api },
          never,
        )
      ).status,
      503,
    );
  for (const [req, path] of [
    [request('GET', '/api/account/profile?owner=' + owner), ['profile']],
    [request('GET', '/api/account/profile'), ['password']],
    [request('POST', '/api/account/profile', {}), ['profile']],
    [request('GET', '/api/account/password'), ['password']],
    [request('GET', '/api/account/profile/'), ['profile']],
  ] as const)
    assert.equal((await proxyCustomerAccount(req, [...path], environment, never)).status, 404);
});

test('account proxy requires private bearer and same origin for mutations, and rejects cross-site reads', async () => {
  assert.equal(
    (
      await proxyCustomerAccount(
        request('GET', undefined, undefined, { Authorization: '' }),
        ['profile'],
        environment,
        never,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await proxyCustomerAccount(
        request('GET', undefined, undefined, { 'Sec-Fetch-Site': 'cross-site' }),
        ['profile'],
        environment,
        never,
      )
    ).status,
    403,
  );
  for (const supplied of ['', 'https://evil.example', origin + '/'])
    assert.equal(
      (
        await proxyCustomerAccount(
          request('PUT', undefined, update, { Origin: supplied }),
          ['profile'],
          environment,
          never,
        )
      ).status,
      403,
    );
  assert.equal(
    (
      await proxyCustomerAccount(
        request('GET', undefined, undefined, { Origin: 'https://evil.example' }),
        ['profile'],
        environment,
        never,
      )
    ).status,
    403,
  );
});

test('account proxy checks JSON, bounded request bytes and strict name-only/password bodies', async () => {
  for (const [method, path, body, headers, expected] of [
    ['PUT', 'profile', update, { 'Content-Type': 'text/plain' }, 415],
    ['PUT', 'profile', { ...update, email: 'changed@example.test' }, {}, 400],
    ['PUT', 'profile', { ...update, displayName: 'a'.repeat(4100) }, {}, 413],
    ['POST', 'password', { ...password, userId: owner }, {}, 400],
    ['POST', 'password', { ...password, newPassword: 'short' }, {}, 400],
    ['POST', 'password', password, { 'Content-Length': '4100' }, 413],
  ] as const)
    assert.equal(
      (
        await proxyCustomerAccount(
          request(method, '/api/account/' + path, body, headers),
          [path],
          environment,
          never,
        )
      ).status,
      expected,
    );
  const malformed = new Request(origin + '/api/account/profile', {
    method: 'PUT',
    headers: { Origin: origin, Authorization: bearer, 'Content-Type': 'application/json' },
    body: '{broken',
  });
  assert.equal(
    (await proxyCustomerAccount(malformed, ['profile'], environment, never)).status,
    400,
  );
});

test('account profile proxy forwards only private authority and strict input with no cookies/cache/redirect', async () => {
  for (const method of ['GET', 'PUT']) {
    let calls = 0;
    const value =
        method === 'GET'
          ? profile
          : { ...profile, displayName: update.displayName, version: 'new' },
      result = await proxyCustomerAccount(
        request(method, undefined, method === 'PUT' ? update : undefined, {
          Cookie: 'must-not-forward=private',
          'X-Sayman-Admin': '1',
        }),
        ['profile'],
        environment,
        async (url, init) => {
          calls++;
          assert.equal(url, 'https://api.example/api/account/profile');
          assert.equal(init?.method, method);
          assert.equal(init?.credentials, 'omit');
          assert.equal(init?.cache, 'no-store');
          assert.equal(init?.redirect, 'error');
          assert.ok(init?.signal instanceof AbortSignal);
          const headers = new Headers(init?.headers);
          assert.equal(headers.get('Authorization'), bearer);
          assert.equal(headers.get('Origin'), origin);
          assert.equal(headers.get('X-Sayman-Client'), 'storefront');
          assert.equal(headers.has('Cookie'), false);
          assert.equal(headers.has('X-Sayman-Admin'), false);
          assert.equal(init?.body, method === 'PUT' ? JSON.stringify(update) : undefined);
          return Response.json(value);
        },
      );
    assert.equal(calls, 1);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), value);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(result.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    assert.equal(result.headers.get('Vary'), 'Cookie, Authorization');
  }
});

test('password proxy accepts only empty204 and withholds cookies, malformed success and private raw service errors', async () => {
  const send = (reply: () => Response) =>
    proxyCustomerAccount(
      request('POST', '/api/account/password', password),
      ['password'],
      environment,
      async () => reply(),
    );
  const success = await send(() => new Response(null, { status: 204 }));
  assert.equal(success.status, 204);
  assert.equal(await success.text(), '');
  for (const reply of [
    () => Response.json({ changed: true }),
    () => new Response(null, { status: 204, headers: { 'Set-Cookie': 'private=secret' } }),
    () => new Response('x'.repeat(16385)),
  ])
    assert.equal((await send(reply)).status, 503);
  for (const status of [400, 401, 403, 409, 429, 500]) {
    const reply = await send(() =>
      Response.json(
        {
          title: 'invalid_current_password',
          detail: 'must-not-leak',
          passwordHash: 'must-not-leak',
        },
        { status },
      ),
    );
    assert.equal(reply.status, status === 500 ? 503 : status);
    assert.deepEqual(await reply.json(), { title: 'invalid_current_password' });
  }
});

test('profile proxy rejects authentication fields, bad content type and over-capacity upstream data', async () => {
  for (const reply of [
    () => Response.json({ ...profile, refreshToken: 'private' }),
    () => Response.json({ ...profile, permissions: ['staff'] }),
    () => Response.json(profile, { status: 201 }),
    () => new Response(JSON.stringify(profile), { headers: { 'Content-Type': 'text/plain' } }),
    () => Response.json(profile, { headers: { 'Set-Cookie': 'refresh=private' } }),
    () => Response.json(profile, { headers: { 'Content-Length': '16385' } }),
    () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
  ])
    assert.equal(
      (await proxyCustomerAccount(request(), ['profile'], environment, async () => reply())).status,
      503,
    );
});

test('account clients validate the exact owner after reading JSON and never accept another owner update', async () => {
  assert.deepEqual(
    await readCustomerAccount(async (path, init) => {
      assert.equal(path, '/api/account/profile');
      assert.equal(init.method, 'GET');
      return Response.json(profile);
    }, owner),
    profile,
  );
  for (const receive of [
    async () => Response.json({ ...profile, id: 'b'.repeat(32) }),
    async () => Response.json({ ...profile, accessToken: 'private' }),
    async () => new Response('a'.repeat(16385)),
  ])
    await assert.rejects(
      readCustomerAccount(receive, owner),
      (error) => error instanceof CustomerAccountError && error.status === 503,
    );
  const changed = { ...profile, displayName: update.displayName };
  assert.deepEqual(
    await updateCustomerProfile(
      async (path, init) => {
        assert.equal(path, '/api/account/profile');
        assert.equal(init.method, 'PUT');
        assert.deepEqual(JSON.parse(String(init.body)), update);
        return Response.json(changed);
      },
      owner,
      update,
    ),
    changed,
  );
  await assert.rejects(
    updateCustomerProfile(async () => Response.json(profile), owner, update),
    CustomerAccountError,
  );
});

test('password client never retries rejected or unknown commands, preserving status and sending no confirmation or owner', async () => {
  let calls = 0;
  await changeCustomerPassword(async (path, init) => {
    calls++;
    assert.equal(path, '/api/account/password');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), password);
    return new Response(null, { status: 204 });
  }, password);
  assert.equal(calls, 1);
  for (const status of [400, 409, 429, 503]) {
    calls = 0;
    await assert.rejects(
      changeCustomerPassword(async () => {
        calls++;
        return Response.json({ title: 'invalid_current_password' }, { status });
      }, password),
      (error) =>
        error instanceof CustomerAccountError &&
        error.status === status &&
        error.code === 'invalid_current_password',
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    changeCustomerPassword(async () => Response.json({ done: true }), password),
    CustomerAccountError,
  );
});

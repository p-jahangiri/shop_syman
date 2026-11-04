import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PhoneReadError,
  readPhonePage,
  readPhoneItem,
  proxyPhones,
} from '../lib/market/phone-discovery-http.ts';
import {
  phoneTestId as config,
  phoneTestOtherId as other,
  phoneTestItem as item,
  phoneTestPage as page,
  phoneTestInterest as interest,
  phoneTestResult as result,
  phoneTestInterestPage as interests,
  phoneTestCommandId as command,
} from './phone-discovery.test-fixtures.ts';
const origin = 'http://sayman-ui.localhost:3107',
  env = { SHOP_API_URL: 'http://127.0.0.1:5080', SHOP_DATA_MODE: 'api', SHOP_PUBLIC_URL: origin },
  bearer = 'Bearer ' + 'a'.repeat(40);
function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(origin + '/api/phones/' + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Authorization: bearer,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const never: typeof fetch = async () => {
  throw Error('Upstream must not be reached');
};
const writePath = 'interests/' + item.id + '/commands/' + command,
  input = { configurationId: config, active: true, version: null };

test('phone BFF permits only exact public/private methods, routes and bounded query state', async () => {
  for (const [method, path] of [
    ['GET', 'fa/search'],
    ['POST', 'fa/' + item.id],
    ['POST', 'interests'],
    ['DELETE', 'interests/' + item.id + '/' + config],
    ['GET', 'interests/commands/' + config],
    ['PUT', writePath + '/extra'],
    ['GET', 'xx/' + item.id],
  ])
    assert.equal(
      (await proxyPhones(request(method, path), path.split('/'), env, never)).status,
      404,
      path,
    );
  for (const suffix of [
    '?owner=' + other,
    '?cursor=' + config + '&cursor=' + other,
    '?cursor=',
    '?cursor=BAD',
  ])
    assert.equal(
      (await proxyPhones(request('GET', 'interests' + suffix), ['interests'], env, never)).status,
      400,
      suffix,
    );
  assert.equal(
    (
      await proxyPhones(
        request('GET', 'interests/' + item.id + '/' + config + '?cursor=' + config),
        ['interests', item.id, config],
        env,
        never,
      )
    ).status,
    400,
  );
  assert.equal(
    (await proxyPhones(request('POST', 'fa/search?ram=8', {}), ['fa', 'search'], env, never))
      .status,
    400,
  );
});

test('private phone reads and writes require bearer authority and exact Origin without cookie fallback', async () => {
  for (const auth of ['', 'Bearer short', 'Basic ' + 'a'.repeat(40), 'Bearer a b c'])
    assert.equal(
      (
        await proxyPhones(
          request('GET', 'interests', undefined, {
            Authorization: auth,
            Cookie: 'session=private',
          }),
          ['interests'],
          env,
          never,
        )
      ).status,
      401,
    );
  for (const supplied of ['', 'https://other.example', 'null'])
    assert.equal(
      (
        await proxyPhones(
          request('PUT', writePath, input, { Origin: supplied }),
          writePath.split('/'),
          env,
          never,
        )
      ).status,
      403,
    );
  assert.equal(
    (
      await proxyPhones(
        request('GET', 'interests', undefined, { Origin: 'https://other.example' }),
        ['interests'],
        env,
        never,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await proxyPhones(
        request('GET', 'interests'),
        ['interests'],
        { ...env, SHOP_PUBLIC_URL: undefined },
        never,
      )
    ).status,
    503,
  );
  const noOrigin = request('GET', 'interests');
  noOrigin.headers.delete('Origin');
  assert.equal(
    (await proxyPhones(noOrigin, ['interests'], env, async () => Response.json(interests))).status,
    200,
  );
});

test('anonymous phone discovery forwards no private authority and rejects cookie-setting upstream responses', async () => {
  const response = await proxyPhones(
    request(
      'POST',
      'fa/search',
      { ramGb: 8 },
      { Cookie: 'session=secret', 'X-Sayman-Admin': 'true', 'X-Forwarded-For': 'forged' },
    ),
    ['fa', 'search'],
    env,
    async (url, init) => {
      assert.equal(url, env.SHOP_API_URL + '/api/phones/fa/search');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init?.body)), { ramGb: 8, page: 1, pageSize: 12 });
      const h = new Headers(init?.headers);
      for (const key of [
        'Cookie',
        'Authorization',
        'Origin',
        'Host',
        'X-Sayman-Admin',
        'X-Forwarded-For',
      ])
        assert.equal(h.has(key), false, key);
      return Response.json(page, {
        headers: { Location: 'https://unsafe.example', 'Cache-Control': 'public' },
      });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.has('Set-Cookie'), false);
  assert.equal(response.headers.has('Location'), false);
  const cookies = await proxyPhones(
    request('POST', 'fa/search', {}),
    ['fa', 'search'],
    env,
    async () => Response.json(page, { headers: { 'Set-Cookie': 'new=private' } }),
  );
  assert.equal(cookies.status, 503);
  assert.equal(cookies.headers.has('Set-Cookie'), false);
});

test('private phone proxy forwards only bearer and configured storefront origin and returns private headers', async () => {
  const response = await proxyPhones(
    request('GET', 'interests?cursor=' + config, undefined, {
      Cookie: 'session=secret',
      'X-Sayman-Admin': 'true',
    }),
    ['interests'],
    env,
    async (url, init) => {
      assert.equal(url, env.SHOP_API_URL + '/api/phones/interests?cursor=' + config);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.body, undefined);
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), bearer);
      assert.equal(headers.get('Origin'), origin);
      assert.equal(headers.get('X-Sayman-Client'), 'storefront');
      for (const name of ['Cookie', 'Host', 'X-Sayman-Admin'])
        assert.equal(headers.has(name), false);
      return Response.json(interests);
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Cookie, Authorization');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  for (const status of [401, 403, 404, 409, 429]) {
    const denied = await proxyPhones(request('GET', 'interests'), ['interests'], env, async () =>
      Response.json({ detail: 'private diagnostics', userId: other }, { status }),
    );
    assert.equal(denied.status, status);
    assert.equal(JSON.stringify(await denied.json()).includes('diagnostics'), false);
    assert.equal(denied.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('phone writes reject injected ownership, price, source fields and non-JSON or oversized bodies before upstream', async () => {
  for (const extra of [
    { owner: other },
    { userId: other },
    { priceRial: '1' },
    { sourceUrl: 'https://private.example' },
    { canPay: true },
    { configurationId: 'invalid' },
  ])
    assert.equal(
      (
        await proxyPhones(
          request('PUT', writePath, { ...input, ...extra }),
          writePath.split('/'),
          env,
          never,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await proxyPhones(
        request('PUT', writePath, input, { 'Content-Type': 'text/plain' }),
        writePath.split('/'),
        env,
        never,
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await proxyPhones(
        request('PUT', writePath, input, { 'Content-Length': '4097' }),
        writePath.split('/'),
        env,
        never,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await proxyPhones(
        request('PUT', writePath, { ...input, extra: 'x'.repeat(4097) }),
        writePath.split('/'),
        env,
        never,
      )
    ).status,
    413,
  );
  const malformed = new Request(origin + '/api/phones/' + writePath, {
    method: 'PUT',
    headers: { Origin: origin, Authorization: bearer, 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal((await proxyPhones(malformed, writePath.split('/'), env, never)).status, 400);
});

test('phone page and item reads bind locale, pagination, brand and the whole selected configuration', async () => {
  const call = (value: unknown, q = {}) =>
    readPhonePage('fa', q, env, async () => Response.json(value));
  assert.equal(
    (await call(page, { brandId: 'samsung', ramGb: 8, storageGb: 256, colorKey: 'black' })).items
      .length,
    1,
  );
  for (const value of [
    { ...page, locale: 'en' },
    { ...page, page: 2 },
    { ...page, pageSize: 6 },
    { ...page, sourceName: 'private' },
  ])
    await assert.rejects(call(value), PhoneReadError);
  for (const q of [{ brandId: 'other' }, { ramGb: 12 }, { storageGb: 512 }, { colorKey: 'blue' }])
    await assert.rejects(call(page, q), PhoneReadError);
  const separate = {
    ...page,
    items: [
      {
        ...item,
        configurations: [
          { ...item.configurations[0], storageGb: 512 },
          { ...item.configurations[0], id: other, ramGb: 12 },
        ],
      },
    ],
  };
  await assert.rejects(call(separate, { ramGb: 8, storageGb: 256 }), PhoneReadError);
  assert.equal(
    (await readPhoneItem('fa', item.id, env, async () => Response.json(item))).id,
    item.id,
  );
  await assert.rejects(
    readPhoneItem('fa', 'another-listing', env, async () => Response.json(item)),
    PhoneReadError,
  );
});

test('private target reads and command results reject foreign echoes and wrong frozen operation state', async () => {
  const target = ['interests', item.id, config];
  assert.equal(
    (
      await proxyPhones(request('GET', target.join('/')), target, env, async () =>
        Response.json(interest),
      )
    ).status,
    200,
  );
  for (const value of [
    { ...interest, listingId: 'foreign' },
    { ...interest, configuration: { ...interest.configuration, id: other } },
  ])
    assert.equal(
      (
        await proxyPhones(request('GET', target.join('/')), target, env, async () =>
          Response.json(value),
        )
      ).status,
      503,
    );
  const wrong = [
    { ...result, requestId: '12345678-1234-4234-8234-123456789abc' },
    { ...result, interest: { ...interest, listingId: 'foreign' } },
    {
      ...result,
      interest: { ...interest, configuration: { ...interest.configuration, id: other } },
    },
    { ...result, interest: { ...interest, state: 'Cancelled' } },
    { ...result, canPay: true },
  ];
  for (const value of wrong)
    assert.equal(
      (
        await proxyPhones(request('PUT', writePath, input), writePath.split('/'), env, async () =>
          Response.json(value),
        )
      ).status,
      503,
    );
  assert.equal(
    (
      await proxyPhones(
        request('PUT', writePath, { ...input, active: false }),
        writePath.split('/'),
        env,
        async () => Response.json(result),
      )
    ).status,
    503,
  );
  const receipt = ['interests', 'commands', command];
  assert.equal(
    (
      await proxyPhones(request('GET', receipt.join('/')), receipt, env, async () =>
        Response.json({ ...result, requestId: '12345678-1234-4234-8234-123456789abc' }),
      )
    ).status,
    503,
  );
});

test('successful phone upstream responses require bounded strict UTF-8 JSON and API mode', async () => {
  for (const response of [
    new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('invalid', { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    Response.json({ ...page, privateOwner: other }),
    Response.json(page, { headers: { 'Content-Length': '2097153' } }),
  ])
    assert.equal(
      (
        await proxyPhones(
          request('POST', 'fa/search', {}),
          ['fa', 'search'],
          env,
          async () => response,
        )
      ).status,
      503,
    );
  for (const change of [
    { SHOP_DATA_MODE: 'preview' },
    { SHOP_API_URL: undefined },
    { SHOP_API_URL: 'http://user:secret@127.0.0.1:5080' },
    { SHOP_API_URL: 'http://127.0.0.1:5080/private' },
  ])
    assert.equal(
      (
        await proxyPhones(
          request('POST', 'fa/search', {}),
          ['fa', 'search'],
          { ...env, ...change },
          never,
        )
      ).status,
      503,
    );
});

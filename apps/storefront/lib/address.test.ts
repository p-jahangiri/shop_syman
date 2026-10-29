import test from 'node:test';
import assert from 'node:assert/strict';
import { addressBook, saveAddressInput, addressOrderFields } from './address-contract.ts';
import { proxyAddresses } from './address-proxy.ts';
import { readAddresses, saveAddress, deleteAddress } from './address-client.ts';
import { accountReturnTo } from './order-form.ts';
const id = 'a'.repeat(32),
  origin = 'http://127.0.0.1:3175',
  bearer = 'Bearer ' + 'test-memory-token-'.repeat(2),
  environment = {
    SHOP_API_URL: 'http://127.0.0.1:5181',
    SHOP_PUBLIC_URL: origin,
    SHOP_DATA_MODE: 'api',
  };
const input = {
  label: ' خانه ',
  contactName: ' گیرندهٔ آزمایشی ',
  contactPhone: '+۹۸۹۱۲۱۲۳۴۵۶۷',
  delivery: {
    countryCode: 'IR' as const,
    province: ' تهران ',
    city: ' تهران ',
    address: 'نشانی آزمایشی\r\nبدون دادهٔ واقعی',
    postalCode: '۱۲۳۴۵۶۷۸۹۰',
  },
  makeDefault: false,
  version: null,
};
const canonical = saveAddressInput.parse(input),
  row = {
    id,
    ...canonical,
    isDefault: true,
    createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z',
    version: 'AAAAAAAAAAE=',
  };
const saved = (({ makeDefault: _, ...v }) => v)(row);
const book = { schemaVersion: 1, capacity: 20, items: [saved] };
const request = (
  method = 'GET',
  path = '/api/addresses',
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(origin + path, {
    method,
    headers: {
      Origin: origin,
      Authorization: bearer,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const never: typeof fetch = async () => {
  throw Error('No upstream call allowed');
};
test('addresses normalize Persian digits, phone, postal and bounded recipient details without changing order consent', () => {
  assert.equal(canonical.contactPhone, '09121234567');
  assert.equal(canonical.delivery.postalCode, '1234567890');
  assert.equal(canonical.label, 'خانه');
  assert.ok(!canonical.delivery.address.includes('\r'));
  const fields = addressOrderFields(addressBook.parse(book).items[0]);
  assert.deepEqual(Object.keys(fields).sort(), [
    'address',
    'city',
    'contactName',
    'contactPhone',
    'postalCode',
    'province',
  ]);
  assert.equal('note' in fields, false);
  assert.equal('acknowledgeTemporary' in fields, false);
  for (const body of [
    { ...input, ownerId: 'other' },
    { ...input, makeDefault: undefined },
    { ...input, version: 'bad' },
    { ...input, contactName: 'x\u0000x' },
    { ...input, delivery: { ...input.delivery, countryCode: 'GB' } },
    { ...input, delivery: { ...input.delivery, postalCode: '1' } },
  ])
    assert.equal(saveAddressInput.safeParse(body).success, false);
});
test('book contracts require a single default, unique bounded ids and forbid authentication or encrypted fields', () => {
  assert.equal(addressBook.safeParse(book).success, true);
  assert.equal(addressBook.safeParse({ ...book, items: [] }).success, true);
  for (const b of [
    { ...book, items: [{ ...saved, isDefault: false }] },
    { ...book, items: [saved, saved] },
    { ...book, capacity: 21 },
    { ...book, items: [{ ...saved, protectedData: 'private' }] },
    { ...book, items: [{ ...saved, ownerId: 'other' }] },
  ])
    assert.equal(addressBook.safeParse(b).success, false);
});
test('address return path is exact and never an open redirect', () => {
  assert.equal(accountReturnTo('/addresses', null), '/addresses');
  assert.equal(accountReturnTo(null, 'addresses'), '/addresses');
  for (const value of [
    '//evil.test',
    'https://evil.test',
    '/addresses/other',
    '/addresses?owner=other',
    '/%61ddresses',
  ])
    assert.equal(accountReturnTo(value, null), null);
});
test('private address BFF requires configured API, bearer, exact origin and strict route/method/query', async () => {
  assert.equal(
    (await proxyAddresses(request(), [], { ...environment, SHOP_DATA_MODE: 'preview' }, never))
      .status,
    503,
  );
  assert.equal(
    (
      await proxyAddresses(
        request('GET', '/api/addresses', undefined, { Authorization: '' }),
        [],
        environment,
        never,
      )
    ).status,
    401,
  );
  for (const [method, path] of [
    ['POST', []],
    ['GET', [id]],
    ['PUT', ['../admin']],
    ['DELETE', [id, 'extra']],
  ] as [string, string[]][])
    assert.equal((await proxyAddresses(request(method), path, environment, never)).status, 404);
  assert.equal(
    (
      await proxyAddresses(
        request('PUT', '/api/addresses/' + id, input, { Origin: 'https://evil.test' }),
        [id],
        environment,
        never,
      )
    ).status,
    403,
  );
  for (const query of ['?ownerId=other', '?cursor=1', '?x='])
    assert.equal(
      (await proxyAddresses(request('GET', '/api/addresses' + query), [], environment, never))
        .status,
      400,
    );
});
test('BFF strips cookies, binds writes to the resource, normalizes body and keeps all results private', async () => {
  const response = await proxyAddresses(
    request('PUT', '/api/addresses/' + id, input, {
      Cookie: 'private=ignored',
      'X-Sayman-Admin': '1',
    }),
    [id],
    environment,
    async (url, init) => {
      assert.equal(url, environment.SHOP_API_URL + '/api/addresses/' + id);
      assert.deepEqual(JSON.parse(String(init?.body)), canonical);
      assert.equal(init?.method, 'PUT');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      const h = new Headers(init?.headers);
      assert.equal(h.get('Authorization'), bearer);
      assert.equal(h.get('Cookie'), null);
      assert.equal(h.get('X-Sayman-Admin'), null);
      return Response.json(
        { schemaVersion: 1, address: saved, replayed: false },
        { status: 201, headers: { 'Set-Cookie': 'ignored=1' } },
      );
    },
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.match(response.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(
    (await proxyAddresses(request(), [], environment, async () => Response.json(book))).status,
    200,
  );
});
test('BFF rejects over-budget streams, malformed schemas and a mismatched write result without leaking data', async () => {
  assert.equal(
    (
      await proxyAddresses(
        request('PUT', '/api/addresses/' + id, { ...input, label: 'x'.repeat(17000) }),
        [id],
        environment,
        never,
      )
    ).status,
    413,
  );
  for (const bad of [
    { ...input, ownerId: 'other' },
    { ...input, makeDefault: undefined },
    { ...input, version: 'bad' },
  ])
    assert.equal(
      (await proxyAddresses(request('PUT', '/api/addresses/' + id, bad), [id], environment, never))
        .status,
      400,
    );
  const other = { schemaVersion: 1, address: { ...saved, id: 'b'.repeat(32) }, replayed: false };
  assert.equal(
    (
      await proxyAddresses(
        request('PUT', '/api/addresses/' + id, input),
        [id],
        environment,
        async () => Response.json(other),
      )
    ).status,
    503,
  );
  for (const value of [
    Response.json({ ...book, private: 'secret' }),
    new Response('bad-json'),
    new Response('x'.repeat(524289)),
  ]) {
    const r = await proxyAddresses(request(), [], environment, async () => value);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { title: 'address_unavailable' });
  }
});
test('DELETE requires an explicit version and empty 204; failure details and headers are discarded', async () => {
  const r = await proxyAddresses(
    request('DELETE', '/api/addresses/' + id, { version: 'AAAAAAAAAAE=' }),
    [id],
    environment,
    async (_, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { version: 'AAAAAAAAAAE=' });
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(r.status, 204);
  assert.equal(
    (await proxyAddresses(request('DELETE', '/api/addresses/' + id, {}), [id], environment, never))
      .status,
    400,
  );
  assert.equal(
    (
      await proxyAddresses(
        request('DELETE', '/api/addresses/' + id, { version: 'AAAAAAAAAAE=' }),
        [id],
        environment,
        async () => Response.json({}),
      )
    ).status,
    503,
  );
  const failure = await proxyAddresses(request(), [], environment, async () =>
    Response.json(
      { title: 'address_version_conflict', detail: 'private recipient', exception: 'SQL' },
      { status: 409 },
    ),
  );
  assert.deepEqual(await failure.json(), { title: 'address_version_conflict' });
  assert.equal(failure.status, 409);
});
test('address client never retries a mutation, preserves the resource/version and rejects mismatched success', async () => {
  let calls = 0;
  await assert.rejects(() =>
    saveAddress(
      async () => {
        calls++;
        throw Error('lost response');
      },
      id,
      canonical,
    ),
  );
  assert.equal(calls, 1);
  const result = await saveAddress(
    async (path, init) => {
      assert.equal(path, '/api/addresses/' + id);
      assert.equal(init?.method, 'PUT');
      return Response.json({ schemaVersion: 1, address: saved, replayed: true });
    },
    id,
    canonical,
  );
  assert.equal(result.replayed, true);
  await assert.rejects(() =>
    saveAddress(
      async () =>
        Response.json({
          schemaVersion: 1,
          address: { ...saved, id: 'b'.repeat(32) },
          replayed: false,
        }),
      id,
      canonical,
    ),
  );
  await deleteAddress(
    async (_, init) => {
      assert.equal(init?.method, 'DELETE');
      assert.deepEqual(JSON.parse(String(init?.body)), { version: 'AAAAAAAAAAE=' });
      return new Response(null, { status: 204 });
    },
    id,
    'AAAAAAAAAAE=',
  );
  await assert.rejects(() =>
    readAddresses(async () => Response.json({ ...book, items: [{ ...saved, isDefault: false }] })),
  );
});

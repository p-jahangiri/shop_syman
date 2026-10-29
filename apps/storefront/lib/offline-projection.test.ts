import test from 'node:test';
import assert from 'node:assert/strict';
import { offlineCatalogSchema } from './offline-contract.ts';
import { fetchOfflineProjection } from './offline-projection.ts';
import { offlineCatalog } from './offline-catalog.ts';
import { storefrontSnapshot } from './fixtures.ts';
const fixture = () => offlineCatalog(storefrontSnapshot, 'fa');
test('the existing public offline format remains compatible with the strict projection contract', () => {
  const dto = offlineCatalogSchema.parse(fixture());
  assert.equal(dto.products.length, 12);
  assert.equal(dto.locale, 'fa');
  assert.equal(
    dto.products.some((p) => 'priceRial' in p || 'variants' in p),
    false,
  );
});
test('financial, identity and unapproved image data cannot enter an offline projection', () => {
  const dto = fixture();
  for (const patch of [
    { site: { ...dto.site, contact: { phone: 'private' } } },
    { products: [{ ...dto.products[0], priceRial: '1' }] },
    { products: [{ ...dto.products[0], stock: 1 }] },
    { products: [{ ...dto.products[0], image: 'https://storage.example/image?signature=secret' }] },
    { products: [{ ...dto.products[0], image: '/products/../private.svg' }] },
    { user: { token: 'private' } },
    { purchaseMethods: [] },
  ])
    assert.equal(offlineCatalogSchema.safeParse({ ...dto, ...patch }).success, false);
});
test('projection rejects duplicates, unknown categories, unsafe ids and oversized fields', () => {
  const dto = fixture();
  for (const patch of [
    { products: [dto.products[0], dto.products[0]] },
    { categories: [dto.categories[0], dto.categories[0]] },
    { products: [{ ...dto.products[0], category: 'missing' }] },
    { products: [{ ...dto.products[0], id: '../private' }] },
    { products: [{ ...dto.products[0], description: 'x'.repeat(801) }] },
  ])
    assert.equal(offlineCatalogSchema.safeParse({ ...dto, ...patch }).success, false);
});
test('public fetch requests only the bounded projection without credentials or full storefront fallback', async () => {
  const data = await fetchOfflineProjection('http://127.0.0.1:5181/', 'fa', async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:5181/api/catalog/fa/offline?limit=200');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    for (const key of ['Cookie', 'Authorization', 'Origin', 'X-Sayman-Admin'])
      assert.equal(headers.has(key), false);
    return Response.json(fixture());
  });
  assert.equal(data.products.length, 12);
});
test('upstream failures, invalid schemas and wrong locale never fall back to sample data', async () => {
  let calls = 0;
  for (const response of [
    Response.json({ title: 'unavailable' }, { status: 503 }),
    new Response('<html>private</html>', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ ...fixture(), locale: 'en' }),
    Response.json({ ...fixture(), payableTotalRial: '1' }),
  ])
    await assert.rejects(
      fetchOfflineProjection('http://127.0.0.1:5181', 'fa', async () => {
        calls++;
        return response;
      }),
    );
  assert.equal(calls, 4);
});
test('response count and stream bounds are enforced before data can be published', async () => {
  const dto = fixture();
  const products = Array.from({ length: 201 }, (_, i) => ({
    ...dto.products[0],
    id: 'p' + i,
    slug: 'product-' + i,
  }));
  await assert.rejects(
    fetchOfflineProjection('http://127.0.0.1:5181', 'fa', async () =>
      Response.json({ ...dto, products }),
    ),
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(6 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchOfflineProjection(
      'http://127.0.0.1:5181',
      'fa',
      async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }),
    ),
  );
  assert.equal(cancelled, true);
});
test('cancelling the incoming request cancels its anonymous upstream fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchOfflineProjection(
      'http://127.0.0.1:5181',
      'fa',
      async (_url, init) => {
        assert.equal(init?.signal?.aborted, true);
        throw new DOMException('Aborted', 'AbortError');
      },
      controller.signal,
    ),
  );
});

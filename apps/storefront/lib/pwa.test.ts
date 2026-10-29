import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { offlineCatalog } from './offline-catalog.ts';
import { storefrontSnapshot } from './fixtures.ts';
const origin = 'https://sayman.example';
const workerSource = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
type Listener = (event: unknown) => void;
class MemoryCache {
  values = new Map<string, Response>();
  network: (request: Request) => Promise<Response>;
  constructor(network: (request: Request) => Promise<Response>) {
    this.network = network;
  }
  key(request: Request | string) {
    return new URL(typeof request === 'string' ? request : request.url, origin).href;
  }
  async match(request: Request | string) {
    return this.values.get(this.key(request))?.clone();
  }
  async put(request: Request | string, response: Response) {
    this.values.set(this.key(request), response.clone());
  }
  async delete(request: Request | string) {
    return this.values.delete(this.key(request));
  }
  async keys() {
    return [...this.values.keys()].map((url) => new Request(url));
  }
  async addAll(paths: string[]) {
    for (const path of paths) {
      const request = new Request(new URL(path, origin));
      await this.put(request, await this.network(request));
    }
  }
}
function harness() {
  let network: (request: Request) => Promise<Response> = async (request) =>
    new Response(request.url.includes('.html') ? '<h1>Offline</h1>' : 'public asset', {
      headers: {
        'Content-Type': request.url.includes('.html') ? 'text/html' : 'text/javascript',
        'Cache-Control': 'public',
      },
    });
  let clients: string[] = [];
  let skipped = false;
  const stores = new Map<string, MemoryCache>();
  const listeners = new Map<string, Listener[]>();
  const caches = {
    async open(name: string) {
      let cache = stores.get(name);
      if (!cache) {
        cache = new MemoryCache((request) => network(request));
        stores.set(name, cache);
      }
      return cache;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const self = {
    location: { origin },
    clients: {
      claim: async () => {},
      matchAll: async () => clients.map((url) => ({ url: new URL(url, origin).href })),
    },
    skipWaiting: async () => {
      skipped = true;
    },
    addEventListener: (name: string, listener: Listener) =>
      listeners.set(name, [...(listeners.get(name) ?? []), listener]),
  };
  vm.runInNewContext(workerSource.replace('__SAYMAN_PWA_VERSION__', 'test'), {
    self,
    caches,
    fetch: (request: Request) => network(request),
    URL,
    Headers,
    Response,
    Date,
    Set,
    Promise,
    JSON,
    Number,
  });
  return {
    stores,
    caches,
    setClients: (urls: string[]) => {
      clients = urls;
    },
    didSkip: () => skipped,
    setNetwork: (value: typeof network) => {
      network = value;
    },
    async event(name: string, data: Record<string, unknown> = {}) {
      const work: Promise<unknown>[] = [];
      for (const listener of listeners.get(name) ?? [])
        listener({ ...data, waitUntil: (promise: Promise<unknown>) => work.push(promise) });
      await Promise.all(work);
    },
    async fetch(path: string, options: RequestInit & { navigation?: boolean } = {}) {
      const { navigation, ...init } = options;
      const request = new Request(new URL(path, origin), init);
      if (navigation) Object.defineProperty(request, 'mode', { value: 'navigate' });
      let result: Promise<Response> | undefined;
      for (const listener of listeners.get('fetch') ?? [])
        listener({
          request,
          respondWith: (promise: Promise<Response>) => {
            result = promise;
          },
        });
      return result ? await result : null;
    },
    async storedPaths() {
      return (await Promise.all([...stores.values()].map((cache) => cache.keys())))
        .flat()
        .map((request) => new URL(request.url).pathname);
    },
  };
}
const catalogResponse = (data = offlineCatalog(storefrontSnapshot, 'fa')) =>
  Response.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=0',
      'X-Shop-Public-Resource': 'offline-catalog-v1',
      'X-Shop-Catalog-Generated': data.generatedAt,
    },
  });
test('offline DTO keeps an explicit public allowlist and strips financial, private and signed media data', () => {
  const snapshot = structuredClone(storefrontSnapshot);
  Object.assign(snapshot, {
    user: { email: 'private@example.test' },
    cart: [{ variantId: 'v1-silver' }],
  });
  snapshot.site.contact = { phone: '09120000000' };
  snapshot.products[0].image = 'https://storage.example/private.png?signature=secret';
  const data = offlineCatalog(snapshot, 'fa', '2026-10-22T00:00:00.000Z', 1);
  const json = JSON.stringify(data);
  for (const forbidden of [
    'priceRial',
    'stock',
    'purchaseMethodIds',
    'chequePlans',
    'authSettings',
    'private@example.test',
    '09120000000',
    'signature',
    'warranty',
  ])
    assert.equal(json.includes(forbidden), false, forbidden);
  assert.equal(data.products.length, 1);
  assert.equal(data.truncated, true);
  assert.equal(data.products[0].image, undefined);
});
test('worker never intercepts private/API mutations, credentials, RSC, ranges or external resources', async () => {
  const h = harness();
  for (const path of [
    '/api/credit-orders/quotes',
    '/api/credit-orders/commands/' + 'a'.repeat(32),
    '/fa/credit/purchases',
    '/en/credit/purchases',
    '/api/cart/fa/v2/credit-quote/commands/' + 'a'.repeat(32),
    '/api/cart/en/v2/credit-quotes/' + 'a'.repeat(32),
    '/api/credit/applications/' + 'a'.repeat(32) + '/documents',
    '/api/credit/applications/' + 'a'.repeat(32) + '/documents/files/' + 'b'.repeat(32),
    '/api/admin/credit/applications/' + 'a'.repeat(32) + '/documents',
    '/api/credit/requirements',
    '/api/credit/applications/' + 'a'.repeat(32) + '/requirements',
    '/api/admin/credit/requirements',
    '/fa/credit',
    '/en/credit',
    '/api/credit/applications',
    '/api/admin/credit/applications',
    '/fa/notifications',
    '/en/notifications',
    '/api/notifications',
    '/api/notifications/unread-count',
    '/fa/support/tickets',
    '/en/support/tickets/' + 'a'.repeat(32),
    '/api/support/tickets',
    '/api/cart/fa',
    '/api/cart/fa/sourcing',
    '/api/cart/en/sourcing/submit',
    '/api/sourcing/requests',
    '/fa/sourcing',
    '/en/sourcing/' + 'a'.repeat(32),
    '/api/market/fa/search',
    '/api/market/en/listing1',
    '/api/addresses',
    '/api/addresses/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/fa/addresses',
    '/en/addresses',
    '/api/payments/orders/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/api/payments/attempts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/api/orders',
    '/api/orders/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/api/auth/me',
    '/api/auth/refresh',
    '/api/admin/catalog',
    '/fa/account',
    '/en/cart',
    '/fa/checkout',
    '/fa/orders',
    '/en/orders/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/en/payment',
    '/pwa/catalog/fa.json?token=private',
    '/fa/catalog?_rsc=1',
    'https://other.example/_next/static/file.js',
  ])
    assert.equal(await h.fetch(path), null, path);
  const requests: RequestInit[] = [
    { method: 'POST' },
    { headers: { Authorization: 'Bearer private' } },
    { headers: { RSC: '1' } },
    { headers: { 'Next-Router-State-Tree': 'private' } },
    { headers: { 'Next-Router-Prefetch': '1' } },
    { headers: { Range: 'bytes=0-100' } },
    { cache: 'no-store' },
  ];
  for (const options of requests)
    assert.equal(await h.fetch('/_next/static/chunks/file.js', options), null);
  assert.deepEqual(await h.storedPaths(), []);
});
test('even a public navigation containing personalized HTML never enters Cache Storage', async () => {
  const h = harness();
  h.setNetwork(
    async () =>
      new Response('<p>private account token</p>', {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public' },
      }),
  );
  const response = await h.fetch('/fa', { navigation: true });
  assert.match(await response!.text(), /private account token/);
  assert.deepEqual(await h.storedPaths(), []);
});
test('market HTML and reference prices are never saved as an offline catalogue', async () => {
  const h = harness();
  h.setNetwork(
    async () =>
      new Response('<p>Reference price 9007199254740993; expired source</p>', {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      }),
  );
  for (const path of ['/fa/market', '/en/market/listing1'])
    assert.match(await (await h.fetch(path, { navigation: true }))!.text(), /9007199254740993/);
  assert.deepEqual(await h.storedPaths(), []);
});
test('cache stores sanitized public catalogue, tolerates an outage and expires it after seven days', async () => {
  const h = harness();
  h.setNetwork(async () => catalogResponse());
  await h.fetch('/pwa/catalog/fa.json');
  h.setNetwork(async () => {
    throw new Error('offline');
  });
  const cached = await h.fetch('/pwa/catalog/fa.json');
  assert.equal(cached?.headers.get('X-Shop-Offline'), '1');
  assert.equal((await cached!.json()).products.length, 12);
  h.setNetwork(async () =>
    catalogResponse(
      offlineCatalog(storefrontSnapshot, 'fa', new Date(Date.now() - 8 * 86400000).toISOString()),
    ),
  );
  await h.fetch('/pwa/catalog/fa.json');
  h.setNetwork(async () => {
    throw new Error('offline');
  });
  assert.equal((await h.fetch('/pwa/catalog/fa.json'))?.status, 503);
  assert.equal((await h.storedPaths()).includes('/pwa/catalog/fa.json'), false);
});
test('unexpected private fields, HTML, wrong language and private cache directives cannot enter public cache', async () => {
  for (const change of ['extra', 'language', 'private', 'html', 'vary']) {
    const h = harness();
    h.setNetwork(async () => {
      const value = offlineCatalog(storefrontSnapshot, 'fa');
      if (change === 'extra')
        Object.assign(value.products[0], { priceRial: '123', customer: 'private' });
      if (change === 'language') value.locale = 'en';
      const response = catalogResponse(value);
      if (change === 'private') response.headers.set('Cache-Control', 'private, no-store');
      if (change === 'html') response.headers.set('Content-Type', 'text/html');
      if (change === 'vary') response.headers.set('Vary', 'Cookie');
      return response;
    });
    await h.fetch('/pwa/catalog/fa.json');
    assert.deepEqual(await h.storedPaths(), [], change);
  }
});
test('offline sensitive navigation receives only a generic guide and never a cached account response', async () => {
  const h = harness();
  await h.event('install');
  h.setNetwork(async () => {
    throw new Error('offline');
  });
  const response = await h.fetch('/en/account', { navigation: true });
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('Cache-Control'), 'no-store');
  assert.match(await response!.text(), /Offline/);
  assert.equal(
    (await h.storedPaths()).some((path) => path.includes('account')),
    false,
  );
});
test('activation removes only owned obsolete caches and clearing the catalogue preserves the offline shell', async () => {
  const h = harness();
  await h.caches.open('another-application');
  await h.caches.open('sayman-pwa-assets-old');
  await h.event('install');
  h.setNetwork(async () => catalogResponse());
  await h.fetch('/pwa/catalog/fa.json');
  await h.event('activate');
  assert.equal(h.stores.has('another-application'), true);
  assert.equal(h.stores.has('sayman-pwa-assets-old'), false);
  let acknowledged = false;
  await h.event('message', {
    data: { type: 'CLEAR_OFFLINE_CATALOG' },
    ports: [
      {
        postMessage: () => {
          acknowledged = true;
        },
      },
    ],
  });
  assert.equal(acknowledged, true);
  assert.equal((await h.storedPaths()).includes('/pwa/catalog/fa.json'), false);
  assert.equal((await h.storedPaths()).includes('/pwa/offline-fa.html'), true);
});
test('HTTP failure can use the public copy while failed asset caching preserves the online response', async () => {
  const h = harness();
  h.setNetwork(async () => catalogResponse());
  await h.fetch('/pwa/catalog/fa.json');
  h.setNetwork(async () => new Response('unavailable', { status: 503 }));
  assert.equal((await h.fetch('/pwa/catalog/fa.json'))?.headers.get('X-Shop-Offline'), '1');
  const noStorage = harness();
  noStorage.caches.open = async () => {
    throw new Error('quota');
  };
  noStorage.setNetwork(
    async () =>
      new Response('public script', {
        headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public' },
      }),
  );
  assert.equal(
    await (await noStorage.fetch('/_next/static/chunks/file.js'))!.text(),
    'public script',
  );
});
test('an update cannot activate while any window is on an account, checkout or payment page', async () => {
  const h = harness();
  let activated: unknown;
  const message = {
    data: { type: 'ACTIVATE_UPDATE' },
    ports: [
      {
        postMessage: (data: unknown) => {
          activated = data;
        },
      },
    ],
  };
  h.setClients(['/fa/install', '/en/checkout']);
  await h.event('message', message);
  assert.equal(h.didSkip(), false);
  assert.equal(JSON.stringify(activated), JSON.stringify({ activated: false }));
  h.setClients(['/fa/install', '/fa/addresses']);
  await h.event('message', message);
  assert.equal(h.didSkip(), false);
  h.setClients(['/fa/install', '/en/sourcing/' + 'a'.repeat(32)]);
  await h.event('message', message);
  assert.equal(h.didSkip(), false);
  h.setClients(['/fa/install', '/fa/notifications']);
  await h.event('message', message);
  assert.equal(h.didSkip(), false);
  h.setClients(['/fa/install', '/fa/support/tickets/' + 'a'.repeat(32)]);
  await h.event('message', message);
  assert.equal(h.didSkip(), false);
  h.setClients(['/fa/install', '/en/catalog']);
  await h.event('message', message);
  assert.equal(h.didSkip(), true);
});
test('processed public catalogue images require the issued path, MIME and resource marker before caching', async () => {
  const path = '/media/catalog/' + 'a'.repeat(32) + '/thumb.webp';
  const snapshot = structuredClone(storefrontSnapshot);
  snapshot.products[0].image = path.replace('thumb', 'zoom');
  assert.equal(offlineCatalog(snapshot, 'fa').products[0].image, path);
  const approved = harness();
  approved.setNetwork(
    async () =>
      new Response('processed webp', {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Shop-Public-Resource': 'catalog-image-v1',
        },
      }),
  );
  await approved.fetch(path);
  assert.deepEqual(await approved.storedPaths(), [path]);
  approved.setNetwork(async () => {
    throw new Error('offline');
  });
  assert.equal(await (await approved.fetch(path))!.text(), 'processed webp');
  for (const change of ['marker', 'mime', 'private', 'cookie']) {
    const h = harness();
    h.setNetwork(async () => {
      const headers = new Headers({
        'Content-Type': 'image/webp',
        'Cache-Control': 'public',
        'X-Shop-Public-Resource': 'catalog-image-v1',
      });
      if (change === 'marker') headers.delete('X-Shop-Public-Resource');
      if (change === 'mime') headers.set('Content-Type', 'image/svg+xml');
      if (change === 'private') headers.set('Cache-Control', 'private, no-store');
      if (change === 'cookie') headers.set('Vary', 'Cookie');
      return new Response('unapproved', { headers });
    });
    await h.fetch(path);
    assert.deepEqual(await h.storedPaths(), [], change);
  }
  for (const path of [
    '/media/private/identity.webp',
    '/media/catalog/' + 'a'.repeat(32) + '/original.webp',
    '/media/catalog/' + 'a'.repeat(32) + '/thumb.webp?token=secret',
  ])
    assert.equal(await approved.fetch(path), null, path);
});

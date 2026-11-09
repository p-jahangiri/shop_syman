/* Sayman PWA: only explicit public resources. No Next HTML/RSC/API or financial data. */
'use strict';
const VERSION = '__SAYMAN_PWA_VERSION__';
const PREFIX = 'sayman-pwa-';
const CORE = PREFIX + 'core-' + VERSION;
const ASSETS = PREFIX + 'assets-' + VERSION;
const CATALOG = PREFIX + 'catalog-' + VERSION;
const CORE_URLS = [
  '/pwa/offline-fa.html',
  '/pwa/offline-en.html',
  '/pwa/offline.js',
  '/pwa/offline.css',
  '/pwa/fonts/vazirmatn-arabic.woff2',
  '/pwa/fonts/vazirmatn-latin.woff2',
  '/products/sayman-mark-olive-v1.png',
  '/pwa/icons/sayman-olive-v1-180.png',
  '/pwa/icons/sayman-olive-v1-192.png',
  '/pwa/icons/sayman-olive-v1-512.png',
];
const MAX_ASSETS = 80;
const MAX_CATALOG_AGE = 7 * 24 * 60 * 60 * 1000;
const publicImagePath = (path) =>
  /^\/media\/catalog\/[a-f0-9]{32}\/(thumb|card|zoom)\.webp$/.test(path);
const catalogPath = (path) => /^\/pwa\/catalog\/(fa|en)\.json$/.test(path);
const privatePath = (path) =>
  /^\/(?:fa\/|en\/)?(?:account|cart|checkout|payment|payments|orders|addresses|sourcing|phone-interests|credit|admin|notifications)(?:\/|$)/.test(
    path,
  ) ||
  /^\/(?:fa\/|en\/)?support\/tickets(?:\/|$)/.test(path) ||
  /^\/(?:fa\/|en\/)?(?:devices|purchase-requests)(?:\/|$)/.test(path) ||
  path.startsWith('/api/');
let disabled = false;
self.addEventListener('install', (event) =>
  event.waitUntil(caches.open(CORE).then((cache) => cache.addAll(CORE_URLS))),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const valid = new Set([CORE, ASSETS, CATALOG]);
      await Promise.all(
        (await caches.keys())
          .filter((key) => key.startsWith(PREFIX) && !valid.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') {
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const blocked = windows.some((client) => {
          try {
            return privatePath(new URL(client.url).pathname);
          } catch {
            return true;
          }
        });
        event.ports?.[0]?.postMessage({ activated: !blocked });
        if (!blocked) await self.skipWaiting();
      })(),
    );
    return;
  }
  if (event.data?.type === 'CLEAR_OFFLINE_CATALOG')
    event.waitUntil(
      (async () => {
        await Promise.all([caches.delete(CATALOG), caches.delete(ASSETS)]);
        event.ports?.[0]?.postMessage({ cleared: true });
      })(),
    );
  if (event.data?.type === 'DISABLE_PWA')
    event.waitUntil(
      (async () => {
        disabled = true;
        await Promise.all(
          (await caches.keys())
            .filter((key) => key.startsWith(PREFIX))
            .map((key) => caches.delete(key)),
        );
      })(),
    );
});
function publicResponse(response) {
  const control = response.headers.get('Cache-Control') ?? '';
  const vary = response.headers.get('Vary') ?? '';
  return (
    response.ok &&
    response.status === 200 &&
    response.type !== 'opaque' &&
    !response.redirected &&
    !/\b(?:private|no-store)\b/i.test(control) &&
    !/(?:cookie|authorization|\*)/i.test(vary)
  );
}
function publicCatalogPayload(data) {
  const keys = (object, allowed) =>
    object &&
    typeof object === 'object' &&
    !Array.isArray(object) &&
    Object.keys(object).every((key) => allowed.includes(key));
  const text = (value) => typeof value === 'string' && value.length <= 1000;
  return (
    keys(data, [
      'version',
      'locale',
      'generatedAt',
      'isPreview',
      'site',
      'categories',
      'products',
      'truncated',
    ]) &&
    data.version === 1 &&
    ['fa', 'en'].includes(data.locale) &&
    text(data.generatedAt) &&
    typeof data.isPreview === 'boolean' &&
    typeof data.truncated === 'boolean' &&
    keys(data.site, ['name', 'tagline', 'primary']) &&
    text(data.site.name) &&
    text(data.site.tagline) &&
    (!data.site.primary || /^#[0-9a-fA-F]{6}$/.test(data.site.primary)) &&
    Array.isArray(data.categories) &&
    data.categories.length <= 500 &&
    data.categories.every(
      (c) =>
        keys(c, ['key', 'name', 'description']) &&
        text(c.key) &&
        text(c.name) &&
        text(c.description),
    ) &&
    Array.isArray(data.products) &&
    data.products.length <= 500 &&
    data.products.every(
      (p) =>
        keys(p, ['id', 'slug', 'name', 'brand', 'category', 'description', 'image']) &&
        ['id', 'slug', 'name', 'brand', 'category', 'description'].every((k) => text(p[k])) &&
        (!p.image ||
          /^\/products\/[a-zA-Z0-9/_-]+\.svg$/.test(p.image) ||
          publicImagePath(p.image)),
    )
  );
}
async function store(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  if (cacheName === ASSETS) {
    const keys = await cache.keys();
    await Promise.all(
      keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)),
    );
  }
}
async function publicCatalog(request) {
  try {
    const response = await fetch(request);
    if (response.status >= 500) throw new Error('Public catalogue service is unavailable.');
    if (
      publicResponse(response) &&
      response.headers.get('X-Shop-Public-Resource') === 'offline-catalog-v1' &&
      (response.headers.get('Content-Type') ?? '').includes('application/json')
    ) {
      try {
        const raw = await response.clone().text();
        const data = raw.length <= 1000000 ? JSON.parse(raw) : null;
        const expected = new URL(request.url).pathname.endsWith('/en.json') ? 'en' : 'fa';
        if (publicCatalogPayload(data) && data.locale === expected)
          await store(CATALOG, request, response);
      } catch {
        /* A full cache must not turn a successful public read into a failure. */
      }
    }
    return response;
  } catch {
    let cache, cached;
    try {
      cache = await caches.open(CATALOG);
      cached = await cache.match(request);
    } catch {
      /* Cache failure falls through to the network or the explicit offline-unavailable response. */
    }
    const age = cached
      ? Date.now() - Date.parse(cached.headers.get('X-Shop-Catalog-Generated') ?? '')
      : NaN;
    if (cached && Number.isFinite(age) && age >= 0 && age <= MAX_CATALOG_AGE) {
      const headers = new Headers(cached.headers);
      headers.set('X-Shop-Offline', '1');
      return new Response(await cached.arrayBuffer(), { status: 200, headers });
    }
    if (cached)
      try {
        await cache.delete(request);
      } catch {
        /* Cache failure falls through to the network or the explicit offline-unavailable response. */
      }
    return Response.json(
      { error: 'offline_catalog_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
async function staticResource(request, core) {
  let cache;
  try {
    cache = await caches.open(core ? CORE : ASSETS);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    /* Cache failure falls through to the network or the explicit offline-unavailable response. */
  }
  const response = await fetch(request);
  const mime = response.headers.get('Content-Type') ?? '';
  if (
    publicResponse(response) &&
    (!publicImagePath(new URL(request.url).pathname) ||
      (mime === 'image/webp' &&
        response.headers.get('X-Shop-Public-Resource') === 'catalog-image-v1')) &&
    /^(?:application\/javascript|text\/javascript|text\/css|font\/|application\/font-woff|image\/)/i.test(
      mime,
    )
  )
    try {
      await store(core ? CORE : ASSETS, request, response);
    } catch {
      /* Cache failure falls through to the network or the explicit offline-unavailable response. */
    }
  return response;
}
async function navigation(request, url) {
  try {
    return await fetch(request);
  } catch {
    const locale = /^\/en(?:\/|$)/.test(url.pathname) ? 'en' : 'fa';
    let fallback;
    try {
      fallback = await (await caches.open(CORE)).match(`/pwa/offline-${locale}.html`);
    } catch {
      /* Cache failure falls through to the network or the explicit offline-unavailable response. */
    }
    if (fallback) {
      const headers = new Headers(fallback.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Shop-Offline', '1');
      return new Response(await fallback.arrayBuffer(), { status: 200, headers });
    }
    return new Response('Offline / اتصال برقرار نیست', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    disabled ||
    url.origin !== self.location.origin ||
    request.method !== 'GET' ||
    request.headers.has('Authorization') ||
    request.headers.has('Range') ||
    request.headers.has('RSC') ||
    request.headers.has('Next-Router-State-Tree') ||
    request.headers.has('Next-Router-Prefetch') ||
    url.searchParams.has('_rsc')
  )
    return;
  // Sensitive navigation may get a generic offline guide, but its response is never cached.
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request, url));
    return;
  }
  if (privatePath(url.pathname) || url.search || request.cache === 'no-store') return;
  if (catalogPath(url.pathname)) {
    event.respondWith(publicCatalog(request));
    return;
  }
  if (CORE_URLS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CORE);
        return (await cache.match(request)) ?? (await fetch(request));
      })(),
    );
    return;
  }
  const asset =
    publicImagePath(url.pathname) ||
    url.pathname.startsWith('/_next/static/') ||
    /^\/products\/[a-zA-Z0-9/_-]+\.svg$/.test(url.pathname) ||
    /^\/pwa\/icons\/(fa|en)\/(180|192|512)\.png$/.test(url.pathname);
  if (asset) event.respondWith(staticResource(request, false));
});

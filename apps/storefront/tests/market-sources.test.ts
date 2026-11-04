import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marketSourcesSchema,
  marketHistorySchema,
} from '@sayman/web-shared/lib/market/market-sources-contract.ts';
import { readMarketSources, readMarketHistory, proxyMarket } from '../lib/market/market-http.ts';
const listingId = 'a'.repeat(32),
  sourceId = 'b'.repeat(32);
const source = {
  id: listingId,
  isPrimary: true,
  sourceName: 'Synthetic source',
  sourceUrl: null,
  availability: 'available' as const,
  observedAt: '2026-10-25T08:00:00Z',
  validUntil: '2026-10-26T08:00:00Z',
  referencePriceRial: '9007199254740993',
  referencePriceCurrent: true,
  isDemo: true,
};
const sources = {
  schemaVersion: 1,
  locale: 'en',
  listingId,
  sources: [source, { ...source, id: sourceId, isPrimary: false }],
};
const sequence = '9007199254740993';
const history = {
  schemaVersion: 1,
  locale: 'en',
  listingId,
  sourceId,
  items: [
    {
      sequence,
      origin: 'recorded',
      recordedAt: '2026-10-25T09:00:00Z',
      source: { ...source, id: sourceId, isPrimary: false },
    },
  ],
  nextBefore: null,
};
const environment = {
  SHOP_API_URL: 'http://127.0.0.1:5080',
  SHOP_DATA_MODE: 'api',
  SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
};
test('source/history contracts retain exact rial and sequence with primary identity and no sellable data', () => {
  assert.equal(
    marketSourcesSchema.parse(sources).sources[1].referencePriceRial,
    '9007199254740993',
  );
  assert.equal(marketHistorySchema.parse(history).items[0].sequence, sequence);
  for (const value of [
    { ...sources, sources: [source, source] },
    { ...sources, sources: [{ ...source, isPrimary: false }] },
    { ...sources, sources: [{ ...source, stock: 4 }] },
    { ...sources, sources: [{ ...source, referencePriceRial: Number('9007199254740993') }] },
    { ...sources, sources: [{ ...source, sourceUrl: 'https://x.test/?token=private' }] },
  ])
    assert.equal(marketSourcesSchema.safeParse(value).success, false);
  assert.equal(
    marketHistorySchema.safeParse({ ...history, items: [...history.items, ...history.items] })
      .success,
    false,
  );
  assert.equal(marketHistorySchema.safeParse({ ...history, nextBefore: sequence }).success, false);
  assert.equal(
    marketHistorySchema.safeParse({
      ...history,
      items: [{ ...history.items[0], recordedAt: '2026-10-24T00:00:00Z' }],
    }).success,
    false,
  );
});
test('source/history reads bind locale, listing, source and decimal cursor and omit credentials', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetcher = (async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(String(url).includes('/history') ? history : sources);
  }) as typeof fetch;
  await readMarketSources('en', listingId, environment, fetcher);
  await readMarketHistory('en', listingId, sourceId, '9007199254740994', environment, fetcher);
  assert.match(calls[1].url, /before=9007199254740994$/);
  assert.equal(calls[0].options?.credentials, 'omit');
  assert.equal(calls[0].options?.cache, 'no-store');
  assert.equal(calls[0].options?.redirect, 'error');
  assert.equal(new Headers(calls[0].options?.headers).has('Authorization'), false);
  for (const raw of [
    { ...sources, locale: 'fa' },
    { ...sources, listingId: sourceId },
  ])
    await assert.rejects(
      readMarketSources('en', listingId, environment, (async () =>
        Response.json(raw)) as typeof fetch),
    );
  await assert.rejects(
    readMarketHistory('en', listingId, sourceId, sequence, environment, fetcher),
  );
  await assert.rejects(readMarketHistory('en', listingId, listingId, null, environment, fetcher));
  await assert.rejects(readMarketSources('en', listingId, { SHOP_DATA_MODE: 'preview' }, fetcher));
});
test('BFF exposes only GET bounded source/history routes with exact origin and query allowlist', async () => {
  let calls = 0;
  const fetcher = (async (url) => {
    calls++;
    return Response.json(String(url).includes('/history') ? history : sources);
  }) as typeof fetch;
  const path = [listingId, 'sources'];
  const response = await proxyMarket(
    new Request('http://127.0.0.1:3000/api/market/en/' + path.join('/'), {
      headers: { Cookie: 'private=1', Authorization: 'Bearer private' },
    }),
    'en',
    path,
    environment,
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.match(response.headers.get('x-robots-tag')!, /noindex/);
  const historyPath = [listingId, 'sources', sourceId, 'history'];
  const base = 'http://127.0.0.1:3000/api/market/en/' + historyPath.join('/');
  assert.equal(
    (
      await proxyMarket(
        new Request(base + '?before=9007199254740994'),
        'en',
        historyPath,
        environment,
        fetcher,
      )
    ).status,
    200,
  );
  for (const suffix of [
    '?unknown=x',
    '?before=0',
    '?before=1&before=2',
    '?before=9223372036854775808',
  ])
    assert.equal(
      (await proxyMarket(new Request(base + suffix), 'en', historyPath, environment, fetcher))
        .status,
      400,
    );
  assert.equal(
    (
      await proxyMarket(
        new Request(base, { method: 'POST' }),
        'en',
        historyPath,
        environment,
        fetcher,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await proxyMarket(
        new Request(base, { headers: { Origin: 'https://other.test' } }),
        'en',
        historyPath,
        environment,
        fetcher,
      )
    ).status,
    403,
  );
  assert.equal(calls, 2);
});

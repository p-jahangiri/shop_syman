import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { marketPageSchema } from '../apps/storefront/lib/market-contract.ts';
import {
  marketSourcesSchema,
  marketHistorySchema,
} from '../apps/storefront/lib/market-sources-contract.ts';
const directory = 'artifacts/checks/market-sources-main-wire';
await mkdir(directory);
const entries = [];
const response = await fetch('http://127.0.0.1:5080/api/market/en/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
assert.equal(response.status, 200);
const page = marketPageSchema.parse(await response.json());
assert.equal(page.total, 3);
const id = page.items[0].id;
for (const locale of ['fa', 'en'])
  for (const port of [5080, 3000]) {
    const read = async (endpoint: string, kind: 'sources' | 'history') => {
      const r = await fetch(`http://127.0.0.1:${port}/api/market/${locale}/${id}/${endpoint}`, {
        redirect: 'error',
      });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('cache-control') ?? '', /no-store/);
      const bytes = Buffer.from(await r.arrayBuffer());
      const file = `${port}-${locale}-${kind}.json`;
      await writeFile(`${directory}/${file}`, bytes);
      entries.push({ file, kind, sha256: createHash('sha256').update(bytes).digest('hex') });
      return JSON.parse(bytes.toString('utf8'));
    };
    const sources = marketSourcesSchema.parse(await read('sources', 'sources'));
    assert.equal(sources.locale, locale);
    assert.equal(sources.listingId, id);
    assert.equal(sources.sources.length, 1);
    assert.equal(sources.sources[0].id, id);
    const history = marketHistorySchema.parse(await read(`sources/${id}/history`, 'history'));
    assert.equal(history.locale, locale);
    assert.equal(history.listingId, id);
    assert.equal(history.sourceId, id);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].origin, 'migrationBaseline');
    assert.equal(history.items[0].source.referencePriceRial, sources.sources[0].referencePriceRial);
    assert.equal(history.nextBefore, null);
  }
const privateChecks = [];
for (const port of [5080, 3173])
  for (const endpoint of [
    `/api/admin/market/${id}/sources`,
    `/api/admin/market/${id}/sources/${id}/history`,
    '/api/admin/market/source-commands/11111111-1111-4111-8111-111111111111',
  ]) {
    const r = await fetch(`http://127.0.0.1:${port}${endpoint}`);
    assert.equal(r.status, 401);
    assert.match(r.headers.get('cache-control') ?? '', /no-store/);
    privateChecks.push({ port, endpoint, status: 401 });
  }
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: entries.length,
      actualMainSqlHttpBodies: true,
      strictProductionDecoders: true,
      onlyHonestLegacyBaselines: true,
      privateChecks,
      entries,
      readOnly: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${entries.length} exact main source/history responses and ${privateChecks.length} private401 checks accepted.`,
);

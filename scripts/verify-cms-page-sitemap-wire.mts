import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  cmsSitemapManifestSchema,
  cmsSitemapPageSchema,
} from '../apps/storefront/lib/cms-page-sitemap.ts';
import { cmsPublicPageSchema } from '../apps/storefront/lib/cms-page-contract.ts';
const dir = process.argv[2];
if (!dir || !path.isAbsolute(dir)) throw Error('Absolute actual SQL wire directory required');
const files = (await readdir(dir)).filter((x) => /^[a-f0-9]{32}\.json$/.test(x)),
  evidence = [],
  counts = {
    manifest: 0,
    partitions: 0,
    publicPage: 0,
    thousandRows: 0,
    lastSingleRow: 0,
    empty: 0,
  };
for (const file of files) {
  const raw = await readFile(path.join(dir, file)),
    meta = JSON.parse(await readFile(path.join(dir, file.replace('.json', '.meta.json')), 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.method, 'GET');
  assert.equal(meta.status, 200);
  const u = new URL(meta.path, 'http://qa.invalid'),
    data = JSON.parse(raw.toString('utf8'));
  let kind: string;
  if (u.pathname.startsWith('/api/content/pages/')) {
    const p = cmsPublicPageSchema.parse(data);
    assert.equal(p.slug, 'sitemap');
    counts.publicPage++;
    kind = 'public-sitemap-slug';
  } else if (u.pathname.endsWith('/entries')) {
    const p = cmsSitemapPageSchema.parse(data);
    assert.equal(p.locale, u.pathname.split('/')[4]);
    assert.equal(p.page, Number(u.searchParams.get('page') ?? '1'));
    counts.partitions++;
    if (p.items.length === 1000) counts.thousandRows++;
    if (p.items.length === 1 && p.page === 2) counts.lastSingleRow++;
    if (!p.items.length) counts.empty++;
    kind = 'partition';
  } else {
    const m = cmsSitemapManifestSchema.parse(data);
    assert.equal(m.locale, u.pathname.split('/').at(-1));
    assert.equal(m.isPreview, true, 'Production indexing guard must remain');
    counts.manifest++;
    kind = 'manifest';
  }
  evidence.push({ file, kind, sha256: createHash('sha256').update(raw).digest('hex') });
}
assert.ok(counts.manifest >= 7);
assert.ok(counts.partitions >= 4);
assert.equal(counts.publicPage, 1);
assert.equal(counts.thousandRows, 1);
assert.equal(counts.lastSingleRow, 2);
assert.equal(counts.empty, 1);
await writeFile(
  path.join(dir, 'acceptance.json'),
  JSON.stringify(
    {
      passed: true,
      actualSqlHttpOnly: true,
      syntheticQaOnly: true,
      responses: evidence.length,
      counts,
      productionIndexingGuardUnchanged: true,
      evidence,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ passed: true, responses: evidence.length, counts }));

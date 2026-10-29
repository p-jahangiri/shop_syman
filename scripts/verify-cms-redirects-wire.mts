import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  redirectDetailSchema,
  redirectHistorySchema,
  redirectListSchema,
  redirectPreviewSchema,
  redirectResultSchema,
  redirectRevisionSchema,
  redirectResolutionSchema,
} from '../apps/storefront/lib/cms-redirect-contract.ts';
const dir = process.argv[2];
if (!dir || !path.isAbsolute(dir)) throw Error('Absolute wire evidence directory required');
const files = (await readdir(dir)).filter((x) => /^[a-f0-9]{32}\.json$/.test(x)),
  evidence = [],
  counts: Record<string, number> = {};
for (const file of files) {
  const raw = await readFile(path.join(dir, file)),
    meta = JSON.parse(await readFile(path.join(dir, file.replace('.json', '.meta.json')), 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  const u = new URL(meta.path, 'http://qa.invalid'),
    data = JSON.parse(raw.toString('utf8'));
  let kind: string;
  if (u.pathname === '/api/content/redirects/resolve') {
    const r = redirectResolutionSchema.parse(data);
    assert.equal(r.sourcePath, u.searchParams.get('path'));
    kind = 'resolve';
  } else if (u.pathname.includes('/commands/')) {
    const r = redirectResultSchema.parse(data);
    assert.equal(r.commandId, u.pathname.split('/').at(-1));
    if (u.pathname.split('/').length === 7) assert.equal(r.redirectId, u.pathname.split('/')[4]);
    kind = meta.method === 'POST' ? 'command' : 'receipt';
  } else if (u.pathname.endsWith('/preview')) {
    const p = redirectPreviewSchema.parse(data);
    assert.equal(p.redirectId, u.pathname.split('/')[4]);
    kind = 'preview';
  } else if (u.pathname.endsWith('/history')) {
    redirectHistorySchema.parse(data);
    kind = 'history';
  } else if (u.pathname.includes('/revisions/')) {
    const r = redirectRevisionSchema.parse(data);
    assert.equal(r.redirectId, u.pathname.split('/')[4]);
    assert.equal(r.revision.id, u.pathname.split('/').at(-1));
    kind = 'revision';
  } else if (u.pathname === '/api/admin/redirects') {
    redirectListSchema.parse(data);
    kind = 'list';
  } else {
    const d = redirectDetailSchema.parse(data);
    assert.equal(d.id, u.pathname.split('/')[4]);
    kind = 'detail';
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  evidence.push({ file, kind, sha256: createHash('sha256').update(raw).digest('hex') });
}
for (const k of [
  'resolve',
  'command',
  'receipt',
  'preview',
  'history',
  'revision',
  'list',
  'detail',
])
  assert.ok(counts[k] > 0, k);
await writeFile(
  path.join(dir, 'acceptance.json'),
  JSON.stringify(
    {
      passed: true,
      actualSqlHttpOnly: true,
      syntheticQaOnly: true,
      responses: evidence.length,
      counts,
      evidence,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ passed: true, responses: evidence.length, counts }));

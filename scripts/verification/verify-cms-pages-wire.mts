import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  cmsPageResultSchema,
  cmsPageDetailSchema,
  cmsPageListSchema,
  cmsPageHistorySchema,
  cmsPageRevisionSchema,
  cmsPublicPageSchema,
} from '@sayman/web-shared/lib/content/cms-page-contract.ts';
const dir = process.argv[2];
if (!dir || !path.isAbsolute(dir)) throw Error('Absolute actual SQL wire directory required');
const counts: Record<string, number> = {},
  evidence = [];
for (const file of (await readdir(dir)).filter((f) => /^[a-f0-9]{32}\.json$/.test(f)).sort()) {
  const raw = await readFile(path.join(dir, file)),
    meta = JSON.parse(await readFile(path.join(dir, file.replace('.json', '.meta.json')), 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  const data = JSON.parse(raw.toString('utf8')),
    url = new URL(meta.path, 'http://qa.invalid');
  let kind: string;
  if (url.pathname.startsWith('/api/content/pages/')) {
    const p = cmsPublicPageSchema.parse(data),
      parts = url.pathname.split('/');
    assert.equal(p.locale, parts[4]);
    assert.equal(p.slug, parts[5]);
    kind = 'public-' + p.locale;
  } else if (/\/commands\/[a-f0-9]{32}$/.test(url.pathname)) {
    const r = cmsPageResultSchema.parse(data);
    assert.equal(r.commandId, url.pathname.split('/').at(-1));
    const parts = url.pathname.split('/');
    if (parts.length === 7) assert.equal(r.pageId, parts[4]);
    if (meta.method === 'GET') assert.equal(r.replayed, true);
    kind = meta.method === 'POST' ? 'command' : 'receipt';
  } else if (/\/revisions\//.test(url.pathname)) {
    const r = cmsPageRevisionSchema.parse(data),
      parts = url.pathname.split('/');
    assert.equal(r.pageId, parts[4]);
    assert.equal(r.revision.id, parts[6]);
    kind = 'revision';
  } else if (url.pathname.endsWith('/history')) {
    cmsPageHistorySchema.parse(data);
    kind = 'history';
  } else if (url.pathname === '/api/admin/pages') {
    cmsPageListSchema.parse(data);
    kind = 'list';
  } else {
    const d = cmsPageDetailSchema.parse(data);
    assert.equal(d.id, url.pathname.split('/').at(-1));
    kind = 'detail';
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  evidence.push({ file, sha256: createHash('sha256').update(raw).digest('hex'), kind });
}
assert.ok(evidence.length >= 40);
for (const kind of [
  'public-fa',
  'public-en',
  'command',
  'receipt',
  'revision',
  'history',
  'list',
  'detail',
])
  assert.ok(counts[kind] >= 1, kind);
const report = {
  accepted: true,
  actualSqlHttpOnly: true,
  syntheticQaOnly: true,
  responses: evidence.length,
  counts,
  files: evidence,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ accepted: true, responses: evidence.length, counts }));

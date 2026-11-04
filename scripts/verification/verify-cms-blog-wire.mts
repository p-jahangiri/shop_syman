import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  cmsBlogPostDetailSchema,
  cmsBlogPostListSchema,
  cmsBlogPostHistorySchema,
  cmsBlogPostRevisionSchema,
  cmsBlogPostResultSchema,
  cmsPublicBlogPostSchema,
  cmsBlogPublicListSchema,
  cmsBlogPostCommandSchema,
  readCmsBlogPostResult,
  type CmsBlogPostDetail,
  type CmsBlogPostCommand,
} from '@sayman/web-shared/lib/content/cms-blog-post-contract.ts';
import {
  blogSitemapManifestSchema,
  blogSitemapPageSchema,
} from '../../apps/storefront/lib/content/cms-blog-sitemap.ts';
const dir = process.argv[2];
assert.ok(dir && path.isAbsolute(dir));
const files = (await readdir(dir)).filter(
    (x) => /^[a-f0-9]{32}\.json$/.test(x) || /^\d+\.response\.json$/.test(x),
  ),
  samples = [],
  details = new Map<string, CmsBlogPostDetail>(),
  commands = new Map<string, CmsBlogPostCommand>(),
  counts: Record<string, number> = {},
  records = [];
let commandBindings = 0,
  receiptBindings = 0;
for (const file of files) {
  const bytes = await readFile(path.join(dir, file)),
    meta = JSON.parse(
      await readFile(
        path.join(
          dir,
          file.endsWith('.response.json')
            ? file.replace('.response.json', '.meta.json')
            : file.replace('.json', '.meta.json'),
        ),
        'utf8',
      ),
    );
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  if (meta.status !== 200) {
    records.push({
      file,
      kind: 'rejected',
      status: meta.status,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    continue;
  }
  const raw = JSON.parse(bytes.toString()),
    u = new URL(meta.path, 'http://qa.invalid');
  let kind: string;
  if (u.pathname.startsWith('/api/content/blog-sitemap/')) {
    const locale = u.pathname.split('/')[4];
    if (u.pathname.endsWith('/entries')) {
      const p = blogSitemapPageSchema.parse(raw);
      assert.equal(p.locale, locale);
      assert.equal(p.page, Number(u.searchParams.get('page') ?? '1'));
      kind = 'sitemapPage';
    } else {
      const p = blogSitemapManifestSchema.parse(raw);
      assert.equal(p.locale, locale);
      kind = 'sitemapManifest';
    }
  } else if (u.pathname.startsWith('/api/content/blog/')) {
    assert.equal(meta.blogSchema, '1');
    const privateKeys = new Set([
      'draftHash',
      'draftJson',
      'createdBy',
      'updatedBy',
      'actorId',
      'privateActor',
      'authorEmail',
      'protectedPayload',
    ]);
    const inspect = (value: unknown) => {
      if (Array.isArray(value)) for (const item of value) inspect(item);
      else if (value && typeof value === 'object')
        for (const [key, item] of Object.entries(value)) {
          assert.ok(!privateKeys.has(key));
          inspect(item);
        }
    };
    inspect(raw);
    const parts = u.pathname.slice('/api/content/blog/'.length).split('/');
    if (parts.length === 1) {
      const p = cmsBlogPublicListSchema.parse(raw);
      assert.equal(p.locale, parts[0]);
      assert.equal(p.tag, u.searchParams.get('tag'));
      kind = 'publicList';
    } else {
      assert.equal(parts.length, 2);
      const p = cmsPublicBlogPostSchema.parse(raw);
      assert.equal(p.locale, parts[0]);
      assert.equal(p.slug, parts[1]);
      kind = 'publicPost';
    }
  } else {
    assert.ok(
      u.pathname === '/api/admin/blog-posts' || u.pathname.startsWith('/api/admin/blog-posts/'),
    );
    const tail = u.pathname.slice('/api/admin/blog-posts'.length);
    if (tail.includes('/commands/')) {
      const r = cmsBlogPostResultSchema.parse(raw);
      assert.equal(r.commandId, tail.split('/').at(-1));
      const id = /^\/([a-f0-9]{32})\/commands\//.exec(tail)?.[1];
      if (id) assert.equal(r.postId, id);
      else assert.equal(r.action, 'Create');
      kind = meta.method === 'POST' ? 'command' : 'receipt';
    } else if (tail.endsWith('/history')) {
      cmsBlogPostHistorySchema.parse(raw);
      kind = 'history';
    } else if (tail.includes('/revisions/')) {
      const r = cmsBlogPostRevisionSchema.parse(raw);
      assert.equal(r.postId, tail.split('/')[1]);
      assert.equal(r.revision.id, tail.split('/').at(-1));
      kind = 'revision';
    } else if (tail === '') {
      cmsBlogPostListSchema.parse(raw);
      kind = 'privateList';
    } else {
      const p = cmsBlogPostDetailSchema.parse(raw);
      assert.equal(p.id, tail.slice(1));
      details.set(p.id + ':' + p.version, p);
      kind = 'detail';
    }
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  records.push({ file, kind, sha256: createHash('sha256').update(bytes).digest('hex') });
  samples.push({ meta, u, raw, kind });
}
for (const s of samples) {
  if (s.kind !== 'command') continue;
  const r = cmsBlogPostResultSchema.parse(s.raw),
    input = s.meta.requestBody ?? s.meta.originalRequestBody;
  assert.ok(input, 'Actual posted article body is required');
  const previous = input.action === 'Create' ? null : details.get(r.postId + ':' + input.version);
  assert.notEqual(previous, undefined, 'Actual stored detail at the submitted version is required');
  const c = cmsBlogPostCommandSchema.parse({
    id: r.commandId,
    postId: input.action === 'Create' ? null : r.postId,
    input,
    previous,
  });
  readCmsBlogPostResult(r, c);
  commands.set(c.id, c);
  commandBindings++;
}
for (const s of samples) {
  if (s.kind !== 'receipt') continue;
  const r = cmsBlogPostResultSchema.parse(s.raw),
    c = commands.get(r.commandId);
  assert.ok(c, 'Recovered article receipt needs its original POST');
  readCmsBlogPostResult(r, c);
  receiptBindings++;
}
assert.ok(counts.command > 0 && counts.detail > 0 && counts.publicPost > 0);
const result = {
  passed: true,
  syntheticQaOnly: true,
  actualSqlHttpOnly: true,
  responses: records.length,
  counts,
  commandsBoundToActualPostedBodyAndStoredDetail: commandBindings,
  recoveredReceiptsBoundToOriginalCommand: receiptBindings,
  records,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, records: undefined }));

import { z } from 'zod';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  readSupportContent,
  readSupportContentRevision,
  supportContentDraftSchema,
} from '../apps/storefront/lib/support-content-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const names = (await readdir(dir))
  .filter((n) => /^\d+\.meta\.json$/.test(n))
  .sort((a, b) => parseInt(a) - parseInt(b));
const entries = [],
  publicPages = [],
  publishes = [],
  saves = [];
let privatePreview = 0,
  lists = 0;
for (const name of names) {
  const meta = JSON.parse(await readFile(`${dir}/${name}`, 'utf8')),
    id = name.split('.')[0],
    raw = await readFile(`${dir}/${id}.response.json`);
  assert.equal(meta.syntheticQaOnly, true);
  assert.match(meta.cacheControl, /no-store/);
  assert.equal(createHash('sha256').update(raw).digest('hex'), meta.responseSha256);
  let request: unknown;
  if (meta.requestSha256) {
    const bytes = await readFile(`${dir}/${id}.request.json`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.requestSha256);
    request = JSON.parse(bytes.toString('utf8'));
  }
  if (/^\/api\/content\/support\/(fa|en)$/.test(meta.path) && meta.status === 200) {
    const value = readSupportContent(
      JSON.parse(raw.toString('utf8')),
      meta.path.endsWith('/fa') ? 'fa' : 'en',
    );
    publicPages.push(value);
  } else if (
    /^\/api\/admin\/content\/support\/(fa|en)\/revisions\/[1-9][0-9]*$/.test(meta.path) &&
    meta.status === 200
  ) {
    readSupportContentRevision(
      JSON.parse(raw.toString('utf8')),
      meta.path.split('/')[5] as 'fa' | 'en',
      meta.path.split('/').at(-1)!,
    );
    privatePreview++;
  } else if (meta.path === '/api/admin/content' && meta.status === 200) {
    const content = z
      .object({
        documents: z.array(
          z.object({
            key: z.string(),
            draftJson: z.string(),
            publishedJson: z.string().nullable(),
          }),
        ),
      })
      .parse(JSON.parse(raw.toString('utf8')));
    for (const doc of content.documents.filter((x) => x.key === 'support')) {
      supportContentDraftSchema.parse(JSON.parse(doc.draftJson));
      if (doc.publishedJson) supportContentDraftSchema.parse(JSON.parse(doc.publishedJson));
    }
    lists++;
  } else if (meta.method === 'PUT') {
    assert.equal(meta.status, 204);
    const draft = z.object({ content: supportContentDraftSchema }).passthrough().parse(request);
    saves.push({ meta, request: draft });
  } else if (meta.method === 'POST' && meta.path.endsWith('/publish'))
    publishes.push({
      meta,
      request: z.object({ restoreRevisionId: z.string().optional() }).passthrough().parse(request),
    });
  else assert.fail(`Unexpected CMS capture ${meta.method} ${meta.path} ${meta.status}`);
  entries.push({ id, ...meta });
}
assert.equal(saves.length, 3);
assert.equal(publishes.length, 5);
assert.deepEqual(
  publishes.map((x) => x.meta.status),
  [204, 409, 204, 204, 204],
);
assert.deepEqual(publishes[0].request, publishes[1].request);
assert.equal(publishes.filter((x) => x.meta.droppedAfterCommittedSuccess).length, 1);
assert.equal(privatePreview, 1);
assert.ok(lists >= 5);
assert.ok(publicPages.some((x) => x.locale === 'fa' && x.revision === 0));
assert.ok(publicPages.some((x) => x.locale === 'en' && x.revision === 0));
const fa = publicPages.filter((x) => x.locale === 'fa' && x.revision === 1).at(-1)!,
  restored = publicPages.filter((x) => x.locale === 'fa' && x.revision === 3).at(-1)!;
assert.deepEqual(fa.content, restored.content);
assert.deepEqual(
  restored.content!.faqs.map((x) => x.question),
  ['پرسش دوم نمونه؟', 'پرسش اول نمونه؟'],
);
assert.ok(
  publicPages.some(
    (x) => x.locale === 'fa' && x.revision === 2 && x.content?.title === 'نسخهٔ دوم نمونهٔ فارسی',
  ),
);
assert.ok(
  publicPages.some(
    (x) => x.locale === 'en' && x.revision === 1 && x.content?.title === 'Independent QA support',
  ),
);
assert.match(publishes.at(-1)!.request.restoreRevisionId!, /^[1-9][0-9]*$/);
await writeFile(
  `${dir}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: entries.length,
      inputs: saves.length + publishes.length,
      publicResponses: publicPages.length,
      privateHistoricalPreview: privatePreview,
      committedResponseLost: 1,
      sameVersionRetryRejected: true,
      independentLanguages: true,
      disabledQuestionsAbsent: true,
      publishedDraftIsolation: true,
      restoredContentExact: true,
      strictProductionDecoders: true,
      rawBodiesUnmodified: true,
      syntheticQaOnly: true,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `CMS browser wire: ${entries.length} responses and ${saves.length + publishes.length} inputs accepted.`,
);

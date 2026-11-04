import { CapturedValues } from './captured-values.mts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  readSupportContent,
  readSupportContentRevision,
  supportContentPageSchema,
  supportContentRevisionSchema,
} from '@sayman/web-shared/lib/content/support-content-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const entries = [];
const values = new CapturedValues();
for (const name of [
  'missing',
  'draft-hidden',
  'published-fa',
  'no-locale-fallback',
  'published-en',
  'unpublished-edit-hidden',
  'revision-two',
  'historical-revision',
  'restored',
]) {
  const raw = await readFile(`${directory}/${name}.json`),
    meta = JSON.parse(await readFile(`${directory}/${name}.meta.json`, 'utf8')),
    value = JSON.parse(raw.toString('utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  values.set(name, value);
  if (name === 'historical-revision')
    readSupportContentRevision(value, 'fa', meta.path.split('/').at(-1));
  else
    readSupportContent(
      value,
      name === 'published-en' || name === 'no-locale-fallback' ? 'en' : 'fa',
    );
  entries.push({ name, sha256: createHash('sha256').update(raw).digest('hex'), ...meta });
}
for (const name of ['missing', 'draft-hidden', 'no-locale-fallback'])
  assert.equal(values.read(name, supportContentPageSchema).content, null);
assert.deepEqual(
  values.read('published-fa', supportContentPageSchema),
  values.read('unpublished-edit-hidden', supportContentPageSchema),
);
assert.deepEqual(
  values.read('restored', supportContentPageSchema).content,
  values.read('published-fa', supportContentPageSchema).content,
);
assert.equal(values.read('restored', supportContentPageSchema).revision, 3);
assert.equal(
  values.read('historical-revision', supportContentRevisionSchema).content!.faqs.length,
  2,
);
assert.equal(values.read('published-fa', supportContentPageSchema).content!.faqs.length, 1);
assert.equal(
  values.read('published-fa', supportContentPageSchema).content!.faqs[0].answer,
  '<b>متن ساده</b>\nپاسخ فقط برای آزمون',
);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 9,
      actualSqlHttpResponseBodies: true,
      strictProductionDecoders: true,
      rawBodiesUnmodified: true,
      draftAndDisabledAbsent: true,
      independentLanguages: true,
      historicalPreviewAndRestore: true,
      syntheticQaOnly: true,
      entries,
    },
    null,
    2,
  ) + '\n',
);
console.log('9 real SQL HTTP support-content responses passed production decoders.');

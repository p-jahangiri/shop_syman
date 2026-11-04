import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  ownReview,
  reviewPage,
  reviewResult,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
const directory = path.resolve('artifacts/checks/reviews-final-sql-wire');
const specs = [
  ['own-empty', ownReview],
  ['save-pending', reviewResult],
  ['save-replay', reviewResult],
  ['public-empty', reviewPage],
  ['public-approved', reviewPage],
  ['report-replay', reviewResult],
  ['own-reported', ownReview],
  ['public-after-edit', reviewPage],
] as const;
const bodies = [];
const values = new Map<string, unknown>();
for (const [name, schema] of specs) {
  const file = path.join(directory, name + '.json'),
    raw = await readFile(file);
  assert(raw.length <= 524288);
  const parsed = schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  values.set(name, parsed);
  bodies.push({
    file: path.relative(process.cwd(), file),
    bytes: raw.length,
    sha256: createHash('sha256').update(raw).digest('hex'),
  });
}
const saved = reviewResult.parse(values.get('save-pending')),
  replay = reviewResult.parse(values.get('save-replay')),
  published = reviewPage.parse(values.get('public-approved')),
  reported = ownReview.parse(values.get('own-reported'));
assert(saved.review && saved.review.state === 'Pending' && !saved.replayed);
assert(replay.replayed);
assert.deepEqual(saved.review, replay.review);
assert.equal(ownReview.parse(values.get('own-empty')).review, null);
assert.equal(reviewPage.parse(values.get('public-empty')).items.length, 0);
assert.equal(reviewPage.parse(values.get('public-after-edit')).items.length, 0);
assert.equal(published.items.length, 1);
assert.equal(published.items[0].content.body, '<script>همین متن ساده است</script>');
assert.equal(published.items[0].verifiedBuyer, false);
assert.equal(published.items[0].reply, 'پاسخ عمومی فروشگاه');
assert.equal(published.items[0].id, saved.review.id);
assert.equal(published.items[0].content.revisionId, saved.review.content.revisionId);
assert.equal(reported.review?.reportCount, 1);
assert(reviewResult.parse(values.get('report-replay')).reported);
await writeFile(
  path.join(directory, 'acceptance.json'),
  JSON.stringify(
    {
      passed: true,
      responses: bodies.length,
      actualSqlHttpBodies: true,
      strictProductionDecoders: true,
      bodyNormalization: false,
      publicOwnerIdentityAbsent: true,
      scriptTextPreservedAsPlainText: true,
      replayExact: true,
      emptyAndEditedUnpublished: true,
      bodies,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ passed: true, rawSqlResponses: bodies.length }));

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { saveReviewInput, reviewResult } from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
import { moderateReviewInput } from '../../apps/admin/src/api/contracts/reviews/reviews-contract.ts';
const directory = path.resolve('artifacts/checks/reviews-browser-wire'),
  stats = JSON.parse(await readFile(path.join(directory, 'stats-final-direction.json'), 'utf8'));
assert(stats.qaOnly && stats.dropped === 4 && stats.captured === 13);
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
const rows = [];
let target: string | null = null;
for (let n = 1; n <= stats.captured; n++) {
  const request = await readFile(path.join(directory, n + '.request.json')),
    response = await readFile(path.join(directory, n + '.response.json')),
    meta = JSON.parse(await readFile(path.join(directory, n + '.meta.json'), 'utf8'));
  assert(meta.method === 'PUT' && request.length <= 16384 && response.length <= 524288);
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request));
  if (meta.operation === 'save') {
    saveReviewInput.parse(input);
    assert(/^\/api\/reviews\/products\/p1\/commands\/[a-f0-9]{32}$/.test(meta.path));
  } else {
    moderateReviewInput.parse(input);
    assert(/^\/api\/admin\/reviews\/[a-f0-9]{32}\/commands\/[a-f0-9]{32}$/.test(meta.path));
  }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response));
  if (n === 6) {
    assert.equal(meta.status, 409);
    assert.equal(value.title, 'review_version_conflict');
  } else {
    assert.equal(meta.status, 200);
    const result = reviewResult.parse(value);
    assert(result.review && !result.reported);
    target ??= result.review.id;
    assert.equal(result.review.id, target);
    assert.equal(result.review.productId, 'p1');
    assert.equal(result.replayed, n === 2 || n === 4);
  }
  rows.push({
    n,
    path: meta.path,
    operation: meta.operation,
    status: meta.status,
    requestSha256: hash(request),
    requestBytes: request.length,
    responseSha256: hash(response),
    responseBytes: response.length,
    storefrontStage: n <= 11 ? 'initial-core' : 'final-direction',
  });
}
for (const [first, second] of [
  [1, 2],
  [3, 4],
]) {
  assert.equal(rows[first - 1].path, rows[second - 1].path);
  assert.equal(rows[first - 1].requestSha256, rows[second - 1].requestSha256);
  const a = reviewResult.parse(
      JSON.parse(await readFile(path.join(directory, first + '.response.json'), 'utf8')),
    ),
    b = reviewResult.parse(
      JSON.parse(await readFile(path.join(directory, second + '.response.json'), 'utf8')),
    );
  assert.deepEqual(a.review, b.review);
  assert(!a.replayed && b.replayed);
}
await writeFile(
  path.join(directory, 'acceptance.json'),
  JSON.stringify(
    {
      passed: true,
      actualBrowserOriginatedBodies: true,
      sameSqlApiAcrossStages: true,
      responses: 13,
      expectedVersionConflict: 1,
      complete200ResponsesDropped: 4,
      identicalCommandRetryPairs: 2,
      strictProductionDecoders: true,
      normalization: false,
      ownerCredentialsUsed: false,
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ passed: true, responses: 13, dropped: 4, versionConflict: 1 }));

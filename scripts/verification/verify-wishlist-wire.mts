import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readWishlist,
  wishlistInputSchema,
  wishlistSchema,
} from '../../apps/storefront/lib/wishlist/wishlist-contract.ts';
const dir = process.argv[2];
assert.ok(dir && path.isAbsolute(dir));
const files = (await readdir(dir)).filter(
  (f) => /^[a-f0-9]{32}\.json$/.test(f) || /^\d+\.response\.json$/.test(f),
);
let puts = 0,
  gets = 0,
  cuts = 0,
  empty = 0,
  full = 0;
const records = [];
for (const f of files) {
  const raw = await readFile(path.join(dir, f)),
    m = JSON.parse(
      await readFile(
        path.join(
          dir,
          f.endsWith('.response.json')
            ? f.replace('.response.json', '.meta.json')
            : f.replace('.json', '.meta.json'),
        ),
        'utf8',
      ),
    );
  assert.equal(m.actualSqlHttpResponse, true);
  assert.equal(m.syntheticQaOnly, true);
  assert.equal(m.path, '/api/wishlist');
  if (m.status !== 200) {
    records.push({ file: f, status: m.status, kind: 'rejected' });
    continue;
  }
  const value = wishlistSchema.parse(JSON.parse(raw.toString()));
  readWishlist(value, value.ownerId);
  if (!value.productIds.length) empty++;
  if (value.productIds.length === 200) full++;
  if (m.method === 'PUT') {
    const body = wishlistInputSchema.parse(m.requestBody);
    assert.deepEqual(value.productIds, [...body.productIds].sort());
    puts++;
  } else {
    assert.equal(m.method, 'GET');
    gets++;
  }
  if (m.droppedAfterCommittedSuccess) cuts++;
  records.push({ file: f, kind: m.method, sha256: createHash('sha256').update(raw).digest('hex') });
}
assert.ok(puts > 0 && gets > 0 && empty > 0);
const result = {
  passed: true,
  actualSqlHttpOnly: true,
  syntheticQaOnly: true,
  responses: records.length,
  putResponsesBoundToActualDesiredSet: puts,
  getResponses: gets,
  emptyResponses: empty,
  capacity200Responses: full,
  responseCutsAfterCommit: cuts,
  authCaptured: false,
  records,
};
await writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, records: undefined }));

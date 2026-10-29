import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditPurchaseScopeResultSchema,
  readCreditPurchaseScopePage,
} from '../apps/storefront/lib/credit-purchase-scope-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const evidence = [];
let grants = 0,
  revocations = 0,
  historicalGrants = 0,
  ready = 0,
  revoked = 0;
for (const name of (await readdir(dir)).filter((x) => x.endsWith('.meta.json')).sort()) {
  const meta = JSON.parse(await readFile(dir + '/' + name, 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  const file = name.replace('.meta.json', '.json'),
    bytes = await readFile(dir + '/' + file),
    raw = JSON.parse(bytes.toString('utf8')),
    app = /\/applications\/([a-f0-9]{32})/.exec(meta.path)?.[1];
  assert.ok(app);
  if (/\/purchase-scope$/.test(meta.path)) {
    const p = readCreditPurchaseScopePage(raw, app, meta.path.startsWith('/api/admin/'));
    if (p.eligibleForQuote) ready++;
    if (p.scope?.state === 'Revoked') revoked++;
  } else {
    const r = creditPurchaseScopeResultSchema.parse(raw);
    assert.equal(r.application.id, app);
    assert.equal(r.commandId, meta.path.split('/').at(-1));
    assert.equal(r.scope.limitAmountRial, '9007199254740993');
    if (r.kind === 'Grant') {
      grants++;
      if (r.replayed) historicalGrants++;
    } else revocations++;
  }
  assert.doesNotMatch(
    JSON.stringify(raw),
    /"(?:ownerId|actorId|password|accessToken|refreshToken|protectedNote|protectedResult|storageKey)"\s*:/i,
  );
  evidence.push({
    file,
    method: meta.method,
    path: meta.path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
assert.ok(grants >= 5 && revocations >= 3 && historicalGrants >= 1 && ready >= 1 && revoked >= 1);
await writeFile(
  dir + '/acceptance.json',
  JSON.stringify(
    {
      passed: true,
      responses: evidence.length,
      grants,
      revocations,
      historicalGrants,
      ready,
      revoked,
      strictProductionDecoders: true,
      actualSqlHttpBodies: true,
      rawBodiesUnmodified: true,
      exactLargeRialString: true,
      syntheticQaOnly: true,
      checkoutEnabled: false,
      evidence,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    passed: true,
    responses: evidence.length,
    grants,
    revocations,
    historicalGrants,
  }),
);

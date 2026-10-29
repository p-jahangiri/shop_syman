import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  creditCheckoutQuoteResultSchema,
  creditCheckoutQuoteSchema,
} from '../apps/storefront/lib/credit-checkout-quote-contract.ts';
const dir = process.argv[2];
assert.ok(dir);
const evidence = [];
let ordinary = 0,
  accepted = 0,
  replayed = 0,
  unknown = 0,
  over = 0,
  clipped = 0;
for (const file of (await readdir(dir)).filter((x) => x.endsWith('.meta.json')).sort()) {
  const meta = JSON.parse(await readFile(dir + '/' + file, 'utf8')),
    body = file.replace('.meta.json', '.json'),
    bytes = await readFile(dir + '/' + body),
    raw = JSON.parse(bytes.toString('utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  assert.match(meta.cacheControl, /no-store/);
  const detail = meta.path.includes('/credit-quotes/'),
    result = detail ? null : creditCheckoutQuoteResultSchema.parse(raw),
    q = detail ? creditCheckoutQuoteSchema.parse(raw) : result!.quote;
  if (detail) assert.equal(q.id, meta.path.split('/').at(-1));
  else assert.equal(result!.commandId, meta.path.split('/').at(-1));
  if (q.ordinaryQuote) ordinary++;
  else accepted++;
  if (result?.replayed) replayed++;
  if (q.assessment.withinLimit === null) unknown++;
  if (q.assessment.withinLimit === false) over++;
  const core = q.ordinaryQuote ?? q.acceptedQuote!;
  if (Date.parse(q.expiresAt) < Date.parse(core.expiresAt!)) clipped++;
  assert.equal(q.canPlaceOrder, false);
  assert.equal(q.canPay, false);
  assert.doesNotMatch(
    JSON.stringify(raw),
    /"(?:ownerId|actorId|email|phoneNumber|password|accessToken|refreshToken|protectedResult|storageKey)"\s*:/i,
  );
  evidence.push({
    file: body,
    path: meta.path,
    method: meta.method,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
assert.ok(
  ordinary >= 8 && accepted >= 3 && replayed >= 3 && unknown >= 1 && over >= 1 && clipped >= 1,
);
await writeFile(
  dir + '/acceptance.json',
  JSON.stringify(
    {
      passed: true,
      responses: evidence.length,
      ordinary,
      accepted,
      replayed,
      unknown,
      over,
      clipped,
      strictProductionDecoders: true,
      actualSqlHttpBodies: true,
      rawBodiesUnmodified: true,
      exactMoneyString: true,
      canPlaceOrder: false,
      canPay: false,
      syntheticQaOnly: true,
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
    ordinary,
    accepted,
    replayed,
    clipped,
  }),
);

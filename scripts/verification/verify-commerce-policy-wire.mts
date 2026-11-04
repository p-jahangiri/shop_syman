import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { quoteSnapshotSchema } from '@sayman/web-shared/lib/checkout/quote-contract.ts';
import { quoteSnapshotV4Schema } from '../../apps/storefront/lib/checkout/quote-v4-contract.ts';
import { quoteSnapshotV5Schema } from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';
import {
  orderDetailSchema,
  createOrderResultSchema,
} from '@sayman/web-shared/lib/orders/order-contract.ts';
import {
  orderDetailV2Schema,
  createOrderResultV2Schema,
} from '@sayman/web-shared/lib/orders/order-v2-contract.ts';

const directory = process.argv[2];
assert.ok(directory, 'Pass the explicit synthetic SQL HTTP capture directory.');
const counts: Record<string, number> = {};
const hashes: Record<string, string> = {};
let unitemizedOrders = 0,
  postpaidOrders = 0,
  knownHistoricalOrders = 0;
for (const name of (await readdir(directory)).filter((n) => n.endsWith('.meta.json')).sort()) {
  const meta = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
  assert.equal(meta.actualSqlHttpResponse, true);
  assert.equal(meta.syntheticQaOnly, true);
  if (meta.status < 200 || meta.status >= 300) continue;
  const file = name.replace('.meta.json', '.json');
  const bytes = await readFile(`${directory}/${file}`);
  const raw = JSON.parse(bytes.toString('utf8'));
  let kind: string | null = null;
  let order:
    | ReturnType<typeof orderDetailSchema.parse>
    | ReturnType<typeof orderDetailV2Schema.parse>
    | null = null;
  const path = meta.path as string;
  if (/^\/api\/cart\/(fa|en)\/quote$/.test(path)) {
    quoteSnapshotSchema.parse(raw);
    kind = 'quote3';
  } else if (/^\/api\/cart\/(fa|en)\/v2\/quote$/.test(path)) {
    quoteSnapshotV4Schema.parse(raw);
    kind = 'quote4';
  } else if (/^\/api\/cart\/(fa|en)\/v2\/order-quote$/.test(path)) {
    quoteSnapshotV5Schema.parse(raw);
    kind = 'quote5';
  } else if (path === '/api/orders' && meta.method === 'POST') {
    order = createOrderResultSchema.parse(raw).order;
    kind = 'create1';
  } else if (path === '/api/orders/v2' && meta.method === 'POST') {
    order = createOrderResultV2Schema.parse(raw).order;
    kind = 'create2';
  } else if (/^\/api\/orders\/v2\/[a-f0-9]{32}$/.test(path)) {
    order = orderDetailV2Schema.parse(raw);
    kind = 'history2';
  } else if (/^\/api\/orders\/[a-f0-9]{32}$/.test(path)) {
    order = orderDetailSchema.parse(raw);
    kind = 'history1';
  }
  if (!kind) continue;
  if (order) {
    if (order.taxBreakdownKnown === false) {
      assert.equal(order.taxRial, null);
      assert.equal(order.taxIncluded, true);
      unitemizedOrders++;
    } else knownHistoricalOrders++;
    if (order.shippingMode === 'postpaid') {
      assert.equal(order.shippingRequired, true);
      assert.equal(order.shippingRial, '0');
      postpaidOrders++;
    }
  }
  counts[kind] = (counts[kind] ?? 0) + 1;
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
}
for (const kind of ['quote3', 'quote4', 'quote5', 'create1', 'create2', 'history1', 'history2'])
  assert.ok(counts[kind] > 0, `Missing ${kind} SQL wire coverage`);
assert.ok(unitemizedOrders > 0 && knownHistoricalOrders > 0 && postpaidOrders > 0);
const result = {
  passed: Object.values(counts).reduce((a, b) => a + b, 0),
  counts,
  unitemizedOrders,
  postpaidOrders,
  knownHistoricalOrders,
  syntheticQaOnly: true,
  sha256: hashes,
};
await writeFile(
  `${directory}/frontend-contract-report.json`,
  JSON.stringify(result, null, 2) + '\n',
  { mode: 0o600 },
);
process.stdout.write(JSON.stringify({ ...result, sha256: undefined }) + '\n');

import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  paymentPageSchema,
  readCustomerPaymentPage,
} from '../apps/storefront/lib/payment-contract.ts';
const directory = process.argv[2];
assert.ok(directory);
const rows = [];
const states = new Set<string>();
let admin = 0,
  customer = 0;
for (const name of (await readdir(directory)).filter((x) => x.endsWith('.meta.json')).sort()) {
  const meta = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
  assert.equal(meta.method, 'GET');
  assert.equal(meta.syntheticQaOnly, true);
  assert.equal(meta.status, 200);
  const file = name.replace('.meta.json', '.response.json'),
    raw = await readFile(`${directory}/${file}`),
    data = paymentPageSchema.parse(JSON.parse(raw.toString('utf8'))),
    url = new URL(meta.path, 'http://localhost');
  if (url.pathname.startsWith('/api/admin/')) {
    admin++;
    assert.equal(data.filter.state, url.searchParams.get('state'));
    assert.equal(data.filter.orderId, url.searchParams.get('orderId'));
  } else {
    customer++;
    const orderId = url.pathname.split('/').at(-1)!;
    readCustomerPaymentPage(data, orderId);
  }
  for (const item of data.items) {
    states.add(item.state);
    assert.equal(item.containsDemo, true);
    assert.equal(item.amountRial, '9007199254753338');
    if (item.state === 'review') assert.equal(item.verifiedAmountRial, '9007199254753339');
    if (item.state === 'verified') assert.equal(item.verifiedAmountRial, item.amountRial);
  }
  rows.push({
    file,
    method: 'GET',
    path: meta.path,
    status: 200,
    sha256: createHash('sha256').update(raw).digest('hex'),
    items: data.items.length,
  });
}
assert.ok(admin >= 4 && customer >= 6);
assert.deepEqual([...states].sort(), ['pending', 'review', 'verified']);
await writeFile(
  `${directory}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: rows.length,
      adminResponses: admin,
      customerResponses: customer,
      strictProductionDecoders: true,
      largeRialRemainedString: true,
      reviewDifferenceOneRialPreserved: true,
      rawBodiesUnmodified: true,
      syntheticQaOnly: true,
      providerIntegrationAccepted: false,
      entries: rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ passed: true, responses: rows.length, admin, customer }));

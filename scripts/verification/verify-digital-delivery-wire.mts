import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  digitalDeliveryInputSchema,
  digitalDeliveryMetadata,
  readAdminDigitalDeliveries,
  readCustomerDigitalDeliveries,
  readDigitalDeliveryContent,
  readDigitalDeliveryResult,
} from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import { readParcelPage } from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';

const directory = process.argv[2];
if (!directory) throw Error('Pass the explicit synthetic SQL HTTP capture directory.');
const hashes: Record<string, string> = {};
const read = async (name: string) => {
  const bytes = await readFile(`${directory}/${name}.json`);
  hashes[`${name}.json`] = createHash('sha256').update(bytes).digest('hex');
  return JSON.parse(bytes.toString('utf8'));
};
const raw = await read('digital-admin-before');
const page = readAdminDigitalDeliveries(raw, raw.ownerId, raw.orderId);
const blockedRaw = await read('digital-admin-uncommitted');
const blocked = readAdminDigitalDeliveries(blockedRaw, blockedRaw.ownerId, blockedRaw.orderId);
assert.equal(blocked.inventoryFingerprint, null);
assert.equal(blocked.canDeliver, false);
const input = digitalDeliveryInputSchema.parse(await read('digital-input'));
const metadata = digitalDeliveryMetadata(page, input);
const result = readDigitalDeliveryResult(await read('digital-result'), metadata);
const receipt = readDigitalDeliveryResult(await read('digital-receipt'), metadata);
assert.equal(result.replayed, false);
assert.equal(receipt.replayed, true);
assert.deepEqual(receipt.delivery, result.delivery);
const summary = readCustomerDigitalDeliveries(await read('digital-customer-summary'), page.orderId);
const delivery = summary.deliveries.find((item) => item.id === result.delivery.id);
assert.ok(delivery);
const content = readDigitalDeliveryContent(
  await read('digital-content'),
  page.orderId,
  result.delivery.id,
  delivery,
);
assert.equal(content.items[0].content, input.lines[0].contents[0]);
for (const digitalFirst of ['false', 'true']) {
  const parcelRaw = await read(`digital-mixed-v2-${digitalFirst}-parcels`);
  const parcel = readParcelPage(parcelRaw, parcelRaw.ownerId, parcelRaw.orderId);
  assert.equal(parcel.digitalDispatchCount, 1);
  assert.equal(parcel.dispatchCount, 2);
}
await writeFile(
  `${directory}/report.json`,
  JSON.stringify(
    {
      passed: 9,
      responses: 8,
      syntheticRequests: 1,
      scope:
        'Real SQL-backed HTTP contracts: blocked rights, private delivery, receipt replay, explicit content and both mixed handoff orders.',
      sha256: hashes,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write('9 digital delivery SQL wire contracts passed.\n');

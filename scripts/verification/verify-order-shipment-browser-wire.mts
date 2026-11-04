import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  shipmentInputSchema,
  shipmentResultSchema,
  shipmentTicks,
} from '@sayman/web-shared/lib/orders/order-shipment-contract.ts';
const root = process.argv[2];
assert.ok(root);
const entries = [];
for (let n = 1; n <= 6; n++) {
  const request = await readFile(`${root}/${n}.request.json`),
    response = await readFile(`${root}/${n}.response.json`),
    meta = JSON.parse(await readFile(`${root}/${n}.meta.json`, 'utf8')),
    input = shipmentInputSchema.parse(JSON.parse(request.toString('utf8'))),
    result = shipmentResultSchema.parse(JSON.parse(response.toString('utf8')));
  assert.equal(meta.status, 200);
  assert.equal(meta.method, 'POST');
  assert.equal(meta.path, `/api/admin/orders/${result.orderId}/shipment/commands`);
  assert.equal(result.commandId, input.commandId);
  assert.equal(result.action, input.action);
  assert.equal(result.reason, input.reason);
  assert.equal(result.inventoryFingerprint, input.inventoryFingerprint);
  if (input.action === 'dispatch') {
    assert.equal(result.shipment.trackingNumber, input.trackingNumber);
    assert.equal(shipmentTicks(result.shipment.dispatchedAt!), shipmentTicks(input.occurredAt!));
  }
  if (input.action === 'deliver')
    assert.equal(shipmentTicks(result.shipment.deliveredAt!), shipmentTicks(input.occurredAt!));
  entries.push({
    n,
    input,
    result,
    requestSha256: createHash('sha256').update(request).digest('hex'),
    responseSha256: createHash('sha256').update(response).digest('hex'),
  });
}
for (const [a, b] of [
  [0, 1],
  [3, 4],
]) {
  assert.equal(entries[a].requestSha256, entries[b].requestSha256);
  assert.equal(entries[a].result.replayed, false);
  assert.equal(entries[b].result.replayed, true);
  assert.deepEqual({ ...entries[a].result, replayed: true }, entries[b].result);
}
assert.deepEqual(
  entries.map((e) => e.input.action),
  ['pack', 'pack', 'repack', 'dispatch', 'dispatch', 'deliver'],
);
assert.deepEqual(
  entries.map((e) => e.result.shipment.packingRevision),
  [1, 1, 2, 2, 2, 2],
);
assert.equal(new Set(entries.map((e) => e.result.shipment.id)).size, 1);
assert.equal(entries[0].result.shipment.units[0].warrantyUntil, null);
assert.notEqual(entries[2].result.shipment.units[0].warrantyUntil, null);
assert.equal(entries[5].result.shipment.state, 'delivered');
await writeFile(
  `${root}/acceptance.json`,
  JSON.stringify(
    {
      passed: true,
      responses: 6,
      actualInputs: 6,
      strictProductionDecoders: true,
      sameBytesOnBothLostResponseRetries: true,
      twoHistoricalPackingRevisions: true,
      entries: entries.map(({ n, requestSha256, responseSha256, input, result }) => ({
        n,
        action: input.action,
        commandId: input.commandId,
        requestSha256,
        responseSha256,
        replayed: result.replayed,
        packingRevision: result.shipment.packingRevision,
      })),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  '6 actual browser responses accepted; both interrupted commands reused exact request bytes.',
);

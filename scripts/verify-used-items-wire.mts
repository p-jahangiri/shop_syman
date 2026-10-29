import { CapturedValues } from './captured-values.mts';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { usedDetail, usedChoices, usedResult } from '../apps/admin/src/used-items-contract.ts';
import { lookupResponseSchema } from '../apps/storefront/lib/catalog-contract.ts';
import { quoteSnapshotSchema } from '../apps/storefront/lib/quote-contract.ts';
import { quoteSnapshotV5Schema } from '../apps/storefront/lib/quote-v5-contract.ts';
import {
  createOrderResultSchema,
  orderDetailSchema,
} from '../apps/storefront/lib/order-contract.ts';
import {
  createOrderResultV2Schema,
  orderDetailV2Schema,
} from '../apps/storefront/lib/order-v2-contract.ts';
const schemas = {
  'used-result': usedResult,
  'used-detail': usedDetail,
  'used-choices': usedChoices,
  lookup: lookupResponseSchema,
  quote3: quoteSnapshotSchema,
  quote5: quoteSnapshotV5Schema,
  'order1-create': createOrderResultSchema,
  order1: orderDetailSchema,
  'order2-create': createOrderResultV2Schema,
  order2: orderDetailV2Schema,
};
const dir = path.resolve(process.argv[2] ?? 'artifacts/checks/used-items-sql-wire'),
  manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
assert.equal(manifest.actualSqlHttpBodies, true);
assert.equal(manifest.entries.length, 13);
const values = new CapturedValues();
for (const e of manifest.entries) {
  assert(/^[a-z0-9-]+\.json$/.test(e.file));
  assert(e.kind in schemas);
  const raw = await readFile(path.join(dir, e.file));
  assert(raw.length <= 1048576);
  assert.equal(createHash('sha256').update(raw).digest('hex'), e.sha256);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  values.set(e.file, schemas[e.kind as keyof typeof schemas].parse(value));
}
const first = values.read('save-first.json', usedResult),
  replay = values.read('save-replay.json', usedResult);
assert.equal(first.replayed, false);
assert.equal(replay.replayed, true);
assert.deepEqual(first.detail, replay.detail);
assert.ok(first.detail.inspection);
assert.equal(first.detail.inspection.batteryHealthPercent, 0);
assert.equal(values.read('detail.json', usedDetail).inspection?.batteryHealthPercent, 100);
assert(
  values
    .read('public-lookup.json', lookupResponseSchema)
    .products.some((p) => p.variants.some((v) => v.usedCondition?.batteryHealthPercent === 100)),
);
const old = values.read('order1-history.json', orderDetailSchema),
  adapted = values.read('order1-via2-history.json', orderDetailV2Schema);
assert.ok(old.lines[0].usedCondition);
assert.equal(old.lines[0].usedCondition.batteryHealthPercent, 0);
assert.deepEqual(old.lines[0].usedCondition, adapted.lines[0].usedCondition);
assert.equal(old.lines[0].unitPriceRial, '9007199254740993');
const mixed = values.read('order2-history.json', orderDetailV2Schema);
assert.equal(mixed.originalSnapshotVersion, 2);
const unit = mixed.lines.find((l) => l.lineKind === 'ordinary');
assert.ok(unit?.usedCondition);
assert.equal(unit.usedCondition.screenState, 'damaged');
assert.equal(unit.usedCondition.batteryHealthPercent, 0);
assert(
  mixed.lines
    .filter((l) => l.lineKind === 'acceptedOffer')
    .every((l) => l.usedCondition === undefined),
);
await writeFile(
  path.join(dir, 'acceptance.json'),
  JSON.stringify(
    {
      passed: true,
      responses: 13,
      strictProductionDecoders: true,
      rawHashesChecked: true,
      noNormalization: true,
      originalAndReplayedSameReport: true,
      order1AndOrder2HistoricalFacts: true,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  '13 actual SQL HTTP bodies accepted by production decoders; exact raw hashes and historical condition facts checked.',
);

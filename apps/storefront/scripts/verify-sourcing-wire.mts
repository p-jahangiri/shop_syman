import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  sourcingCartSchema,
  sourcingDetailSchema,
  sourcingRequestPageSchema,
  sourcingEventsSchema,
  sourcingMutationSchema,
} from '../lib/sourcing-contract.ts';
const directory = process.argv[2];
if (!directory) throw new Error('Supply the response-only SQL wire capture directory.');
const read = async (name: string) =>
  JSON.parse(await readFile(path.join(directory, name + '.json'), 'utf8'));
const cart = sourcingCartSchema.parse(await read('cart')),
  detail = sourcingDetailSchema.parse(await read('detail')),
  page = sourcingRequestPageSchema.parse(await read('page')),
  events = sourcingEventsSchema.parse(await read('events'));
const submit = sourcingMutationSchema.parse(await read('submit')),
  replay = sourcingMutationSchema.parse(await read('replay')),
  cancel = sourcingMutationSchema.parse(await read('cancel')),
  receipt = sourcingMutationSchema.parse(await read('receipt'));
assert.equal(submit.state, 'Submitted');
assert.equal(submit.replayed, false);
assert.equal(submit.id, detail.summary.id);
assert.equal(submit.reference, detail.summary.reference);
assert.equal(submit.version, detail.summary.version);
assert.equal(submit.at, detail.summary.createdAt);
assert.equal(detail.summary.state, 'Submitted');
assert.equal(detail.summary.locale, cart.locale);
assert.deepEqual(replay, { ...submit, replayed: true });
assert.deepEqual(receipt, { ...submit, replayed: true });
assert.equal(cancel.id, submit.id);
assert.equal(cancel.reference, submit.reference);
assert.equal(cancel.state, 'Cancelled');
assert.equal(cancel.replayed, false);
assert.ok(BigInt(cancel.eventId) > BigInt(submit.eventId));
assert.ok(Date.parse(cancel.at) >= Date.parse(submit.at));
assert.deepEqual(
  page.items.find((item) => item.id === detail.summary.id),
  detail.summary,
);
assert.ok(
  events.items.some(
    (event) =>
      event.id === submit.eventId &&
      event.stateBefore === null &&
      event.stateAfter === 'Submitted' &&
      event.at === submit.at,
  ),
);
assert.equal(detail.lines.length, cart.lines.length);
for (const selected of cart.lines) {
  const line = detail.lines.find((value) => value.listingId === selected.listingId);
  assert.ok(line);
  assert.equal(line.quantity, selected.quantity);
  assert.deepEqual(line.model, selected.candidate.model);
  for (const key of [
    'sourceNameFa',
    'sourceNameEn',
    'sourceUrl',
    'availability',
    'observedAt',
    'validUntil',
    'referencePriceRial',
    'referencePriceCurrent',
    'isDemo',
  ] as const)
    assert.deepEqual(line[key], selected.candidate[key], key);
}
const models = cart.lines.flatMap((line) => (line.candidate.model ? [line.candidate.model] : [])),
  attributes = models.flatMap((model) => model.attributes);
assert.ok(
  attributes.some(
    (attribute) =>
      attribute.dataType === 'Number' &&
      attribute.number !== null &&
      /^-?0(?:\.0+)?$/.test(attribute.number),
  ),
);
assert.ok(
  attributes.some((attribute) => attribute.dataType === 'Bool' && attribute.bool === false),
);
for (const type of ['Text', 'Number', 'Bool', 'Select', 'MultiSelect'])
  assert.ok(
    attributes.some((attribute) => attribute.dataType === type),
    `Missing actual ${type} snapshot capture.`,
  );
assert.ok(attributes.some((attribute) => attribute.unitFa !== null && attribute.unitEn !== null));
for (const line of detail.lines)
  assert.ok(line.referencePriceRial === null || typeof line.referencePriceRial === 'string');
console.log(
  JSON.stringify({
    result: 'passed',
    responseFiles: 8,
    typedAttributes: attributes.length,
    snapshotModels: models.length,
    requestId: submit.id,
    requestOnly: cart.requestOnly,
    canPay: cart.canPay,
  }),
);

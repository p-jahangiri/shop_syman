import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventorySupplyDetailSchema,
  inventorySupplyPageSchema,
  mappingInputSchema,
  mappingPageSchema,
  mappingSchema,
  receivingDataSchema,
  receivingInputSchema,
  receivingQuantity,
  sameReceivingSku,
  sourceKey,
  sourceQuantitySchema,
  supplyAdminDetailSchema,
  supplyAdminPageSchema,
  supplyMutationSchema,
  supplySourceSchema,
  supplySummarySchema,
} from '../src/api/contracts/market/supply-contract.ts';
import {
  supplyTestAdminDetail as detail,
  supplyTestAdminPage as page,
  supplyTestIds as ids,
  supplyTestInventory as inventory,
  supplyTestMapping as mapping,
  supplyTestMutation as mutation,
  supplyTestReceipt as receipt,
  supplyTestReceiptInput as input,
  supplyTestSummary as summary,
  supplyTestVersion as version,
} from './supply.test-fixtures.ts';
test('supply workflow and actual receipt progress stay independent of checkout or reservation', () => {
  assert.equal(supplyAdminDetailSchema.parse(detail).canPay, false);
  assert.equal(supplyAdminPageSchema.parse(page).startCandidate, null);
  assert.equal(
    supplySummarySchema.parse({
      ...summary,
      receivedQuantity: 1,
      remainingQuantity: 1,
      receiptProgress: 'Partial',
      effectiveState: 'PartiallyReceived',
    }).state,
    'PendingSupply',
  );
  assert.equal(
    supplySummarySchema.parse({
      ...summary,
      receivedQuantity: 2,
      remainingQuantity: 0,
      receiptProgress: 'Complete',
      effectiveState: 'Received',
    }).isOpen,
    true,
  );
  assert.equal(
    supplySummarySchema.safeParse({
      ...summary,
      receivedQuantity: 1,
      remainingQuantity: 1,
      effectiveState: 'Received',
    }).success,
    false,
  );
  for (const extra of [
    { reservedForRequest: true },
    { canPay: true },
    { canCheckout: true },
    { state: 'ReadyForCheckout' },
  ])
    assert.equal(supplyAdminDetailSchema.safeParse({ ...detail, ...extra }).success, false);
  assert.equal(supplyMutationSchema.parse(mutation).eventId, '9007199254740993');
});
test('staff supply fields are strict and bounded; inventory projection cannot contain owner, private note, supplier or price', () => {
  assert.equal(inventorySupplyDetailSchema.parse(inventory).stock[0].version, null);
  for (const extra of [
    { ownerId: 'qa' },
    { internalNote: 'private' },
    { sourceKey: 'supplier' },
    { totalRial: '9007199254740993' },
    { sourceNameFa: 'private supplier' },
  ])
    assert.equal(
      inventorySupplyDetailSchema.safeParse({ ...inventory, task: { ...inventory.task, ...extra } })
        .success,
      false,
    );
  assert.equal(
    supplyAdminDetailSchema.safeParse({ ...detail, internalNote: 'x'.repeat(2001) }).success,
    false,
  );
  assert.equal(
    supplyAdminDetailSchema.safeParse({ ...detail, lines: [detail.lines[0], detail.lines[0]] })
      .success,
    false,
  );
  assert.equal(
    inventorySupplyPageSchema.safeParse({
      schemaVersion: 1,
      pageSize: 50,
      items: [
        {
          requestId: ids.request,
          requestReference: 'SR-1',
          requestVersion: version,
          task: summary,
        },
      ],
      nextCursor: null,
    }).success,
    true,
  );
  assert.equal(
    inventorySupplyPageSchema.safeParse({
      schemaVersion: 1,
      pageSize: 50,
      items: [],
      nextCursor: '../private',
    }).success,
    false,
  );
});
test('start is authorized only by explicit new child candidate and keeps old Offer enums untouched', () => {
  const candidate = {
    offerId: ids.offer,
    acceptanceId: ids.acceptance,
    offerVersion: version,
    termsHash: 'A'.repeat(64),
    purchaseUntil: summary.purchaseUntil,
  };
  assert.equal(
    supplyAdminPageSchema.parse({ ...page, startCandidate: candidate }).startCandidate?.offerId,
    ids.offer,
  );
  assert.equal(
    supplyAdminPageSchema.safeParse({ ...page, startCandidate: { ...candidate, price: '1' } })
      .success,
    false,
  );
  assert.equal(
    supplyAdminPageSchema.safeParse({ ...page, items: Array.from({ length: 51 }, () => summary) })
      .success,
    false,
  );
});
test('external identities retain case, leading zero and Unicode instead of numeric or Unicode normalization', () => {
  assert.equal(sourceKey(120).parse('۰۰۱-Aa'), '۰۰۱-Aa');
  assert.equal(mappingSchema.parse(mapping).companyKey, '001');
  for (const value of ['', ' key', 'key ', 'key\n', 'a'.repeat(121)])
    assert.equal(sourceKey(120).safeParse(value).success, false);
  assert.notEqual(sourceKey(64).parse('Holoo'), sourceKey(64).parse('holoo'));
  assert.notEqual(sourceKey(64).parse('001'), sourceKey(64).parse('1'));
  assert.equal(sameReceivingSku('sku-01', 'SKU-01'), true);
  assert.equal(
    inventorySupplyDetailSchema.safeParse({
      ...inventory,
      stock: [inventory.stock[0], { ...inventory.stock[0], variantId: 'SKU-01' }],
    }).success,
    false,
  );
});
test('unit mapping requires an explicit exact positive ratio and nullable version only for create', () => {
  const { id: _id, version: _version, ...fields } = mapping;
  assert.equal(
    mappingInputSchema.parse({ ...fields, requestId: ids.command, version: null }).numerator,
    1,
  );
  for (const extra of [
    { numerator: 0 },
    { denominator: 0 },
    { numerator: 1.5 },
    { denominator: 1000001 },
    { companyKey: '01 ' },
    { version: undefined },
  ])
    assert.equal(
      mappingInputSchema.safeParse({ ...fields, requestId: ids.command, version: null, ...extra })
        .success,
      false,
    );
  assert.equal(
    mappingPageSchema.safeParse({
      schemaVersion: 1,
      pageSize: 50,
      items: [mapping, mapping],
      nextCursor: null,
    }).success,
    false,
  );
});
test('canonical decimal quantities use BigInt rational conversion without float, rounding or defaults', () => {
  assert.throws(() => receivingQuantity('0.00000001', 1000000, 1));
  assert.throws(() => receivingQuantity('9007199254740993', 1, 1000000));
  assert.equal(sourceQuantitySchema.parse('9007199254740993'), '9007199254740993');
});
test('exact conversion accepts bounded integers and fractions only when ratio produces a whole sales unit', () => {
  assert.equal(receivingQuantity('0.5', 2, 1), 1);
  assert.equal(receivingQuantity('3', 1, 3), 1);
  assert.equal(receivingQuantity('999999', 1, 1), 999999);
  assert.equal(receivingQuantity('0.000001', 1000000, 1), 1);
  for (const args of [
    ['1', 1, 3],
    ['1000001', 1, 1],
    ['99999999999999999999.99999999', 1, 1],
    ['1', 0, 1],
    ['1', 1, 0],
  ] as const)
    assert.throws(() => receivingQuantity(args[0], args[1], args[2]));
  for (const value of [
    '',
    '0',
    '01',
    '1.0',
    '1.',
    '+1',
    '1e2',
    '۱',
    '0.000000001',
    '123456789012345678901',
    '99999999999999999999.999999999',
  ])
    assert.equal(sourceQuantitySchema.safeParse(value).success, false);
  assert.equal(
    sourceQuantitySchema.parse('99999999999999999999.99999999'),
    '99999999999999999999.99999999',
  );
});
test('receipt input cannot supply SKU, owner, quantity entitlement, price, fractional unit output or implicit mode', () => {
  assert.equal(receivingInputSchema.parse(input).sourceReceiptKey, '000123');
  for (const extra of [{ ownerId: 'QA' }, { price: '1' }, { quantity: 1 }])
    assert.equal(receivingInputSchema.safeParse({ ...input, ...extra }).success, false);
  for (const extra of [
    { variantId: 'SKU-01' },
    { quantity: 1 },
    { trackingMode: 'imei', units: [] },
    { sourceQuantity: '' },
    { mappingVersion: null },
  ])
    assert.equal(
      receivingInputSchema.safeParse({ ...input, lines: [{ ...input.lines[0], ...extra }] })
        .success,
      false,
    );
  assert.equal(
    receivingInputSchema.safeParse({ ...input, receivedAt: '2026-10-24T03:30:00+03:30' }).success,
    false,
  );
  assert.equal(
    receivingInputSchema.safeParse({ ...input, lines: [input.lines[0], input.lines[0]] }).success,
    false,
  );
});
test('tracked delivery validates each device and alias uniqueness across the entire bounded command', () => {
  const line = {
    ...input.lines[0],
    trackingMode: 'imei',
    units: [{ serial: 'QA-SERIAL', imei1: '490154203237518', imei2: null }],
  };
  assert.equal(receivingInputSchema.safeParse({ ...input, lines: [line] }).success, true);
  assert.equal(
    receivingInputSchema.safeParse({
      ...input,
      lines: [{ ...line, units: [{ serial: null, imei1: '490154203237519', imei2: null }] }],
    }).success,
    false,
  );
  assert.equal(
    receivingInputSchema.safeParse({
      ...input,
      lines: [line, { ...line, sourceReceiptLineKey: '0002' }],
    }).success,
    false,
  );
  assert.equal(
    receivingInputSchema.safeParse({
      ...input,
      lines: [
        {
          ...line,
          units: Array.from({ length: 101 }, (_, i) => ({
            serial: 'QA-' + i,
            imei1: null,
            imei2: null,
          })),
        },
      ],
    }).success,
    false,
  );
});
test('historical receipt preserves exact document identity, ratio and bigint movement string and rejects corrupt conversion safely', () => {
  assert.equal(receivingDataSchema.parse(receipt).lines[0].movementId, '9007199254740993');
  for (const extra of [
    { denominator: 3 },
    { quantity: 2 },
    { trackingMode: 'serial', unitIds: [] },
    { sourceQuantity: '0' },
  ])
    assert.equal(
      receivingDataSchema.safeParse({ ...receipt, lines: [{ ...receipt.lines[0], ...extra }] })
        .success,
      false,
    );
  assert.equal(
    receivingDataSchema.safeParse({ ...receipt, actorPassword: 'secret' }).success,
    false,
  );
});
test('source reports require two public languages and explicit UTC while unknown ETA remains null', () => {
  const source = {
    requestId: ids.command,
    requestVersion: version,
    taskVersion: version,
    sourceKind: 'manual',
    sourceKey: '001',
    sourceNameFa: 'منبع',
    sourceNameEn: 'Source',
    reference: null,
    actionAt: '2026-10-24T00:00:00Z',
    expectedAt: null,
    publicMessageFa: 'پیگیری شد',
    publicMessageEn: 'Followed up',
    internalNote: null,
  };
  assert.equal(supplySourceSchema.parse(source).expectedAt, null);
  for (const extra of [
    { publicMessageEn: '' },
    { sourceKind: 'live-holoo' },
    { expectedAt: '2026-10-24T03:30:00+03:30' },
    { costRial: '0' },
  ])
    assert.equal(supplySourceSchema.safeParse({ ...source, ...extra }).success, false);
});

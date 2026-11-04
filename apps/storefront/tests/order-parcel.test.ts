import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parcelCommandSchema,
  parcelInputSchema,
  parcelDetailSchema,
  readParcelResult,
  readParcelPage,
  isCustomerFulfillmentPath,
  customerFulfillmentPath,
} from '@sayman/web-shared/lib/orders/order-parcel-contract.ts';
import { proxyOrderParcels } from '../lib/orders/order-parcel-proxy.ts';
import {
  parcelOrder,
  parcelId,
  parcelPage,
  parcelCommand,
  parcelResult,
  customerFulfillment,
} from '@sayman/web-shared/testing/order-parcel.test-fixtures.ts';
test('parcel selections cannot exceed remaining unpacked rights or manufacture unrelated devices', () => {
  const c = parcelCommand();
  assert.ok(parcelCommandSchema.safeParse(c).success);
  assert.equal(
    parcelCommandSchema.safeParse({
      ...c,
      input: { ...c.input, lines: [{ lineKey: 'LINE_A', quantity: 3, unitIds: [] }] },
    }).success,
    false,
  );
  assert.equal(
    parcelCommandSchema.safeParse({
      ...c,
      input: { ...c.input, lines: [{ lineKey: 'LINE_A', quantity: 1, unitIds: [parcelId] }] },
    }).success,
    false,
  );
  assert.equal(parcelInputSchema.safeParse({ ...c.input, acknowledge: false }).success, false);
  assert.equal(parcelInputSchema.safeParse({ ...c.input, paid: true }).success, false);
  const p = parcelPage();
  p.lines[0].packed = 2;
  p.canPack = false;
  assert.equal(parcelCommandSchema.safeParse({ ...c, before: p }).success, false);
});
test('mixed parcel contract separates digital ledger entries while preserving untouched physical-v1 receipts', () => {
  const original = parcelPage();
  assert.deepEqual(readParcelPage(original, 'OWNER', parcelOrder), original);
  const physical = original.lines[0],
    source = original.orderLines[0];
  const mixed = {
    ...original,
    digitalLineKeys: ['DIGITAL'],
    lines: [
      ...original.lines,
      { ...physical, lineKey: 'DIGITAL', variantId: 'DIGITAL_V', ordered: 2, remaining: 2 },
    ],
    orderLines: [
      ...original.orderLines,
      {
        ...source,
        lineKey: 'DIGITAL',
        variantId: 'DIGITAL_V',
        productId: 'DIGITAL_P',
        sku: 'CODE',
        name: 'Code',
        quantity: 2,
      },
    ],
  };
  assert.ok(readParcelPage(mixed, 'OWNER', parcelOrder));
  const delivered = {
    ...mixed,
    mode: 'parcels',
    dispatchCount: 1,
    digitalDispatchCount: 1,
    lines: mixed.lines.map((l) =>
      l.lineKey === 'DIGITAL' ? { ...l, dispatched: 1, delivered: 1, remaining: 1 } : l,
    ),
  };
  assert.equal(readParcelPage(delivered, 'OWNER', parcelOrder).activeParcelCount, 0);
  for (const bad of [
    { ...delivered, digitalLineKeys: ['DIGITAL', 'DIGITAL'] },
    { ...delivered, digitalLineKeys: ['OTHER'] },
    { ...delivered, digitalDispatchCount: 2 },
    { ...delivered, digitalDispatchCount: undefined },
    {
      ...delivered,
      orderLines: mixed.orderLines.map((l) =>
        l.lineKey === 'DIGITAL' ? { ...l, trackingMode: 'serial' } : l,
      ),
    },
    {
      ...delivered,
      lines: delivered.lines.map((l) => (l.lineKey === 'DIGITAL' ? { ...l, delivered: 0 } : l)),
    },
  ])
    assert.throws(() => readParcelPage(bad, 'OWNER', parcelOrder));
  const command = parcelCommand();
  assert.ok(parcelCommandSchema.safeParse({ ...command, before: mixed }).success);
  assert.equal(
    parcelCommandSchema.safeParse({
      ...command,
      before: mixed,
      input: { ...command.input, lines: [{ lineKey: 'DIGITAL', quantity: 1, unitIds: [] }] },
    }).success,
    false,
  );
});
test('parcel receipts preserve every reviewed immutable line, device, identity, timestamp and reason', () => {
  const c = parcelCommand(),
    r = parcelResult();
  assert.equal(readParcelResult(r, c).detail.parcel.number, '9007199254740993');
  for (const x of [
    { ...r, commandId: parcelId },
    { ...r, orderVersion: c.before.orderVersion },
    { ...r, reason: 'Different review' },
    { ...r, detail: { ...r.detail, parcel: { ...r.detail.parcel, reference: 'Different' } } },
    { ...r, detail: { ...r.detail, lines: [{ ...r.detail.lines[0], name: 'Changed product' }] } },
  ])
    assert.throws(() => readParcelResult(x, c));
  assert.throws(() => readParcelPage(parcelPage(), 'ANOTHER', parcelOrder));
  assert.equal(readParcelPage(parcelPage(), 'owner', parcelOrder).ownerId, 'OWNER');
});
test('customer identifiers are hidden before dispatch including voided parcels and cannot leak in a hidden detail', () => {
  const d = parcelResult().detail;
  assert.ok(parcelDetailSchema.safeParse({ ...d, unitDetailsVisible: false }).success);
  assert.equal(
    parcelDetailSchema.safeParse({
      ...d,
      unitDetailsVisible: false,
      units: [
        {
          unitId: parcelId,
          lineKey: 'LINE_A',
          variantId: 'VARIANT_A',
          serial: 'LEAK',
          imei1: null,
          imei2: null,
          warrantyUntil: null,
        },
      ],
    }).success,
    false,
  );
});
test('private customer parcel paths admit only exact GET pages and details with decimal bigint cursors', () => {
  const page = customerFulfillmentPath(parcelOrder),
    detail = customerFulfillmentPath(parcelOrder, parcelId);
  for (const p of [page, detail, page + '?after=9007199254740993'])
    assert.equal(isCustomerFulfillmentPath(p), true);
  for (const p of [
    page + '?after=01',
    page + '?after=9223372036854775808',
    detail + '?after=1',
    page + '?owner=OTHER',
    page + '?after=1&after=2',
    page + '/',
    page.replace(parcelOrder, '0'.repeat(32)),
  ])
    assert.equal(isCustomerFulfillmentPath(p), false);
  assert.equal(isCustomerFulfillmentPath(page, 'POST'), false);
});
test('customer parcel BFF verifies installed contract, private headers and owner binding without cookies or fallbacks', async () => {
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    path = customerFulfillmentPath(parcelOrder),
    headers = {
      Authorization: 'Bearer ' + 'x'.repeat(30),
      Cookie: 'must-not-forward=1',
      Origin: env.SHOP_PUBLIC_URL,
    },
    request = () => new Request(env.SHOP_PUBLIC_URL + path, { headers }),
    data = customerFulfillment();
  let called = 0;
  const fetcher = (async (url, init) => {
    called++;
    assert.equal(url, env.SHOP_API_URL + path);
    assert.equal(new Headers(init?.headers).get('Cookie'), null);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.cache, 'no-store');
    return Response.json(data, { headers: { 'X-Sayman-Fulfillment-Contract': 'parcels-v1' } });
  }) as typeof fetch;
  const ok = await proxyOrderParcels(request(), ['v2', parcelOrder, 'fulfillment'], env, fetcher);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('Cache-Control')!, /private, no-store/);
  assert.match(ok.headers.get('X-Robots-Tag')!, /noindex/);
  assert.equal(ok.headers.get('X-Sayman-Fulfillment-Contract'), 'parcels-v1');
  assert.equal(called, 1);
  for (const response of [
    () => Response.json(data),
    () =>
      Response.json(
        { ...data, orderId: parcelId },
        { headers: { 'X-Sayman-Fulfillment-Contract': 'parcels-v1' } },
      ),
    () =>
      Response.json(data, {
        headers: { 'X-Sayman-Fulfillment-Contract': 'parcels-v1', 'Set-Cookie': 'unsafe=1' },
      }),
    () => Response.json({ title: 'not_found' }, { status: 404 }),
    () => new Response('x'.repeat(524289)),
  ])
    assert.equal(
      (
        await proxyOrderParcels(request(), ['v2', parcelOrder, 'fulfillment'], env, (async () =>
          response()) as typeof fetch)
      ).status,
      503,
    );
  assert.equal(
    (
      await proxyOrderParcels(request(), ['v2', parcelOrder, 'fulfillment'], env, (async () =>
        Response.json(
          { title: 'not_found' },
          { status: 404, headers: { 'X-Sayman-Fulfillment-Contract': 'parcels-v1' } },
        )) as typeof fetch)
    ).status,
    404,
  );
});
test('valid historical warranty text above the legacy packing limit remains readable in a single bounded detail', async () => {
  const d = parcelResult().detail;
  d.unitDetailsVisible = false;
  d.lines[0].warranty = 'گارانتی تاریخی '.repeat(2000);
  const env = {
      SHOP_DATA_MODE: 'api',
      SHOP_API_URL: 'http://127.0.0.1:5080',
      SHOP_PUBLIC_URL: 'http://127.0.0.1:3000',
    },
    path = customerFulfillmentPath(parcelOrder, parcelId);
  const r = await proxyOrderParcels(
    new Request(env.SHOP_PUBLIC_URL + path, {
      headers: { Authorization: 'Bearer ' + 'x'.repeat(30) },
    }),
    ['v2', parcelOrder, 'fulfillment', 'parcels', parcelId],
    env,
    (async () =>
      Response.json(d, {
        headers: { 'X-Sayman-Fulfillment-Contract': 'parcels-v1' },
      })) as typeof fetch,
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).lines[0].warranty, d.lines[0].warranty);
});
test('the last dispatch slot requires every remaining item during explicit repacking and cannot strand reserved goods', () => {
  const c = parcelCommand(),
    p = parcelPage(),
    previous = parcelResult().detail;
  p.mode = 'parcels';
  p.dispatchCount = 63;
  p.activeParcelCount = 64;
  p.canPack = false;
  p.lines[0] = { ...p.lines[0], ordered: 65, packed: 1, dispatched: 63, remaining: 2 };
  p.orderLines[0].quantity = 65;
  const input = {
    ...c.input,
    action: 'repack',
    parcelId: previous.parcel.id,
    parcelVersion: previous.parcel.version,
    reference: null,
  };
  assert.equal(parcelCommandSchema.safeParse({ ...c, before: p, previous, input }).success, false);
  assert.equal(
    parcelCommandSchema.safeParse({
      ...c,
      before: p,
      previous,
      input: { ...input, lines: [{ lineKey: 'LINE_A', quantity: 2, unitIds: [] }] },
    }).success,
    true,
  );
});

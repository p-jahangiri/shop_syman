import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerDigitalPath,
  digitalBase,
  isCustomerDigitalPath,
  digitalContentBytes,
  digitalDeliveryInputSchema,
  digitalDeliveryMetadata,
  digitalDeliveryMetadataSchema,
  readAdminDigitalDeliveries,
  readCustomerDigitalDeliveries,
  readDigitalDeliveryContent,
  readDigitalDeliveryResult,
} from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import {
  digitalOrder,
  digitalDelivery,
  digitalPage,
  digitalInput,
  digitalResult,
  digitalContent,
  digitalSummary,
} from '@sayman/web-shared/testing/order-digital.test-fixtures.ts';

test('digital input preserves exact text, normalizes only CRLF and validates strict UTF8 byte/unit/batch limits', () => {
  const input = digitalInput();
  input.lines[0].contents = ['  <script>not HTML</script>\r\nکد\t😀  '];
  assert.equal(
    digitalDeliveryInputSchema.parse(input).lines[0].contents[0],
    '  <script>not HTML</script>\nکد\t😀  ',
  );
  assert.equal(digitalContentBytes('😀'), 4);
  for (const content of [
    '\ud800',
    '\udc00',
    '  ',
    'invalid\rline',
    'invalid\0',
    '\u0085',
    'ک'.repeat(2049),
  ])
    assert.equal(
      digitalDeliveryInputSchema.safeParse({
        ...input,
        lines: [{ lineKey: 'DIGITAL', contents: [content] }],
      }).success,
      false,
    );
  assert.ok(
    digitalDeliveryInputSchema.safeParse({
      ...input,
      lines: [{ lineKey: 'DIGITAL', contents: ['ک'.repeat(2048)] }],
    }).success,
  );
  assert.equal(
    digitalDeliveryInputSchema.safeParse({ ...input, acknowledge: false }).success,
    false,
  );
  assert.equal(digitalDeliveryInputSchema.safeParse({ ...input, paid: true }).success, false);
  assert.equal(
    digitalDeliveryInputSchema.safeParse({
      ...input,
      lines: [{ lineKey: 'DIGITAL', contents: Array(101).fill('x') }],
    }).success,
    false,
  );
  assert.equal(
    digitalDeliveryInputSchema.safeParse({
      ...input,
      lines: [{ lineKey: 'DIGITAL', contents: Array(17).fill('x'.repeat(4096)) }],
    }).success,
    false,
  );
  assert.equal(
    digitalDeliveryInputSchema.safeParse({
      ...input,
      lines: [
        { lineKey: 'DIGITAL', contents: ['x'] },
        { lineKey: 'digital', contents: ['x'] },
      ],
    }).success,
    false,
  );
});
test('digital command metadata binds current authority and contains no text, reason, content hash or request body', () => {
  const p = digitalPage(),
    i = digitalInput(),
    meta = digitalDeliveryMetadata(p, i);
  assert.equal(meta.lines[0].quantity, 1);
  for (const secret of ['PRIVATE-TEST-CODE', i.reason, 'contents', 'payloadHash'])
    assert.ok(!JSON.stringify(meta).includes(secret));
  for (const extra of [{ contents: ['secret'] }, { payloadHash: 'A'.repeat(64) }, { input: i }])
    assert.equal(digitalDeliveryMetadataSchema.safeParse({ ...meta, ...extra }).success, false);
  assert.throws(() => digitalDeliveryMetadata({ ...p, canDeliver: false }, i));
  assert.throws(() => digitalDeliveryMetadata(p, { ...i, inventoryFingerprint: 'B'.repeat(64) }));
  assert.throws(() =>
    digitalDeliveryMetadata(p, {
      ...i,
      lines: [{ lineKey: 'DIGITAL', contents: ['1', '2', '3'] }],
    }),
  );
  assert.throws(() =>
    digitalDeliveryMetadata(p, { ...i, lines: [{ lineKey: 'OTHER', contents: ['x'] }] }),
  );
});
test('digital preflight reserves worst-case UTF8 batch slots and rejects a selection that strands the remainder', () => {
  const page = digitalPage(),
    input = digitalInput();
  page.remainingDeliverySlots = 2;
  page.lines[0] = { ...page.lines[0], ordered: 18, remaining: 18 };
  assert.throws(() => digitalDeliveryMetadata(page, input), /digital_delivery_capacity_conflict/);
  const selected = { ...input, lines: [{ lineKey: 'DIGITAL', contents: ['one', 'two'] }] };
  assert.equal(digitalDeliveryMetadata(page, selected).lines[0].quantity, 2);
  page.remainingDeliverySlots = 1;
  assert.throws(
    () => digitalDeliveryMetadata(page, selected),
    /digital_delivery_capacity_conflict/,
  );
});
test('digital metadata history verifies every immutable identity, balance and owner without private content', () => {
  const p = digitalPage();
  assert.equal(readAdminDigitalDeliveries(p, 'owner', digitalOrder).ownerId, 'OWNER');
  const s = digitalSummary(),
    delivered = {
      ...p,
      remainingDeliverySlots: 63,
      lines: p.lines.map((l) => ({ ...l, available: 1, remaining: 1 })),
      deliveries: [s],
    };
  assert.ok(readAdminDigitalDeliveries(delivered, 'OWNER', digitalOrder));
  for (const value of [
    { ...p, ownerId: 'OTHER' },
    { ...delivered, lines: p.lines },
    { ...delivered, deliveries: [{ ...s, lines: [{ ...s.lines[0], sku: 'CHANGED' }] }] },
    { ...p, lines: [...p.lines, p.lines[0]] },
    { ...p, creditAuthorized: false },
    { ...p, content: 'secret' },
  ])
    assert.throws(() => readAdminDigitalDeliveries(value, 'OWNER', digitalOrder));
  const customer = { schemaVersion: 1, orderId: digitalOrder, deliveries: [s] };
  assert.equal(readCustomerDigitalDeliveries(customer, digitalOrder).deliveries.length, 1);
  assert.throws(() => readCustomerDigitalDeliveries(customer, digitalDelivery));
  assert.throws(() =>
    readCustomerDigitalDeliveries({ ...customer, deliveries: [{ ...s, items: [] }] }, digitalOrder),
  );
});
test('pre-allocation historical digital page is readable only as explicit nonactionable rights with a null fingerprint', () => {
  const p = digitalPage(),
    blocked = {
      ...p,
      orderState: 'AwaitingPayment',
      inventoryFingerprint: null,
      canDeliver: false,
      creditAuthorized: false,
      blockers: ['payment_not_confirmed', 'reservation_not_allocated'],
    };
  assert.equal(readAdminDigitalDeliveries(blocked, 'OWNER', p.orderId).inventoryFingerprint, null);
  for (const state of ['Expired', 'Cancelled'])
    assert.ok(readAdminDigitalDeliveries({ ...blocked, orderState: state }, 'OWNER', p.orderId));
  for (const bad of [
    { ...blocked, canDeliver: true },
    { ...blocked, creditAuthorized: true },
    { ...blocked, orderState: 'Paid' },
    { ...blocked, remainingDeliverySlots: 63 },
    { ...blocked, blockers: ['payment_not_confirmed'] },
    {
      ...blocked,
      lines: blocked.lines.map((l) => ({ ...l, available: 1, remaining: l.ordered - 1 })),
    },
    { ...blocked, deliveries: [digitalSummary()] },
  ])
    assert.throws(() => readAdminDigitalDeliveries(bad, 'OWNER', p.orderId));
  assert.throws(() =>
    digitalDeliveryMetadata(
      readAdminDigitalDeliveries(blocked, 'OWNER', p.orderId),
      digitalInput(),
    ),
  );
  assert.equal(
    digitalDeliveryInputSchema.safeParse({ ...digitalInput(), inventoryFingerprint: null }).success,
    false,
  );
});
test('digital receipts bind UUID/order/new version/exact identities and counts; plaintext is forbidden', () => {
  const meta = digitalDeliveryMetadata(digitalPage(), digitalInput()),
    r = digitalResult();
  assert.equal(readDigitalDeliveryResult(r, meta).delivery.id, digitalDelivery);
  assert.equal(readDigitalDeliveryResult({ ...r, replayed: true }, meta).replayed, true);
  for (const value of [
    { ...r, commandId: digitalDelivery },
    { ...r, orderId: digitalDelivery },
    { ...r, orderVersion: meta.orderVersion },
    { ...r, content: 'secret' },
    { ...r, delivery: { ...r.delivery, lines: [{ ...r.delivery.lines[0], quantity: 2 }] } },
    { ...r, delivery: { ...r.delivery, lines: [{ ...r.delivery.lines[0], name: 'Different' }] } },
  ])
    assert.throws(() => readDigitalDeliveryResult(value, meta));
});
test('explicit customer content is bound to the reviewed delivery timestamp, exact line counts and unique item ids', () => {
  const c = digitalContent(),
    summary = digitalSummary();
  assert.equal(
    readDigitalDeliveryContent(c, digitalOrder, digitalDelivery, summary).items[0].content,
    'PRIVATE-TEST-CODE',
  );
  for (const value of [
    { ...c, orderId: digitalDelivery },
    { ...c, deliveryId: digitalOrder },
    { ...c, availableAt: '2026-10-30T08:00:01Z' },
    { ...c, items: [...c.items, c.items[0]] },
    { ...c, items: [{ ...c.items[0], lineKey: 'OTHER' }] },
    { ...c, items: [{ ...c.items[0], content: '\ud800' }] },
  ])
    assert.throws(() => readDigitalDeliveryContent(value, digitalOrder, digitalDelivery, summary));
});
test('digital paths admit only canonical owned identities and preserve legacy versus V2 route distinction', () => {
  assert.equal(
    digitalBase('OWNER', digitalOrder),
    `/admin/orders/OWNER/${digitalOrder}/fulfillment/digital`,
  );
  assert.equal(
    customerDigitalPath(digitalOrder),
    `/api/orders/v2/${digitalOrder}/fulfillment/digital`,
  );
  assert.equal(
    customerDigitalPath(digitalOrder, digitalDelivery, false),
    `/api/orders/${digitalOrder}/fulfillment/digital/${digitalDelivery}/content`,
  );
  for (const bad of ['0'.repeat(32), digitalOrder + '/content', 'not-an-order'])
    assert.throws(() => customerDigitalPath(bad));
  assert.throws(() => digitalBase('../OWNER', digitalOrder));
  for (const v2 of [true, false]) {
    const path = customerDigitalPath(digitalOrder, undefined, v2),
      content = customerDigitalPath(digitalOrder, digitalDelivery, v2);
    assert.equal(isCustomerDigitalPath(path), true);
    assert.equal(isCustomerDigitalPath(content), true);
    for (const wrong of [
      path + '/',
      path + '?owner=OTHER',
      content + '?download=1',
      path.replace(digitalOrder, '0'.repeat(32)),
      content.replace(digitalDelivery, '0'.repeat(32)),
      path + '/commands/' + digitalDelivery,
    ])
      assert.equal(isCustomerDigitalPath(wrong), false);
    for (const method of ['POST', 'DELETE', 'HEAD'])
      assert.equal(isCustomerDigitalPath(path, method), false);
  }
});

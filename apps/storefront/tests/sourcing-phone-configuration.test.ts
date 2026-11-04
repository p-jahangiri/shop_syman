import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceSourcingCart } from '../lib/market/sourcing-client.ts';
import {
  sourcingCartInputSchema,
  sourcingCartSchema,
  sourcingDetailSchema,
} from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import {
  sourcingTestCart as legacy,
  sourcingTestCandidate as candidate,
  sourcingTestDetail as detail,
  sourcingTestModel as model,
} from '@sayman/web-shared/testing/sourcing.test-fixtures.ts';
import {
  phoneTestSnapshot as base,
  phoneTestOtherId as other,
} from './phone-discovery.test-fixtures.ts';
const snapshot = { ...base, modelId: model.id },
  row = {
    ...legacy.lines[0],
    configurationId: base.id,
    candidate: { ...candidate, configuration: snapshot },
  },
  cart = { ...legacy, lines: [row] };

test('legacy sourcing lines remain readable while phone selections require exact typed snapshots', () => {
  assert.equal(sourcingCartSchema.safeParse(legacy).success, true);
  assert.equal(sourcingCartSchema.safeParse(cart).success, true);
  for (const line of [
    { ...row, candidate },
    { ...row, candidate: { ...row.candidate, configuration: { ...snapshot, id: other } } },
    {
      ...row,
      candidate: { ...row.candidate, configuration: { ...snapshot, modelId: 'foreign-model' } },
    },
    { ...row, configurationId: undefined },
  ])
    assert.equal(sourcingCartSchema.safeParse({ ...cart, lines: [line] }).success, false);
  const issue = { ...row, candidate: { ...candidate, issue: 'configuration_unavailable' } };
  assert.equal(
    sourcingCartSchema.safeParse({ ...cart, lines: [issue], hasIssues: true }).success,
    true,
  );
  assert.equal(
    sourcingCartInputSchema.safeParse({
      version: cart.version,
      lines: [
        { listingId: row.listingId, configurationId: snapshot.id, quantity: 2 },
        { listingId: row.listingId, configurationId: other, quantity: 1 },
      ],
    }).success,
    false,
  );
});

test('sourcing replacement preserves selected configuration for every row and rejects omitted or substituted echoes', async () => {
  const second = {
      ...row,
      listingId: 'second-listing',
      quantity: 3,
      candidate: { ...row.candidate, listingId: 'second-listing' },
    },
    response = { ...cart, lines: [row, second] },
    input = sourcingCartInputSchema.parse({
      version: cart.version,
      lines: response.lines.map((l) => ({
        listingId: l.listingId,
        configurationId: l.configurationId,
        quantity: l.quantity,
      })),
    });
  const accepted = await replaceSourcingCart(
    async (path, init) => {
      assert.equal(path, '/api/cart/fa/sourcing');
      assert.equal(init.method, 'PUT');
      assert.deepEqual(JSON.parse(String(init.body)), input);
      return Response.json(response);
    },
    'fa',
    input,
  );
  assert.equal(accepted.lines[1].configurationId, snapshot.id);
  for (const value of [
    { ...response, lines: [row] },
    { ...response, lines: [{ ...row, configurationId: other }, second] },
    {
      ...response,
      lines: [
        { ...row, candidate: { ...row.candidate, configuration: { ...snapshot, id: other } } },
        second,
      ],
    },
    { ...response, lines: [{ ...row, configurationId: undefined, candidate }, second] },
  ])
    await assert.rejects(replaceSourcingCart(async () => Response.json(value), 'fa', input));
});

test('submitted phone requests retain their immutable configuration and bind it to the model snapshot', () => {
  const saved = { ...detail, lines: [{ ...detail.lines[0], configuration: snapshot }] };
  assert.equal(sourcingDetailSchema.safeParse(saved).success, true);
  assert.equal(
    sourcingDetailSchema.safeParse({
      ...saved,
      lines: [{ ...saved.lines[0], configuration: { ...snapshot, modelId: 'foreign-model' } }],
    }).success,
    false,
  );
  assert.equal(sourcingDetailSchema.safeParse(detail).success, true);
});

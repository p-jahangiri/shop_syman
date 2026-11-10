import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareSavedCartMove,
  readSavedCart,
  savedCartKey,
  SavedCartError,
  settleSavedCart,
  writeSavedCart,
} from '../lib/checkout/cart-saved.ts';

const sku = { variantId: 'A56-Black-256', quantity: 3 };
const other = { variantId: 'A56-Blue-128', quantity: 1 };

test('save stages the exact SKU before the cart write and recovers a lost response', () => {
  const move = prepareSavedCartMove({ items: [] }, [sku, other], 'save', 'a56-black-256');
  assert.deepEqual(move.lines, [other]);
  assert.deepEqual(settleSavedCart(move.journal, [sku, other]), { items: [] });
  assert.deepEqual(settleSavedCart(move.journal, [other]), { items: [sku] });
});

test('a rejected save leaves an earlier saved choice intact', () => {
  const earlier = { ...sku, quantity: 2 };
  const move = prepareSavedCartMove({ items: [earlier] }, [sku], 'save', sku.variantId);
  assert.deepEqual(settleSavedCart(move.journal, [sku]), { items: [earlier] });
  assert.deepEqual(settleSavedCart(move.journal, []), { items: [sku] });
});

test('restoring preserves the greater quantity and remains safe after a retry', () => {
  const current = [{ variantId: sku.variantId.toLowerCase(), quantity: 2 }, other];
  const state = { items: [sku] };
  const move = prepareSavedCartMove(state, current, 'restore', sku.variantId);
  const restored = [{ ...current[0], quantity: 3 }, other];
  assert.deepEqual(move.lines, restored);
  assert.deepEqual(settleSavedCart(move.journal, current), state);
  assert.deepEqual(prepareSavedCartMove(state, restored, 'restore', sku.variantId).lines, restored);
  assert.deepEqual(settleSavedCart(move.journal, restored), { items: [] });
});

test('storage separates accounts and guest entries and refuses malformed records', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const guest = savedCartKey('guest');
  const member = savedCartKey('member:a');
  writeSavedCart(storage, member, { items: [sku] });
  assert.deepEqual(readSavedCart(storage, member), { items: [sku] });
  assert.deepEqual(readSavedCart(storage, guest), { items: [] });
  assert.deepEqual(readSavedCart(storage, savedCartKey('member:b')), { items: [] });
  values.set(
    guest,
    JSON.stringify({ items: [sku, { ...sku, variantId: sku.variantId.toLowerCase() }] }),
  );
  assert.throws(() => readSavedCart(storage, guest), SavedCartError);
});

test('the saved list capacity is enforced before altering the cart', () => {
  const items = Array.from({ length: 64 }, (_, i) => ({ variantId: `sku-${i}`, quantity: 1 }));
  assert.throws(() => prepareSavedCartMove({ items }, [sku], 'save', sku.variantId), {
    message: 'limit',
  });
  const move = prepareSavedCartMove({ items }, [items[0]], 'save', items[0].variantId);
  assert.equal(settleSavedCart(move.journal, []).items.length, 64);
});

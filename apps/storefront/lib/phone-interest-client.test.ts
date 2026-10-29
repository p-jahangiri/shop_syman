import test from 'node:test';
import assert from 'node:assert/strict';
import { CartError, type CartFetch } from './cart-client.ts';
import {
  phoneInterest,
  phoneInterests,
  startPhoneInterest,
  pendingPhoneInterest,
  finishPhoneInterest,
  sendPhoneInterest,
  recoverPhoneInterest,
  type PhoneInterestCommand,
} from './phone-interest-client.ts';
import {
  phoneTestCommand as commandFixture,
  phoneTestResult as result,
  phoneTestInterest as interest,
  phoneTestInterestPage as page,
  phoneTestOtherId as other,
} from './phone-discovery.test-fixtures.ts';
const values = new Map<string, string>(),
  original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const storage = {
  getItem: (k: string) => values.get(k) ?? null,
  setItem: (k: string, v: string) => {
    values.set(k, v);
  },
  removeItem: (k: string) => {
    values.delete(k);
  },
};
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
test.after(() => {
  if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
  else Reflect.deleteProperty(globalThis, 'sessionStorage');
});
const command = () => structuredClone(commandFixture) as PhoneInterestCommand;
const isUnavailable = (error: unknown) => error instanceof CartError && error.status === 503;

test('interest reads validate cursor, use private point paths and reject foreign target echoes', async () => {
  assert.deepEqual(
    await phoneInterests(async (path, init) => {
      assert.equal(path, '/api/phones/interests?cursor=' + other);
      assert.equal(init.body, undefined);
      return Response.json(page);
    }, other),
    page,
  );
  await assert.rejects(
    phoneInterests(async () => {
      throw Error('must not fetch');
    }, 'BAD'),
  );
  const c = command();
  assert.deepEqual(
    await phoneInterest(
      async (path) => {
        assert.equal(path, '/api/phones/interests/' + c.listingId + '/' + c.input.configurationId);
        return Response.json(interest);
      },
      c.listingId,
      c.input.configurationId,
    ),
    interest,
  );
  for (const v of [
    { ...interest, listingId: 'foreign' },
    { ...interest, configuration: { ...interest.configuration, id: other } },
  ])
    await assert.rejects(
      phoneInterest(async () => Response.json(v), c.listingId, c.input.configurationId),
      isUnavailable,
    );
  assert.equal(
    await phoneInterest(
      async () => Response.json({ title: 'not_found' }, { status: 404 }),
      c.listingId,
      c.input.configurationId,
    ),
    null,
  );
  await assert.rejects(
    phoneInterest(
      async () => Response.json({ title: 'invalid_credentials' }, { status: 401 }),
      c.listingId,
      c.input.configurationId,
    ),
    (e) => e instanceof CartError && e.status === 401,
  );
});

test('interest commands freeze the exact body and UUID across a lost reply, 403 and receipt recovery', async () => {
  const c = command();
  startPhoneInterest(c);
  const bodies: string[] = [],
    fetcher: CartFetch = async (path, init) => {
      assert.equal(path, '/api/phones/interests/' + c.listingId + '/commands/' + c.requestId);
      assert.equal(init.method, 'PUT');
      bodies.push(String(init.body));
      if (bodies.length === 1) throw Error('Reply lost after commit');
      if (bodies.length === 2) return Response.json({ title: 'forbidden' }, { status: 403 });
      return Response.json({ ...result, replayed: true });
    };
  await assert.rejects(sendPhoneInterest(fetcher, c));
  assert.deepEqual(pendingPhoneInterest(c.owner), c);
  await assert.rejects(
    sendPhoneInterest(fetcher, pendingPhoneInterest(c.owner)!),
    (e) => e instanceof CartError && e.status === 403,
  );
  assert.deepEqual(pendingPhoneInterest(c.owner), c);
  const recovered = await recoverPhoneInterest(async (path, init) => {
    assert.equal(path, '/api/phones/interests/commands/' + c.requestId);
    assert.equal(init.body, undefined);
    return Response.json({ ...result, replayed: true });
  }, pendingPhoneInterest(c.owner)!);
  assert.equal(recovered.replayed, true);
  assert.equal((await sendPhoneInterest(fetcher, pendingPhoneInterest(c.owner)!)).replayed, true);
  assert.equal(new Set(bodies).size, 1);
  assert.equal(bodies[0], JSON.stringify(c.input));
  finishPhoneInterest(other, c.requestId);
  assert.deepEqual(pendingPhoneInterest(c.owner), c);
  finishPhoneInterest(c.owner, c.requestId);
  assert.equal(pendingPhoneInterest(c.owner), null);
});

test('pending commands are owner-scoped and another account cannot replace or finish an unresolved command', () => {
  const a = command(),
    b = { ...command(), owner: other, requestId: '12345678-1234-4234-8234-123456789abc' };
  startPhoneInterest(a);
  assert.equal(pendingPhoneInterest(other), null);
  startPhoneInterest(b);
  assert.deepEqual(pendingPhoneInterest(a.owner), a);
  assert.deepEqual(pendingPhoneInterest(other), b);
  assert.throws(() => startPhoneInterest(a), /phone_command_pending/);
  finishPhoneInterest(other, a.requestId);
  assert.deepEqual(pendingPhoneInterest(a.owner), a);
  assert.deepEqual(pendingPhoneInterest(other), b);
  finishPhoneInterest(a.owner, a.requestId);
  finishPhoneInterest(other, b.requestId);
});

test('retry journal remains immutable even when browser storage is unavailable', () => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      throw Error('storage disabled');
    },
  });
  const c = command();
  try {
    startPhoneInterest(c);
    c.input.active = false;
    const read = pendingPhoneInterest(c.owner)!;
    assert.equal(read.input.active, true);
    read.input.configurationId = other;
    assert.equal(
      pendingPhoneInterest(c.owner)!.input.configurationId,
      commandFixture.input.configurationId,
    );
    finishPhoneInterest(c.owner, c.requestId);
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  }
});

test('interest receipts bind target, request UUID and frozen active/cancel operation without clearing unknown commands', async () => {
  const c = command();
  startPhoneInterest(c);
  try {
    for (const value of [
      { ...result, requestId: '12345678-1234-4234-8234-123456789abc' },
      { ...result, interest: { ...interest, listingId: 'foreign' } },
      {
        ...result,
        interest: { ...interest, configuration: { ...interest.configuration, id: other } },
      },
      { ...result, interest: { ...interest, state: 'Cancelled' } },
      { ...result, canPay: true },
    ])
      for (const send of [sendPhoneInterest, recoverPhoneInterest]) {
        await assert.rejects(send(async () => Response.json(value), c));
        assert.deepEqual(pendingPhoneInterest(c.owner), c);
      }
    const cancelled = { ...c, input: { ...c.input, active: false, version: interest.version } };
    await assert.rejects(
      sendPhoneInterest(async () => Response.json(result), cancelled),
      isUnavailable,
    );
    assert.equal(
      (
        await sendPhoneInterest(
          async () => Response.json({ ...result, interest: { ...interest, state: 'Cancelled' } }),
          cancelled,
        )
      ).interest.state,
      'Cancelled',
    );
    await assert.rejects(
      recoverPhoneInterest(async () => Response.json({ title: 'not_found' }, { status: 404 }), c),
    );
    assert.deepEqual(pendingPhoneInterest(c.owner), c);
  } finally {
    finishPhoneInterest(c.owner, c.requestId);
  }
});

test('interest client rejects malformed command authority before any network action', async () => {
  let calls = 0;
  const fetcher: CartFetch = async () => {
    calls++;
    return Response.json(result);
  };
  for (const invalid of [
    { ...command(), owner: '' },
    { ...command(), owner: 'x'.repeat(65) },
    { ...command(), input: { ...command().input, priceRial: '1' } },
    { ...command(), listingId: '../admin' },
  ])
    for (const send of [sendPhoneInterest, recoverPhoneInterest])
      await assert.rejects(send(fetcher, invalid as PhoneInterestCommand));
  assert.equal(calls, 0);
});

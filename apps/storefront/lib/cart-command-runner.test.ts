import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createCartCommandRunner, pendingCartCommand } from './cart-command-runner.ts';
import { withCartLock, type CartFetch } from './cart-client.ts';
import {
  bindSourcingOwner,
  readSourcingJournal,
  startSourcingJournal,
  finishSourcingJournal,
  sourcingJournalBlocksNewIntent,
} from './sourcing-journal.ts';
import {
  cart2Command,
  cart2Mutation,
  cart2Snapshot,
  cart2Ids,
  cart2Removal,
} from './cart-v2.test-fixtures.ts';
import { sourcingSubmitSchema, sourcingMutationSchema } from './sourcing-contract.ts';
import { sourcingTestSubmit, sourcingTestMutation } from './sourcing.test-fixtures.ts';
import type { ServerCartV2 } from './cart-v2-contract.ts';
const owner = 'cart-command-customer';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
afterEach(() => bindSourcingOwner(null));
function runner(
  fetch: CartFetch,
  onFresh: (value: ServerCartV2) => Promise<void> = async () => {},
  active = () => true,
  onError?: (code: string) => void,
) {
  bindSourcingOwner(owner);
  return createCartCommandRunner({ owner, locale: 'fa', fetch, active, onFresh, onError });
}
test('known conversion receipt stays locked until fresh Cart2 is applied; retry never resends it', async () => {
  let writes = 0,
    reads = 0,
    applied = 0;
  const errors: string[] = [];
  const run = runner(
    async (_path, init) => {
      if (init.method === 'POST') {
        writes++;
        return Response.json(cart2Mutation());
      }
      if (++reads === 1) return Response.json({ title: 'unavailable' }, { status: 503 });
      return Response.json(cart2Snapshot('offer'));
    },
    async () => {
      applied++;
    },
    () => true,
    (code) => errors.push(code),
  );
  const command = cart2Command();
  assert.equal(await run(command), false);
  assert.equal(readSourcingJournal(owner)!.result, null);
  assert.equal(pendingCartCommand(owner)!.known, true);
  assert.equal(errors.at(-1), 'cart_refresh_required');
  assert.equal(await run(command, 'send'), true);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(applied, 1);
  assert.equal(readSourcingJournal(owner), null);
});
test('lost convert remains frozen across retry 4xx then same-UUID receipt recovery', async () => {
  let phase = 0;
  const bodies: string[] = [];
  const paths: string[] = [];
  const command = cart2Command();
  const run = runner(async (path, init) => {
    paths.push(path);
    if (init.method === 'POST') {
      bodies.push(init.body as string);
      if (++phase === 1) throw new TypeError('dropped response');
      return Response.json({ title: 'version_conflict' }, { status: 409 });
    }
    return Response.json(path.endsWith('/v2') ? cart2Snapshot('offer') : cart2Mutation(true));
  });
  assert.equal(await run(command), false);
  assert.equal(await run(command), false);
  assert.deepEqual(bodies, [JSON.stringify(command.body), JSON.stringify(command.body)]);
  assert.equal(pendingCartCommand(owner)!.uncertain, true);
  assert.equal(await run(command, 'receipt'), true);
  assert.match(paths[2], new RegExp('/commands/convert/' + command.body.requestId + '$'));
  assert.equal(readSourcingJournal(owner), null);
});
test('historical replay after expiry/removal applies only current Cart2 and cannot re-add entries', async () => {
  const command = cart2Command(),
    received: ServerCartV2[] = [];
  let step = 0;
  const run = runner(
    async (path) => {
      if (++step === 1) throw new TypeError('lost');
      return Response.json(
        path.endsWith('/v2')
          ? cart2Snapshot('empty')
          : { ...cart2Mutation(true), at: '2020-01-01T00:00:00+00:00' },
      );
    },
    async (value) => {
      received.push(value);
    },
  );
  assert.equal(await run(command), false);
  assert.equal(await run(command, 'receipt'), true);
  assert.equal(received[0].offerLines.length, 0);
  assert.equal(received[0].canCheckout, false);
  assert.equal(readSourcingJournal(owner), null);
});
test('receipt 404 or auth unavailable cannot clear an unresolved command or replace its UUID', async () => {
  let fail = false;
  const run = runner(async () => {
    if (!fail) {
      fail = true;
      throw new TypeError('lost');
    }
    return Response.json({ title: 'not_found' }, { status: 404 });
  });
  const command = cart2Command();
  assert.equal(await run(command), false);
  assert.equal(await run(command, 'receipt'), false);
  assert.deepEqual(pendingCartCommand(owner)!.command, command);
  const other = structuredClone(command);
  other.body.requestId = 'f'.repeat(32);
  assert.equal(await run(other), false);
  assert.deepEqual(pendingCartCommand(owner)!.command, command);
});
test('late same-owner result during auth unavailability preserves receipt without publishing; restore only GETs', async () => {
  let active = true;
  const gate = deferred<Response>(),
    started = deferred<void>();
  let calls = 0,
    applied = 0;
  const run = runner(
    async () => {
      calls++;
      started.resolve();
      return gate.promise;
    },
    async () => {
      applied++;
    },
    () => active,
  );
  const command = cart2Command(),
    flight = run(command);
  await started.promise;
  active = false;
  gate.resolve(Response.json(cart2Mutation()));
  assert.equal(await flight, false);
  assert.equal(applied, 0);
  assert.equal(pendingCartCommand(owner)!.known, true);
  active = true;
  const recover = createCartCommandRunner({
    owner,
    locale: 'fa',
    fetch: async (path, init) => {
      assert.equal(path, '/api/cart/fa/v2');
      assert.equal(init.method, 'GET');
      return Response.json(cart2Snapshot('offer'));
    },
    active: () => active,
    onFresh: async () => {
      applied++;
    },
  });
  assert.equal(await recover(command, 'refresh'), true);
  assert.equal(calls, 1);
  assert.equal(applied, 1);
});
test('late response from another owner can neither retain private history nor apply Cart2', async () => {
  const gate = deferred<Response>(),
    started = deferred<void>();
  let applied = 0,
    active = true;
  const run = runner(
    async () => {
      started.resolve();
      return gate.promise;
    },
    async () => {
      applied++;
    },
    () => active,
  );
  const command = cart2Command(),
    flight = run(command);
  await started.promise;
  active = false;
  bindSourcingOwner('other-customer');
  gate.resolve(Response.json(cart2Mutation()));
  assert.equal(await flight, false);
  assert.equal(applied, 0);
  assert.equal(readSourcingJournal(owner), null);
  assert.equal(readSourcingJournal('other-customer'), null);
});
test('one in-flight command blocks concurrent runners and all unfinished source intents', async () => {
  const gate = deferred<Response>(),
    started = deferred<void>();
  let writes = 0;
  const fetch: CartFetch = async (_path, init) => {
    if (init.method === 'POST') {
      writes++;
      started.resolve();
      return gate.promise;
    }
    return Response.json(cart2Snapshot('offer'));
  };
  const run = runner(fetch),
    command = cart2Command(),
    first = run(command);
  await started.promise;
  const competing = createCartCommandRunner({
    owner,
    locale: 'fa',
    fetch,
    active: () => true,
    onFresh: async () => {},
  });
  assert.equal(await competing(command), false);
  assert.throws(() =>
    startSourcingJournal(owner, {
      kind: 'submit',
      locale: 'fa',
      body: sourcingSubmitSchema.parse(sourcingTestSubmit),
    }),
  );
  gate.resolve(Response.json(cart2Mutation()));
  assert.equal(await first, true);
  assert.equal(writes, 1);
});
test('completed source receipt permits a new cart command but unresolved source command blocks it', async () => {
  bindSourcingOwner(owner);
  const source = {
    kind: 'submit' as const,
    locale: 'fa' as const,
    body: sourcingSubmitSchema.parse(sourcingTestSubmit),
  };
  startSourcingJournal(owner, source);
  let writes = 0;
  const run = createCartCommandRunner({
    owner,
    locale: 'fa',
    fetch: async (_path, init) => {
      if (init.method === 'POST') {
        writes++;
        return Response.json(cart2Mutation());
      }
      return Response.json(cart2Snapshot('offer'));
    },
    active: () => true,
    onFresh: async () => {},
  });
  assert.equal(await run(cart2Command()), false);
  assert.equal(writes, 0);
  assert.equal(
    finishSourcingJournal(
      owner,
      source.body.requestId,
      sourcingMutationSchema.parse(sourcingTestMutation),
    ),
    true,
  );
  assert.equal(await run(cart2Command()), true);
  assert.equal(writes, 1);
});
test('whole-group removal uses DELETE and the same receipt-before-fresh protocol', async () => {
  const original = cart2Command(),
    command = {
      kind: 'cart-remove' as const,
      id: cart2Ids.agreement,
      locale: 'fa' as const,
      body: { requestId: original.body.requestId, version: original.body.cartVersion! },
    };
  const methods: string[] = [];
  let step = 0;
  const run = runner(async (path, init) => {
    methods.push(init.method!);
    if (++step === 1) {
      assert.match(path, new RegExp('/offers/' + cart2Ids.agreement + '$'));
      return Response.json(cart2Removal());
    }
    assert.equal(pendingCartCommand(owner)!.known, true);
    return Response.json(cart2Snapshot('ordinary'));
  });
  assert.equal(await run(command), true);
  assert.deepEqual(methods, ['DELETE', 'GET']);
});
test('shared cart mutex serializes fallback writes and releases after failure', async () => {
  const gate = deferred<void>(),
    entered = deferred<void>(),
    sequence: string[] = [];
  const first = withCartLock(async () => {
    sequence.push('first');
    entered.resolve();
    await gate.promise;
    throw new Error('expected');
  });
  await entered.promise;
  const second = withCartLock(async () => {
    sequence.push('second');
    return 2;
  });
  await Promise.resolve();
  assert.deepEqual(sequence, ['first']);
  gate.resolve();
  await assert.rejects(first);
  assert.equal(await second, 2);
  assert.deepEqual(sequence, ['first', 'second']);
});
test('queued ordinary or inquiry write rechecks the owner journal after an uncertain conversion', async () => {
  const gate = deferred<Response>(),
    entered = deferred<void>();
  const run = runner(async () => {
    entered.resolve();
    return gate.promise;
  });
  const convert = run(cart2Command());
  await entered.promise;
  let wrote = false;
  const ordinary = withCartLock(async () => {
    if (sourcingJournalBlocksNewIntent(owner)) return false;
    wrote = true;
    return true;
  });
  gate.resolve(Response.json({ title: 'database_unavailable' }, { status: 503 }));
  assert.equal(await convert, false);
  assert.equal(await ordinary, false);
  assert.equal(wrote, false);
  assert.equal(sourcingJournalBlocksNewIntent('foreign-customer'), false);
  assert.equal(pendingCartCommand(owner)!.uncertain, true);
});

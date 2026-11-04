import test from 'node:test';
import assert from 'node:assert/strict';
import {
  submitSourcing,
  cancelSourcing,
  recoverSourcingCommand,
  recoverSourcingView,
  replaceSourcingCart,
} from '../lib/market/sourcing-client.ts';
import {
  sourcingSubmitSchema,
  sourcingCartInputSchema,
} from '@sayman/web-shared/lib/market/sourcing-contract.ts';
import {
  sourcingTestCart as cart,
  sourcingTestSubmit as submit,
  sourcingTestMutation as mutation,
  sourcingTestRequest as id,
  sourcingTestDetail as detail,
} from '@sayman/web-shared/testing/sourcing.test-fixtures.ts';
test('a lost submit retries the identical frozen UUID/body and treats malformed success as unknown', async () => {
  const command = sourcingSubmitSchema.parse(submit),
    bodies: string[] = [];
  let count = 0;
  const fetcher = async (_path: string, init: RequestInit) => {
    bodies.push(String(init.body));
    if (++count === 1) throw new Error('Response lost');
    return Response.json({ ...mutation, replayed: true });
  };
  await assert.rejects(submitSourcing(fetcher, 'fa', command));
  assert.equal((await submitSourcing(fetcher, 'fa', command)).replayed, true);
  assert.equal(bodies[0], bodies[1]);
  await assert.rejects(
    submitSourcing(async () => Response.json({ ...mutation, state: 'Reviewing' }), 'fa', command),
  );
});
test('cancel and receipt results are historical operation receipts and bind to the correct request and transition', async () => {
  const cancel = { requestId: submit.requestId, version: submit.cartVersion };
  assert.equal(
    (
      await cancelSourcing(
        async () => Response.json({ ...mutation, state: 'Cancelled' }),
        id,
        cancel,
      )
    ).state,
    'Cancelled',
  );
  await assert.rejects(cancelSourcing(async () => Response.json(mutation), id, cancel));
  await assert.rejects(
    cancelSourcing(
      async () => Response.json({ ...mutation, id: 'c'.repeat(32), state: 'Cancelled' }),
      id,
      cancel,
    ),
  );
  assert.equal(
    (
      await recoverSourcingCommand(
        async () => Response.json({ ...mutation, replayed: true }),
        'submit',
        submit.requestId,
      )
    ).state,
    'Submitted',
  );
  await assert.rejects(
    recoverSourcingCommand(
      async () => Response.json({ ...mutation, replayed: true, state: 'Reviewing' }),
      'submit',
      submit.requestId,
    ),
  );
});
test('sourcing selection does not accept clipped, injected or foreign success rows', async () => {
  const input = sourcingCartInputSchema.parse({
    version: cart.version,
    lines: cart.lines.map((line) => ({ listingId: line.listingId, quantity: line.quantity })),
  });
  assert.equal(
    (await replaceSourcingCart(async () => Response.json(cart), 'fa', input)).lines[0].quantity,
    2,
  );
  await assert.rejects(
    replaceSourcingCart(
      async () => Response.json({ ...cart, lines: [{ ...cart.lines[0], quantity: 1 }] }),
      'fa',
      input,
    ),
  );
  await assert.rejects(
    replaceSourcingCart(async () => Response.json({ ...cart, locale: 'en' }), 'fa', input),
  );
});

test('recovering an old submission reads current detail and history without restoring its historical version', async () => {
  const currentVersion = 'AAAAAAAAAAI=',
    later = '2026-10-23T12:31:00+00:00',
    paths: string[] = [];
  const current = {
    ...detail,
    summary: { ...detail.summary, state: 'Cancelled', version: currentVersion, changedAt: later },
    canCancel: false,
  };
  const events = {
    schemaVersion: 1,
    pageSize: 20,
    nextCursor: null,
    items: [
      {
        id: mutation.eventId,
        stateBefore: null,
        stateAfter: 'Submitted',
        actorKind: 'customer',
        reasonCode: 'submitted',
        publicMessage: '',
        at: mutation.at,
      },
      {
        id: String(BigInt(mutation.eventId) + 1n),
        stateBefore: 'Submitted',
        stateAfter: 'Cancelled',
        actorKind: 'customer',
        reasonCode: 'customer_cancelled',
        publicMessage: '',
        at: later,
      },
    ],
  };
  const result = await recoverSourcingView(
    async (path, init) => {
      paths.push(path);
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      return Response.json(
        path.includes('/commands/')
          ? { ...mutation, replayed: true }
          : path.endsWith('/events')
            ? events
            : current,
      );
    },
    'submit',
    submit.requestId,
    id,
  );
  assert.deepEqual(paths, [
    `/api/sourcing/requests/commands/submit/${submit.requestId}`,
    `/api/sourcing/requests/${id}`,
    `/api/sourcing/requests/${id}/events`,
  ]);
  assert.equal(result.receipt.state, 'Submitted');
  assert.equal(result.receipt.version, mutation.version);
  assert.equal(result.current!.detail.summary.state, 'Cancelled');
  assert.equal(result.current!.detail.summary.version, currentVersion);
  assert.equal(result.current!.detail.canCancel, false);
  assert.equal(result.current!.events.items.at(-1)!.stateAfter, 'Cancelled');
  assert.equal(result.refreshFailed, false);
});
test('receipt lookup for another request cannot replace or reload the request being viewed', async () => {
  const paths: string[] = [];
  const result = await recoverSourcingView(
    async (path) => {
      paths.push(path);
      return Response.json({ ...mutation, state: 'Cancelled', replayed: true });
    },
    'cancel',
    submit.requestId,
    'c'.repeat(32),
  );
  assert.deepEqual(paths, [`/api/sourcing/requests/commands/cancel/${submit.requestId}`]);
  assert.equal(result.current, null);
  assert.equal(result.refreshFailed, false);
  assert.equal(result.receipt.id, id);
});
test('a confirmed receipt remains known when current-view loading fails and yields no stale actionable detail', async () => {
  const result = await recoverSourcingView(
    async (path) =>
      path.includes('/commands/')
        ? Response.json({ ...mutation, state: 'Cancelled', replayed: true })
        : Response.json({ title: 'sourcing_unavailable' }, { status: 503 }),
    'cancel',
    submit.requestId,
    id,
  );
  assert.equal(result.receipt.state, 'Cancelled');
  assert.equal(result.receipt.replayed, true);
  assert.equal(result.current, null);
  assert.equal(result.refreshFailed, true);
});

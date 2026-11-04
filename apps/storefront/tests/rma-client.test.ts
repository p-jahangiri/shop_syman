import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RmaError,
  rmaRequest,
  RMA_RESPONSE_LIMIT,
} from '@sayman/web-shared/lib/orders/rma-client.ts';
test('RMA transport requires finite success marker and rejects oversized request before sending', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json(
      { schemaVersion: 1 },
      { headers: { 'X-Sayman-Returns-Contract': 'rma-v1' } },
    );
  };
  assert.deepEqual(await rmaRequest(fetcher, '/api/returns'), { schemaVersion: 1 });
  await assert.rejects(
    () => rmaRequest(fetcher, '/api/returns', { method: 'PUT', body: 'x'.repeat(32769) }),
    (e) => e instanceof RmaError && e.status === 400,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () => rmaRequest(async () => Response.json({ schemaVersion: 1 }), '/api/returns'),
    (e) => e instanceof RmaError && e.status === 503,
  );
});
test('RMA streamed response cap enforces actual bytes with no Content-Length and preserves HTTP problem code', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(RMA_RESPONSE_LIMIT + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () => rmaRequest(async () => new Response(stream), '/api/returns'),
    (e) => e instanceof RmaError && e.status === 503,
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    () =>
      rmaRequest(
        async () => Response.json({ title: 'rma_capacity_conflict' }, { status: 409 }),
        '/api/returns',
      ),
    (e) => e instanceof RmaError && e.status === 409 && e.code === 'rma_capacity_conflict',
  );
});

test('empty anonymous401/403 retain actual auth status without accepting success lacking the contract marker', async () => {
  for (const status of [401, 403])
    await assert.rejects(
      () => rmaRequest(async () => new Response(null, { status }), '/api/returns'),
      (e) => e instanceof RmaError && e.status === status,
    );
});

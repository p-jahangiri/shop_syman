import test from 'node:test';
import assert from 'node:assert/strict';
import { CartError } from './cart-client.ts';
import {
  decideSourcingOffer,
  listSourcingOffers,
  readSourcingOffer,
  readSourcingOfferView,
  recoverSourcingOffer,
  recoverSourcingOfferView,
} from './offer-client.ts';
import {
  offerTestAction as action,
  offerTestDetail as detail,
  offerTestEvents as events,
  offerTestId as id,
  offerTestMutation as mutation,
  offerTestPage as page,
  offerTestRequest as requestId,
} from './offer.test-fixtures.ts';
test('offer client binds detail and page to the requested parent and child', async () => {
  assert.equal(
    (await readSourcingOffer(async () => Response.json(detail), requestId, id)).offer.summary.id,
    id,
  );
  assert.equal(
    (await listSourcingOffers(async () => Response.json(page), requestId)).requestId,
    requestId,
  );
  for (const value of [
    { ...detail, requestId: 'f'.repeat(32) },
    {
      ...detail,
      offer: { ...detail.offer, summary: { ...detail.offer.summary, id: 'f'.repeat(32) } },
    },
  ])
    await assert.rejects(
      readSourcingOffer(async () => Response.json(value), requestId, id),
      (e) => e instanceof CartError && e.status === 503,
    );
  await assert.rejects(
    listSourcingOffers(
      async () => Response.json({ ...page, requestId: 'f'.repeat(32) }),
      requestId,
    ),
  );
});
test('a fresh child view never combines mismatched request versions into actionable capabilities', async () => {
  const fetcher = async (path: string) =>
    Response.json(
      path.endsWith('/events')
        ? events
        : path.endsWith('/offers')
          ? { ...page, requestVersion: 'AAAAAAAAAAI=' }
          : detail,
    );
  await assert.rejects(
    readSourcingOfferView(fetcher, requestId, id),
    (error) => error instanceof CartError && error.status === 503,
  );
  const recovered = await recoverSourcingOfferView(
    async (path) =>
      path.includes('/commands/') ? Response.json({ ...mutation, replayed: true }) : fetcher(path),
    requestId,
    id,
    'accept',
    action.requestId,
  );
  assert.equal(recovered.receipt.replayed, true);
  assert.equal(recovered.current, null);
  assert.equal(recovered.refreshFailed, true);
});
test('offer consent sends exact explicit action and rejects other command acknowledgements', async () => {
  const value = await decideSourcingOffer(
    async (path, init) => {
      assert.equal(path, `/api/sourcing/requests/${requestId}/offers/${id}/accept`);
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(String(init.body)), action);
      return Response.json(mutation);
    },
    requestId,
    id,
    'accept',
    action,
  );
  assert.equal(value.acceptanceId, mutation.acceptanceId);
  for (const wrong of [
    { ...mutation, requestId: 'f'.repeat(32) },
    { ...mutation, offerId: 'f'.repeat(32) },
    { ...mutation, operation: 'decline', state: 'Declined', acceptanceId: null },
  ])
    await assert.rejects(
      decideSourcingOffer(async () => Response.json(wrong), requestId, id, 'accept', action),
    );
});
test('receipt is historical and requires a replay acknowledgement; view refresh reads current child and capabilities', async () => {
  await assert.rejects(
    recoverSourcingOffer(
      async () => Response.json(mutation),
      requestId,
      id,
      'accept',
      action.requestId,
    ),
  );
  const current = {
    ...detail,
    requestVersion: 'AAAAAAAAAAI=',
    offer: {
      ...detail.offer,
      summary: {
        ...detail.offer.summary,
        version: 'AAAAAAAAAAM=',
        state: 'Accepted',
        effectiveState: 'Accepted',
        acceptedAt: mutation.at,
      },
      acceptanceId: mutation.acceptanceId,
    },
    canAccept: false,
    canDecline: false,
    canCancelRequest: false,
  };
  const value = await recoverSourcingOfferView(
    async (path) =>
      Response.json(
        path.includes('/commands/')
          ? { ...mutation, replayed: true }
          : path.endsWith('/events')
            ? events
            : path.endsWith('/offers')
              ? { ...page, requestVersion: current.requestVersion, canCancelRequest: false }
              : current,
      ),
    requestId,
    id,
    'accept',
    action.requestId,
  );
  assert.equal(value.receipt.version, mutation.version);
  assert.equal(value.current?.detail.offer.summary.version, 'AAAAAAAAAAM=');
  assert.equal(value.current?.page.canCancelRequest, false);
  assert.equal(value.refreshFailed, false);
  const failed = await recoverSourcingOfferView(
    async (path) =>
      path.includes('/commands/')
        ? Response.json({ ...mutation, replayed: true })
        : Response.json({ title: 'unavailable' }, { status: 503 }),
    requestId,
    id,
    'accept',
    action.requestId,
  );
  assert.equal(failed.receipt.offerId, id);
  assert.equal(failed.current, null);
  assert.equal(failed.refreshFailed, true);
});

import { CartError, type CartFetch } from './cart-client.ts';
import {
  offerActionSchema,
  offerCommandIdSchema,
  offerDetailSchema,
  offerEventsSchema,
  offerIdSchema,
  offerMutationSchema,
  offerPageSchema,
  offerMutationMatches,
  type OfferAction,
} from './offer-contract.ts';

async function call(
  fetcher: CartFetch,
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetcher(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let code = 'sourcing_offer_unavailable';
    try {
      const value = await response.json();
      if (typeof value.title === 'string' && /^[a-z_]{1,100}$/.test(value.title))
        code = value.title;
    } catch {
      /* Preserve the status-based error when the optional response body is invalid. */
    }
    throw new CartError(code, response.status);
  }
  return response.json();
}
function path(requestId: string, offerId?: string) {
  if (
    !offerIdSchema.safeParse(requestId).success ||
    (offerId !== undefined && !offerIdSchema.safeParse(offerId).success)
  )
    throw new CartError('not_found', 404);
  return `/api/sourcing/requests/${requestId}/offers${offerId ? '/' + offerId : ''}`;
}
function pageCursor(cursor: string | null) {
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    throw new CartError('invalid_sourcing_offer', 400);
  return cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
}
export async function listSourcingOffers(
  fetcher: CartFetch,
  requestId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  const result = offerPageSchema.parse(
    await call(fetcher, path(requestId) + pageCursor(cursor), 'GET', undefined, signal),
  );
  if (result.requestId !== requestId) throw new CartError('sourcing_offer_unavailable', 503);
  return result;
}
export async function readSourcingOffer(
  fetcher: CartFetch,
  requestId: string,
  offerId: string,
  signal?: AbortSignal,
) {
  const result = offerDetailSchema.parse(
    await call(fetcher, path(requestId, offerId), 'GET', undefined, signal),
  );
  if (result.requestId !== requestId || result.offer.summary.id !== offerId)
    throw new CartError('sourcing_offer_unavailable', 503);
  return result;
}
export async function sourcingOfferEvents(
  fetcher: CartFetch,
  requestId: string,
  offerId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  return offerEventsSchema.parse(
    await call(
      fetcher,
      path(requestId, offerId) + '/events' + pageCursor(cursor),
      'GET',
      undefined,
      signal,
    ),
  );
}
export async function decideSourcingOffer(
  fetcher: CartFetch,
  requestId: string,
  offerId: string,
  operation: 'accept' | 'decline',
  input: OfferAction,
  signal?: AbortSignal,
) {
  if (!['accept', 'decline'].includes(operation))
    throw new CartError('invalid_sourcing_offer', 400);
  const result = offerMutationSchema.parse(
    await call(
      fetcher,
      path(requestId, offerId) + '/' + operation,
      'POST',
      offerActionSchema.parse(input),
      signal,
    ),
  );
  if (!offerMutationMatches(result, requestId, offerId, operation))
    throw new CartError('sourcing_offer_unavailable', 503);
  return result;
}
export async function recoverSourcingOffer(
  fetcher: CartFetch,
  requestId: string,
  offerId: string,
  operation: 'accept' | 'decline',
  commandId: string,
  signal?: AbortSignal,
) {
  if (
    !['accept', 'decline'].includes(operation) ||
    !offerCommandIdSchema.safeParse(commandId).success
  )
    throw new CartError('invalid_sourcing_offer', 400);
  const result = offerMutationSchema.parse(
    await call(
      fetcher,
      path(requestId, offerId) + `/commands/${operation}/${commandId}`,
      'GET',
      undefined,
      signal,
    ),
  );
  if (!result.replayed || !offerMutationMatches(result, requestId, offerId, operation))
    throw new CartError('sourcing_offer_unavailable', 503);
  return result;
}
export async function readSourcingOfferView(
  fetcher: CartFetch,
  requestId: string,
  offerId: string,
  signal?: AbortSignal,
) {
  const [detail, events, page] = await Promise.all([
    readSourcingOffer(fetcher, requestId, offerId, signal),
    sourcingOfferEvents(fetcher, requestId, offerId, null, signal),
    listSourcingOffers(fetcher, requestId, null, signal),
  ]);
  if (detail.requestVersion !== page.requestVersion)
    throw new CartError('sourcing_offer_unavailable', 503);
  return { detail, events, page };
}
// A receipt acknowledges the historical command only. Re-read this child
// aggregate and its request capabilities before presenting any new action.
export async function recoverSourcingOfferView(
  fetcher: CartFetch,
  requestId: string,
  offerId: string,
  operation: 'accept' | 'decline',
  commandId: string,
  signal?: AbortSignal,
) {
  const receipt = await recoverSourcingOffer(
    fetcher,
    requestId,
    offerId,
    operation,
    commandId,
    signal,
  );
  try {
    return {
      receipt,
      current: await readSourcingOfferView(fetcher, requestId, offerId, signal),
      refreshFailed: false,
    };
  } catch {
    return { receipt, current: null, refreshFailed: true };
  }
}
export type OfferRecoveryResult = Awaited<ReturnType<typeof recoverSourcingOfferView>>;

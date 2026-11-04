import { CartError, type CartFetch } from '../checkout/cart-client.ts';
import {
  sourcingCartSchema,
  sourcingCartInputSchema,
  sourcingSubmitSchema,
  sourcingMutationSchema,
  sourcingRequestPageSchema,
  sourcingDetailSchema,
  sourcingEventsSchema,
  sourcingCancelSchema,
  type SourcingCartInput,
  type SourcingSubmit,
  type SourcingCancel,
  type SourcingMutation,
  type SourcingDetail,
  type SourcingEvents,
} from '@sayman/web-shared/lib/market/sourcing-contract.ts';
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
    let code = 'sourcing_unavailable';
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
export async function readSourcingCart(
  fetcher: CartFetch,
  locale: 'fa' | 'en',
  signal?: AbortSignal,
) {
  const result = sourcingCartSchema.parse(
    await call(fetcher, `/api/cart/${locale}/sourcing`, 'GET', undefined, signal),
  );
  if (result.locale !== locale) throw new CartError('sourcing_unavailable', 503);
  return result;
}
export async function replaceSourcingCart(
  fetcher: CartFetch,
  locale: 'fa' | 'en',
  input: SourcingCartInput,
  signal?: AbortSignal,
) {
  const command = sourcingCartInputSchema.parse(input),
    result = sourcingCartSchema.parse(
      await call(fetcher, `/api/cart/${locale}/sourcing`, 'PUT', command, signal),
    );
  if (
    result.locale !== locale ||
    result.lines.length !== command.lines.length ||
    result.lines.some(
      (line) =>
        !command.lines.some(
          (item) =>
            item.listingId === line.listingId &&
            item.quantity === line.quantity &&
            item.configurationId === line.configurationId,
        ),
    )
  )
    throw new CartError('sourcing_unavailable', 503);
  return result;
}
export async function submitSourcing(
  fetcher: CartFetch,
  locale: 'fa' | 'en',
  input: SourcingSubmit,
  signal?: AbortSignal,
) {
  const result = sourcingMutationSchema.parse(
    await call(
      fetcher,
      `/api/cart/${locale}/sourcing/submit`,
      'POST',
      sourcingSubmitSchema.parse(input),
      signal,
    ),
  );
  if (result.state !== 'Submitted') throw new CartError('sourcing_unavailable', 503);
  return result;
}
function requestPath(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new CartError('not_found', 404);
  return `/api/sourcing/requests/${id}`;
}
const cursorPart = (cursor: string | null) => {
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    throw new CartError('invalid_sourcing_input', 400);
  return cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
};
export async function listSourcing(
  fetcher: CartFetch,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  return sourcingRequestPageSchema.parse(
    await call(fetcher, '/api/sourcing/requests' + cursorPart(cursor), 'GET', undefined, signal),
  );
}
export async function readSourcing(fetcher: CartFetch, id: string, signal?: AbortSignal) {
  const result = sourcingDetailSchema.parse(
    await call(fetcher, requestPath(id), 'GET', undefined, signal),
  );
  if (result.summary.id !== id) throw new CartError('sourcing_unavailable', 503);
  return result;
}
export async function sourcingEvents(
  fetcher: CartFetch,
  id: string,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  return sourcingEventsSchema.parse(
    await call(fetcher, requestPath(id) + '/events' + cursorPart(cursor), 'GET', undefined, signal),
  );
}
export async function cancelSourcing(
  fetcher: CartFetch,
  id: string,
  input: SourcingCancel,
  signal?: AbortSignal,
) {
  const result = sourcingMutationSchema.parse(
    await call(
      fetcher,
      requestPath(id) + '/cancel',
      'POST',
      sourcingCancelSchema.parse(input),
      signal,
    ),
  );
  if (result.id !== id || result.state !== 'Cancelled')
    throw new CartError('sourcing_unavailable', 503);
  return result;
}
export async function recoverSourcingCommand(
  fetcher: CartFetch,
  operation: 'submit' | 'cancel',
  commandId: string,
  signal?: AbortSignal,
) {
  if (
    !['submit', 'cancel'].includes(operation) ||
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
      commandId,
    )
  )
    throw new CartError('invalid_sourcing_input', 400);
  const result = sourcingMutationSchema.parse(
    await call(
      fetcher,
      `/api/sourcing/requests/commands/${operation}/${commandId}`,
      'GET',
      undefined,
      signal,
    ),
  );
  if (!result.replayed || result.state !== (operation === 'submit' ? 'Submitted' : 'Cancelled'))
    throw new CartError('sourcing_unavailable', 503);
  return result;
}
export interface SourcingRecoveryResult {
  receipt: SourcingMutation;
  current: { detail: SourcingDetail; events: SourcingEvents } | null;
  refreshFailed: boolean;
}
// Receipts describe the original command, even after later transitions. Refresh
// only the request being viewed; its current version must come from GET detail.
export async function recoverSourcingView(
  fetcher: CartFetch,
  operation: 'submit' | 'cancel',
  commandId: string,
  viewedId?: string,
  signal?: AbortSignal,
): Promise<SourcingRecoveryResult> {
  const receipt = await recoverSourcingCommand(fetcher, operation, commandId, signal);
  if (!viewedId || receipt.id !== viewedId) return { receipt, current: null, refreshFailed: false };
  try {
    const [detail, events] = await Promise.all([
      readSourcing(fetcher, viewedId, signal),
      sourcingEvents(fetcher, viewedId, null, signal),
    ]);
    return { receipt, current: { detail, events }, refreshFailed: false };
  } catch {
    return { receipt, current: null, refreshFailed: true };
  }
}

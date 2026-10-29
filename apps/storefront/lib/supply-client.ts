import { CartError, type CartFetch } from './cart-client.ts';
import { offerIdSchema } from './offer-contract.ts';
import {
  supplyDetailV2Schema as supplyDetailSchema,
  supplyPageV2Schema as supplyPageSchema,
  supplyEventsSchema,
} from './supply-contract.ts';

function path(requestId: string, taskId?: string, v2 = true) {
  if (
    !offerIdSchema.safeParse(requestId).success ||
    (taskId !== undefined && !offerIdSchema.safeParse(taskId).success)
  )
    throw new CartError('not_found', 404);
  return `/api/sourcing/requests/${requestId}/supply${v2 ? '/v2' : ''}${taskId ? '/' + taskId : ''}`;
}
function paging(cursor: string | null) {
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    throw new CartError('invalid_sourcing_supply_cursor', 400);
  return cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
}
async function call(fetcher: CartFetch, path: string, signal?: AbortSignal) {
  const response = await fetcher(path, { method: 'GET', signal });
  if (!response.ok) {
    let code = 'sourcing_supply_unavailable';
    try {
      const value = await response.json();
      if (typeof value.title === 'string' && /^[a-z_]{1,100}$/.test(value.title))
        code = value.title;
    } catch {
      /* Preserve the status-based error when the optional response body is invalid. */
    }
    throw new CartError(code, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new CartError('sourcing_supply_unavailable', 503);
  }
}
export async function listSourcingSupply(
  fetcher: CartFetch,
  requestId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  const value = supplyPageSchema.safeParse(
    await call(fetcher, path(requestId) + paging(cursor), signal),
  );
  if (!value.success || value.data.requestId !== requestId)
    throw new CartError('sourcing_supply_unavailable', 503);
  return value.data;
}
export async function readSourcingSupply(
  fetcher: CartFetch,
  requestId: string,
  taskId: string,
  signal?: AbortSignal,
) {
  const value = supplyDetailSchema.safeParse(await call(fetcher, path(requestId, taskId), signal));
  if (!value.success || value.data.requestId !== requestId || value.data.task.id !== taskId)
    throw new CartError('sourcing_supply_unavailable', 503);
  return value.data;
}
export async function sourcingSupplyEvents(
  fetcher: CartFetch,
  requestId: string,
  taskId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  const value = supplyEventsSchema.safeParse(
    await call(fetcher, path(requestId, taskId, false) + '/events' + paging(cursor), signal),
  );
  if (!value.success) throw new CartError('sourcing_supply_unavailable', 503);
  return value.data;
}
export async function readSourcingSupplyView(
  fetcher: CartFetch,
  requestId: string,
  taskId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  const [detail, events] = await Promise.all([
    readSourcingSupply(fetcher, requestId, taskId, signal),
    sourcingSupplyEvents(fetcher, requestId, taskId, cursor, signal),
  ]);
  const after = await readSourcingSupply(fetcher, requestId, taskId, signal);
  if (
    detail.requestVersion !== after.requestVersion ||
    detail.task.version !== after.task.version ||
    JSON.stringify(detail.task.allocation) !== JSON.stringify(after.task.allocation)
  )
    throw new CartError('sourcing_supply_unavailable', 503);
  return { detail: after, events };
}

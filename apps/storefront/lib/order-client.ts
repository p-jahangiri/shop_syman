import { CartError, type CartFetch } from './cart-client.ts';
import {
  cancelOrderSchema,
  createOrderResultSchema,
  orderDetailSchema,
  orderInputSchema,
  orderPageSchema,
  type OrderInput,
} from './order-contract.ts';
async function response(fetcher: CartFetch, path: string, init: RequestInit) {
  const value = await fetcher(path, init);
  if (!value.ok) {
    let code = 'order_unavailable';
    try {
      const problem = await value.json();
      if (typeof problem.title === 'string') code = problem.title;
    } catch {
      /* Never show an upstream body or personal data. */
    }
    throw new CartError(code, value.status);
  }
  return value.json();
}
export async function createOrder(fetcher: CartFetch, input: OrderInput, signal?: AbortSignal) {
  const value = createOrderResultSchema.parse(
    await response(fetcher, '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderInputSchema.parse(input)),
      signal,
    }),
  );
  if (value.order.quoteId !== input.quoteId) throw new CartError('order_unavailable', 503);
  return value;
}
export async function readOrder(fetcher: CartFetch, id: string, signal?: AbortSignal) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new CartError('not_found', 404);
  const value = orderDetailSchema.parse(
    await response(fetcher, `/api/orders/${id}`, { method: 'GET', signal }),
  );
  if (value.summary.id !== id) throw new CartError('order_unavailable', 503);
  return value;
}
export async function cancelOrder(
  fetcher: CartFetch,
  id: string,
  version: string,
  signal?: AbortSignal,
) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new CartError('not_found', 404);
  const value = orderDetailSchema.parse(
    await response(fetcher, `/api/orders/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cancelOrderSchema.parse({ version })),
      signal,
    }),
  );
  if (value.summary.id !== id) throw new CartError('order_unavailable', 503);
  return value;
}
export async function listOrders(fetcher: CartFetch, cursor: string | null, signal?: AbortSignal) {
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    throw new CartError('invalid_order_cursor', 400);
  return orderPageSchema.parse(
    await response(fetcher, '/api/orders' + (cursor ? `?cursor=${cursor}` : ''), {
      method: 'GET',
      signal,
    }),
  );
}

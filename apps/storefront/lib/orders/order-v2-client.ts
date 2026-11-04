import { CartError, type CartFetch } from '../checkout/cart-client.ts';
import {
  cancelOrderSchema,
  createOrderResultV2Schema,
  orderDetailV2Schema,
  orderInputSchema,
  orderPageV2Schema,
} from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import type { OrderInput } from '@sayman/web-shared/lib/orders/order-contract.ts';
export async function readOrderV2Response(response: Response) {
  if (Number(response.headers.get('Content-Length')) > 1048576) {
    await response.body?.cancel();
    throw new CartError('order_unavailable', 503);
  }
  const reader = response.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1048576) {
          await reader.cancel();
          throw new CartError('order_unavailable', 503);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
  } catch {
    throw new CartError('order_unavailable', 503);
  }
  if (!response.ok) {
    const title = value && typeof value === 'object' && 'title' in value ? value.title : null;
    throw new CartError(
      typeof title === 'string' && /^[a-z_]{1,100}$/.test(title) ? title : 'order_unavailable',
      response.status,
    );
  }
  return value;
}
export async function createOrderV2(fetcher: CartFetch, input: OrderInput, signal?: AbortSignal) {
  const parsed = orderInputSchema.parse(input),
    value = createOrderResultV2Schema.parse(
      await readOrderV2Response(
        await fetcher('/api/orders/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
          signal,
        }),
      ),
    );
  if (value.order.quoteId !== parsed.quoteId || value.order.originalSnapshotVersion !== 2)
    throw new CartError('order_unavailable', 503);
  return value;
}
export async function readOrderV2(fetcher: CartFetch, id: string, signal?: AbortSignal) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new CartError('not_found', 404);
  const value = orderDetailV2Schema.parse(
    await readOrderV2Response(await fetcher(`/api/orders/v2/${id}`, { method: 'GET', signal })),
  );
  if (value.summary.id !== id) throw new CartError('order_unavailable', 503);
  return value;
}
export async function cancelOrderV2(
  fetcher: CartFetch,
  id: string,
  version: string,
  signal?: AbortSignal,
) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new CartError('not_found', 404);
  const value = orderDetailV2Schema.parse(
    await readOrderV2Response(
      await fetcher(`/api/orders/v2/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cancelOrderSchema.parse({ version })),
        signal,
      }),
    ),
  );
  if (value.summary.id !== id) throw new CartError('order_unavailable', 503);
  return value;
}
export async function listOrdersV2(
  fetcher: CartFetch,
  cursor: string | null,
  signal?: AbortSignal,
) {
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    throw new CartError('invalid_order_cursor', 400);
  return orderPageV2Schema.parse(
    await readOrderV2Response(
      await fetcher('/api/orders/v2' + (cursor ? `?cursor=${cursor}` : ''), {
        method: 'GET',
        signal,
      }),
    ),
  );
}

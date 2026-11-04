import { z } from '@sayman/web-shared/lib/config/schema-runtime.ts';
import { offerIdSchema as id } from '@sayman/web-shared/lib/market/offer-contract.ts';
import { CartError, type CartFetch } from '../checkout/cart-client.ts';
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);
export const sourcingOrderLinksSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: id,
    items: z
      .array(
        z
          .object({
            orderId: id,
            taskId: id,
            offerId: id,
            acceptanceId: id,
            createdAt: z.iso.datetime({ offset: true }).refine((v) => /(?:Z|\+00:00)$/.test(v)),
          })
          .strict(),
      )
      .max(20),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.items.map((l) => l.orderId + ':' + l.acceptanceId)).size === v.items.length &&
      new Set(v.items.map((l) => l.acceptanceId)).size === v.items.length,
  );
export type SourcingOrderLinks = z.infer<typeof sourcingOrderLinksSchema>;
export function isCustomerSourcingOrdersPath(path: string, method = 'GET') {
  return (
    method === 'GET' &&
    /^\/api\/sourcing\/requests\/[a-f0-9]{32}\/orders(?:\?cursor=[A-Za-z0-9_-]{1,512})?$/.test(path)
  );
}
export async function readSourcingOrderLinks(
  fetcher: CartFetch,
  requestId: string,
  cursorValue: string | null,
  signal?: AbortSignal,
) {
  if (
    !id.safeParse(requestId).success ||
    (cursorValue !== null && !cursor.safeParse(cursorValue).success)
  )
    throw new CartError('invalid_sourcing_input', 400);
  const response = await fetcher(
    `/api/sourcing/requests/${requestId}/orders${cursorValue ? '?cursor=' + cursorValue : ''}`,
    { method: 'GET', signal },
  );
  if (Number(response.headers.get('Content-Length')) > 65536) {
    await response.body?.cancel();
    throw new CartError('sourcing_unavailable', 503);
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
        if (size > 65536) {
          await reader.cancel();
          throw new CartError('sourcing_unavailable', 503);
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
    throw new CartError('sourcing_unavailable', 503);
  }
  if (!response.ok) throw new CartError('sourcing_unavailable', response.status);
  const result = sourcingOrderLinksSchema.safeParse(value);
  if (!result.success || result.data.requestId !== requestId)
    throw new CartError('sourcing_unavailable', 503);
  return result.data;
}

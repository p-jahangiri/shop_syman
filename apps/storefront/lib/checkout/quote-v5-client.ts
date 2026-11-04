import { CartError, type CartFetch } from './cart-client.ts';
import {
  quoteInputSchema,
  type QuoteInput,
} from '@sayman/web-shared/lib/checkout/quote-contract.ts';
import {
  quoteV5MatchesInput,
  type CheckoutQuoteV5,
} from '@sayman/web-shared/lib/checkout/quote-v5-contract.ts';
export async function requestQuoteV5(
  fetcher: CartFetch,
  locale: 'fa' | 'en',
  input: QuoteInput,
  signal?: AbortSignal,
): Promise<CheckoutQuoteV5> {
  const parsed = quoteInputSchema.parse(input),
    response = await fetcher(`/api/cart/${locale}/v2/order-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
      signal,
    });
  if (Number(response.headers.get('Content-Length')) > 524288) {
    await response.body?.cancel();
    throw new CartError('quote_unavailable', 503);
  }
  const reader = response.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 524288) {
          await reader.cancel();
          throw new CartError('quote_unavailable', 503);
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
    throw new CartError('quote_unavailable', 503);
  }
  if (!response.ok) {
    const title = value && typeof value === 'object' && 'title' in value ? value.title : null;
    throw new CartError(
      typeof title === 'string' && /^[a-z_]{1,100}$/.test(title) ? title : 'quote_unavailable',
      response.status,
    );
  }
  try {
    return quoteV5MatchesInput(value, locale, parsed);
  } catch {
    throw new CartError('quote_unavailable', 503);
  }
}

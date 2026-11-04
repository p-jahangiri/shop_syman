import { CartError, type CartFetch } from './cart-client.ts';
import {
  quoteInputSchema,
  quoteSnapshotSchema,
  type QuoteInput,
  type CheckoutQuote,
} from '@sayman/web-shared/lib/checkout/quote-contract.ts';
export async function requestQuote(
  fetcher: CartFetch,
  locale: 'fa' | 'en',
  input: QuoteInput,
  signal?: AbortSignal,
): Promise<CheckoutQuote> {
  const parsed = quoteInputSchema.parse(input);
  const response = await fetcher(`/api/cart/${locale}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
    signal,
  });
  if (!response.ok) {
    let code = 'quote_unavailable';
    try {
      const value = await response.json();
      if (typeof value.title === 'string') code = value.title;
    } catch {
      /* Never display an upstream body. */
    }
    throw new CartError(code, response.status);
  }
  const result = quoteSnapshotSchema.parse(await response.json());
  if (
    result.locale !== locale ||
    result.cartVersion !== parsed.cartVersion ||
    result.selectedMethod?.id !== (parsed.methodId ?? undefined) ||
    result.selectedPlan?.id !== (parsed.planId ?? undefined)
  )
    throw new CartError('quote_unavailable', 503);
  return result;
}

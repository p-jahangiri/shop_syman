import type { CartInput } from './cart-contract.ts';
import { CartError, type CartFetch } from './cart-client.ts';
import { cartInputV2Schema, cartSnapshotV2Schema, type ServerCartV2 } from './cart-v2-contract.ts';
import {
  cartCommandReceiptMatches,
  cartConversionCandidateSchema,
  type CartCommand,
} from './cart-conversion-contract.ts';
export async function cartJson(response: Response) {
  if (!response.ok) {
    let code = 'cart_unavailable';
    try {
      const problem = await response.json();
      if (typeof problem.title === 'string' && /^[a-z_]{1,100}$/.test(problem.title))
        code = problem.title;
    } catch {
      /* Preserve the status-based error when the optional response body is invalid. */
    }
    throw new CartError(code, response.status);
  }
  return response.json();
}
export async function requestCartV2(
  fetcher: CartFetch,
  locale: 'fa' | 'en',
  method: 'GET' | 'PUT' | 'POST' = 'GET',
  input?: CartInput,
  signal?: AbortSignal,
): Promise<ServerCartV2> {
  const raw = await cartJson(
    await fetcher(`/api/cart/${locale}/v2${method === 'POST' ? '/merge' : ''}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:
        method === 'POST'
          ? '{}'
          : input
            ? JSON.stringify(cartInputV2Schema.parse(input))
            : undefined,
      signal,
    }),
  );
  const value = cartSnapshotV2Schema.parse(raw);
  if (value.locale !== locale) throw new CartError('cart_unavailable', 503);
  return value;
}
export function cartCommandPath(command: CartCommand, receipt = false) {
  if (command.kind === 'cart-convert') {
    const base = `/api/sourcing/requests/${command.id}/offers/${command.offerId}`;
    return receipt ? `${base}/commands/convert/${command.body.requestId}` : base + '/convert';
  }
  const base = `/api/cart/${command.locale}/v2/offers/${command.id}`;
  return receipt ? `${base}/commands/remove/${command.body.requestId}` : base;
}
export async function requestCartCommand(
  fetcher: CartFetch,
  command: CartCommand,
  receipt = false,
  signal?: AbortSignal,
) {
  const raw = await cartJson(
    await fetcher(cartCommandPath(command, receipt), {
      method: receipt ? 'GET' : command.kind === 'cart-convert' ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: receipt ? undefined : JSON.stringify(command.body),
      signal,
    }),
  );
  return cartCommandReceiptMatches(command, raw, receipt);
}
export async function readConversionCandidate(
  fetcher: CartFetch,
  requestId: string,
  offerId: string,
  signal?: AbortSignal,
) {
  if (!/^[a-f0-9]{32}$/.test(requestId) || !/^[a-f0-9]{32}$/.test(offerId))
    throw new CartError('not_found', 404);
  const value = cartConversionCandidateSchema.parse(
    await cartJson(
      await fetcher(`/api/sourcing/requests/${requestId}/offers/${offerId}/purchase`, {
        method: 'GET',
        signal,
      }),
    ),
  );
  if (value.requestId !== requestId || value.offerId !== offerId)
    throw new CartError('cart_conversion_unavailable', 503);
  return value;
}

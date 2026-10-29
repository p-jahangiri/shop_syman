import { isCreditCheckoutQuotePath } from './credit-checkout-quote-contract.ts';
import { proxyCreditCheckoutQuote } from './credit-checkout-quote-proxy.ts';
import { cartInputV2Schema, cartSnapshotV2Schema } from './cart-v2-contract.ts';
import {
  cartConversionCandidateSchema,
  cartConversionInputSchema,
  cartConversionMutationSchema,
  cartOfferRemovalInputSchema,
  cartOfferRemovalMutationSchema,
  cartCommandReceiptMatches,
  type CartCommand,
} from './cart-conversion-contract.ts';
import { isCustomerCartV2Path } from './cart-v2-path.ts';
import { publicOrigin } from './seo.ts';
import { quoteInputSchema } from './quote-contract.ts';
import { quoteV4MatchesInput } from './quote-v4-contract.ts';
import { quoteV5MatchesInput } from './quote-v5-contract.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class BoundaryError extends Error {
  status: number;
  constructor(status: number) {
    super('Private cart boundary unavailable');
    this.status = status;
  }
}
export interface CartV2Environment {
  SHOP_API_URL?: string;
  SHOP_PUBLIC_URL?: string;
  SHOP_DATA_MODE?: string;
}
async function readText(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new BoundaryError(status);
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
  try {
    return new TextDecoder('utf8', { fatal: true }).decode(bytes);
  } catch {
    throw new BoundaryError(status);
  }
}
async function proxy(
  request: Request,
  path: string,
  environment: CartV2Environment,
  fetcher: typeof fetch,
  mode:
    | 'cart'
    | 'merge'
    | 'quote'
    | 'order-quote'
    | 'remove'
    | 'remove-receipt'
    | 'purchase'
    | 'convert'
    | 'convert-receipt',
  locale?: 'fa' | 'en',
  agreementId?: string,
) {
  if (!isCustomerCartV2Path(path, request.method) || new URL(request.url).search)
    return new Response(null, { status: 404, headers });
  const base = environment.SHOP_API_URL,
    origin = publicOrigin(environment);
  if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'cart_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    const authorization = request.headers.get('Authorization');
    if (
      (authorization && !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization)) ||
      (mode !== 'cart' && !authorization)
    )
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    let body: string | undefined, input: unknown;
    if (request.method !== 'GET') {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new BoundaryError(413);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new BoundaryError(400);
      try {
        input = JSON.parse((await readText(request.body, 16384, 413)) || '{}');
      } catch (error) {
        if (error instanceof BoundaryError) throw error;
        throw new BoundaryError(400);
      }
      if (mode === 'merge') {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new BoundaryError(400);
        body = '{}';
      } else {
        const parsed = (
          mode === 'quote' || mode === 'order-quote'
            ? quoteInputSchema
            : mode === 'convert'
              ? cartConversionInputSchema
              : mode === 'remove'
                ? cartOfferRemovalInputSchema
                : cartInputV2Schema
        ).safeParse(input);
        if (!parsed.success) throw new BoundaryError(400);
        input = parsed.data;
        body = JSON.stringify(input);
      }
    }
    const forwarded = new Headers({
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    if (authorization) forwarded.set('Authorization', authorization);
    if (supplied) forwarded.set('Origin', supplied);
    if (mode === 'cart' || mode === 'merge') {
      const cookies = (request.headers.get('Cookie') ?? '')
        .split(';')
        .map((value) => value.trim())
        .filter((value) => value.startsWith('sayman_cart='));
      if (cookies.length > 1) throw new BoundaryError(400);
      if (cookies.length) {
        const cookie = cookies[0].slice(12);
        forwarded.set(
          'Cookie',
          `sayman_cart=${/^[A-Za-z0-9_-]{43}$/.test(cookie) ? cookie : 'invalid'}`,
        );
      }
    }
    const response = await fetcher(base.replace(/\/$/, '') + path, {
      method: request.method,
      headers: forwarded,
      body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    const outgoing = new Headers(headers);
    if (mode === 'cart' || mode === 'merge')
      for (const cookie of response.headers.getSetCookie())
        if (cookie.startsWith('sayman_cart=')) outgoing.append('Set-Cookie', cookie);
    const max = mode === 'quote' || mode === 'order-quote' ? 524288 : 2097152;
    if (Number(response.headers.get('Content-Length')) > max) {
      await response.body?.cancel();
      throw new BoundaryError(503);
    }
    const raw = await readText(response.body, max, 503);
    if (!response.ok) {
      let title = 'cart_unavailable';
      try {
        const problem = JSON.parse(raw);
        if (typeof problem.title === 'string' && /^[a-z_]{1,100}$/.test(problem.title))
          title = problem.title;
      } catch {
        /* Preserve the status-based error when the optional response body is invalid. */
      }
      return Response.json(
        { title },
        {
          status: [400, 401, 403, 404, 409, 429, 503].includes(response.status)
            ? response.status
            : 503,
          headers: outgoing,
        },
      );
    }
    if (
      ![200, 201].includes(response.status) ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw new BoundaryError(503);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new BoundaryError(503);
    }
    if (mode === 'cart' || mode === 'merge') {
      const parsed = cartSnapshotV2Schema.parse(value);
      if (parsed.locale !== locale) throw new BoundaryError(503);
      return Response.json(parsed, { headers: outgoing });
    }
    if (mode === 'quote')
      return Response.json(quoteV4MatchesInput(value, locale!, quoteInputSchema.parse(input)), {
        headers: outgoing,
      });
    if (mode === 'order-quote')
      return Response.json(quoteV5MatchesInput(value, locale!, quoteInputSchema.parse(input)), {
        headers: outgoing,
      });
    const parts = path.split('/');
    const requestId = parts[4],
      offerId = parts[6],
      receipt = mode === 'convert-receipt' || mode === 'remove-receipt';
    if (mode === 'purchase') {
      const parsed = cartConversionCandidateSchema.parse(value);
      if (parsed.requestId !== requestId || parsed.offerId !== offerId)
        throw new BoundaryError(503);
      return Response.json(parsed, { headers: outgoing });
    }
    let command: CartCommand;
    if (mode === 'remove-receipt') {
      const parsed = cartOfferRemovalMutationSchema.parse(value);
      if (
        parsed.agreementId !== agreementId ||
        parsed.commandId.replaceAll('-', '').toLowerCase() !==
          parts.at(-1)!.replaceAll('-', '').toLowerCase() ||
        !parsed.replayed
      )
        throw new BoundaryError(503);
      return Response.json(parsed, { headers: outgoing });
    }
    if (mode === 'remove')
      command = {
        kind: 'cart-remove',
        id: agreementId!,
        locale: locale!,
        body: cartOfferRemovalInputSchema.parse(input),
      };
    else if (mode === 'convert')
      command = {
        kind: 'cart-convert',
        id: requestId,
        offerId,
        locale: 'fa',
        body: cartConversionInputSchema.parse(input),
      };
    else {
      // The receipt route has no original input. Bind all route identity and UUID
      // here; the owner journal/client adds original body lineage when available.
      const parsed = cartConversionMutationSchema.parse(value);
      if (
        parsed.requestId !== requestId ||
        parsed.offerId !== offerId ||
        parsed.commandId.replaceAll('-', '').toLowerCase() !==
          parts.at(-1)!.replaceAll('-', '').toLowerCase() ||
        !parsed.replayed
      )
        throw new BoundaryError(503);
      return Response.json(parsed, { headers: outgoing });
    }
    return Response.json(cartCommandReceiptMatches(command, value, receipt), {
      status: response.status,
      headers: outgoing,
    });
  } catch (error) {
    const status = error instanceof BoundaryError ? error.status : 503;
    return Response.json(
      {
        title:
          status === 400 ? 'invalid_cart' : status === 413 ? 'cart_too_large' : 'cart_unavailable',
      },
      { status, headers },
    );
  }
}
export function proxyCartV2(
  request: Request,
  locale: string,
  tail: string[],
  environment: CartV2Environment,
  fetcher: typeof fetch = fetch,
) {
  const path = `/api/cart/${locale}/v2${tail.length ? '/' + tail.join('/') : ''}`;
  if (isCreditCheckoutQuotePath(path, request.method))
    return proxyCreditCheckoutQuote(request, environment, fetcher);
  const mode =
    tail.length === 0
      ? 'cart'
      : tail[0] === 'merge'
        ? 'merge'
        : tail[0] === 'quote'
          ? 'quote'
          : tail[0] === 'order-quote'
            ? 'order-quote'
            : tail.length === 2
              ? 'remove'
              : 'remove-receipt';
  return proxy(request, path, environment, fetcher, mode, locale as 'fa' | 'en', tail[1]);
}
export function proxyCartConversion(
  request: Request,
  path: string[],
  environment: CartV2Environment,
  fetcher: typeof fetch = fetch,
) {
  const full = '/api/sourcing/requests/' + path.join('/'),
    mode =
      path[3] === 'purchase' ? 'purchase' : path[3] === 'convert' ? 'convert' : 'convert-receipt';
  return proxy(request, full, environment, fetcher, mode);
}

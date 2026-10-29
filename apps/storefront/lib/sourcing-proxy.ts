import {
  sourcingCartInputSchema,
  sourcingCartSchema,
  sourcingSubmitSchema,
  sourcingMutationSchema,
  sourcingCancelSchema,
  sourcingRequestPageSchema,
  sourcingDetailSchema,
  sourcingEventsSchema,
} from './sourcing-contract.ts';
import { publicOrigin } from './seo.ts';
import { proxySourcingOffers } from './offer-proxy.ts';
import { proxySourcingSupply } from './supply-proxy.ts';
import { sourcingOrderLinksSchema } from './sourcing-order-links.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class SourcingProxyError extends Error {
  status: number;
  constructor(status: number) {
    super('Sourcing proxy unavailable');
    this.status = status;
  }
}
export interface SourcingProxyEnvironment {
  SHOP_API_URL?: string;
  SHOP_PUBLIC_URL?: string;
  SHOP_DATA_MODE?: string;
}
async function text(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new SourcingProxyError(status);
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new SourcingProxyError(status);
  }
}
async function proxy(
  request: Request,
  kind: 'cart' | 'requests',
  locale: string,
  path: string[],
  environment: SourcingProxyEnvironment,
  fetcher: typeof fetch,
) {
  const cart = kind === 'cart',
    submit = cart && path.length === 1 && path[0] === 'submit',
    root = path.length === 0,
    detail = !cart && path.length === 1 && /^[a-f0-9]{32}$/.test(path[0]),
    orders = !cart && path.length === 2 && /^[a-f0-9]{32}$/.test(path[0]) && path[1] === 'orders',
    events = !cart && path.length === 2 && /^[a-f0-9]{32}$/.test(path[0]) && path[1] === 'events',
    cancel = !cart && path.length === 2 && /^[a-f0-9]{32}$/.test(path[0]) && path[1] === 'cancel',
    receipt =
      !cart &&
      path.length === 3 &&
      path[0] === 'commands' &&
      ['submit', 'cancel'].includes(path[1]) &&
      /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
        path[2],
      );
  if (!(
    (cart &&
      ['fa', 'en'].includes(locale) &&
      ((root && ['GET', 'PUT'].includes(request.method)) ||
        (submit && request.method === 'POST'))) ||
    (!cart &&
      ((root && request.method === 'GET') ||
        (detail && request.method === 'GET') ||
        (events && request.method === 'GET') ||
        (orders && request.method === 'GET') ||
        (receipt && request.method === 'GET') ||
        (cancel && request.method === 'POST')))
  ))
    return new Response(null, { status: 404, headers });
  const base = environment.SHOP_API_URL,
    origin = publicOrigin(environment);
  if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'sourcing_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    const params = new URL(request.url).searchParams,
      cursor = params.get('cursor');
    if (
      [...params.keys()].length &&
      !(
        request.method === 'GET' &&
        !cart &&
        (root || events || orders) &&
        [...params.keys()].length === 1 &&
        params.getAll('cursor').length === 1 &&
        cursor &&
        (orders ? /^[A-Za-z0-9_-]{1,512}$/ : /^[A-Za-z0-9_-]{1,200}$/).test(cursor)
      )
    )
      throw new SourcingProxyError(400);
    const authorization = request.headers.get('Authorization');
    if (
      (authorization && !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization)) ||
      ((!cart || submit) && !authorization)
    )
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    let body: string | undefined;
    if (request.method !== 'GET') {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new SourcingProxyError(413);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new SourcingProxyError(400);
      let value: unknown;
      try {
        value = JSON.parse(await text(request.body, 16384, 413));
      } catch (error) {
        if (error instanceof SourcingProxyError) throw error;
        throw new SourcingProxyError(400);
      }
      const result = (
        submit ? sourcingSubmitSchema : cancel ? sourcingCancelSchema : sourcingCartInputSchema
      ).safeParse(value);
      if (!result.success) throw new SourcingProxyError(400);
      body = JSON.stringify(result.data);
    }
    const forwarded = new Headers({
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    if (authorization) forwarded.set('Authorization', authorization);
    if (supplied) forwarded.set('Origin', supplied);
    if (cart) {
      const cookies = (request.headers.get('Cookie') ?? '')
        .split(';')
        .map((value) => value.trim())
        .filter((value) => value.startsWith('sayman_cart='));
      if (cookies.length > 1) throw new SourcingProxyError(400);
      if (cookies.length) {
        const cookie = cookies[0].slice('sayman_cart='.length);
        forwarded.set(
          'Cookie',
          `sayman_cart=${/^[A-Za-z0-9_-]{43}$/.test(cookie) ? cookie : 'invalid'}`,
        );
      }
    }
    const url = `${base.replace(/\/$/, '')}${cart ? `/api/cart/${locale}/sourcing${submit ? '/submit' : ''}` : `/api/sourcing/requests${path.length ? '/' + path.join('/') : ''}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`}`;
    const upstream = await fetcher(url, {
      method: request.method,
      headers: forwarded,
      body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    const outgoing = new Headers(headers);
    if (cart)
      for (const cookie of upstream.headers.getSetCookie())
        if (cookie.startsWith('sayman_cart=')) outgoing.append('Set-Cookie', cookie);
    if (Number(upstream.headers.get('Content-Length')) > 2097152) {
      await upstream.body?.cancel();
      throw new SourcingProxyError(503);
    }
    const raw = await text(upstream.body, 2097152, 503);
    if (!upstream.ok) {
      let title = 'sourcing_unavailable';
      try {
        const value = JSON.parse(raw);
        if (typeof value.title === 'string' && /^[a-z_]{1,100}$/.test(value.title))
          title = value.title;
      } catch {
        /* Preserve the status-based error when the optional response body is invalid. */
      }
      return Response.json(
        { title },
        {
          status: [400, 401, 403, 404, 409, 429, 503].includes(upstream.status)
            ? upstream.status
            : 503,
          headers: outgoing,
        },
      );
    }
    if (
      ![200, 201].includes(upstream.status) ||
      !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('Content-Type') ?? '')
    )
      throw new SourcingProxyError(503);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new SourcingProxyError(503);
    }
    const parsed = (
      submit || cancel || receipt
        ? sourcingMutationSchema
        : cart
          ? sourcingCartSchema
          : root
            ? sourcingRequestPageSchema
            : orders
              ? sourcingOrderLinksSchema
              : events
                ? sourcingEventsSchema
                : sourcingDetailSchema
    ).safeParse(value);
    if (!parsed.success) throw new SourcingProxyError(503);
    if (orders && sourcingOrderLinksSchema.parse(parsed.data).requestId !== path[0])
      throw new SourcingProxyError(503);
    if (
      (cart && !submit && sourcingCartSchema.parse(parsed.data).locale !== locale) ||
      (detail && sourcingDetailSchema.parse(parsed.data).summary.id !== path[0]) ||
      (cancel && sourcingMutationSchema.parse(parsed.data).id !== path[0])
    )
      throw new SourcingProxyError(503);
    return Response.json(parsed.data, { status: upstream.status, headers: outgoing });
  } catch (error) {
    const status = error instanceof SourcingProxyError ? error.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_sourcing_input'
            : status === 413
              ? 'sourcing_too_large'
              : 'sourcing_unavailable',
      },
      { status, headers },
    );
  }
}
export const proxySourcingCart = (
  request: Request,
  locale: string,
  path: string[],
  environment: SourcingProxyEnvironment,
  fetcher: typeof fetch = fetch,
) => proxy(request, 'cart', locale, path, environment, fetcher);
export const proxySourcingRequests = (
  request: Request,
  path: string[],
  environment: SourcingProxyEnvironment,
  fetcher: typeof fetch = fetch,
) =>
  path[1] === 'offers'
    ? proxySourcingOffers(request, path, environment, fetcher)
    : path[1] === 'supply'
      ? proxySourcingSupply(request, path, environment, fetcher)
      : proxy(request, 'requests', '', path, environment, fetcher);

import {
  offerActionSchema,
  offerCommandIdSchema,
  offerDetailSchema,
  offerEventsSchema,
  offerIdSchema,
  offerMutationSchema,
  offerMutationMatches,
  offerPageSchema,
} from './offer-contract.ts';
import { publicOrigin } from './seo.ts';
import type { SourcingProxyEnvironment } from './sourcing-proxy.ts';
import { proxyCartConversion } from './cart-v2-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class OfferProxyError extends Error {
  status: number;
  constructor(status: number) {
    super('Offer proxy unavailable');
    this.status = status;
  }
}
async function readText(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new OfferProxyError(status);
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new OfferProxyError(status);
  }
}
export async function proxySourcingOffers(
  request: Request,
  path: string[],
  environment: SourcingProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  if (
    path[3] === 'purchase' ||
    path[3] === 'convert' ||
    (path[3] === 'commands' && path[4] === 'convert')
  )
    return proxyCartConversion(request, path, environment, fetcher);
  const canonical = offerIdSchema.safeParse(path[0]).success && path[1] === 'offers',
    list = canonical && path.length === 2,
    detail = canonical && path.length === 3 && offerIdSchema.safeParse(path[2]).success,
    events =
      canonical &&
      path.length === 4 &&
      offerIdSchema.safeParse(path[2]).success &&
      path[3] === 'events',
    action =
      canonical &&
      path.length === 4 &&
      offerIdSchema.safeParse(path[2]).success &&
      ['accept', 'decline'].includes(path[3]),
    receipt =
      canonical &&
      path.length === 6 &&
      offerIdSchema.safeParse(path[2]).success &&
      path[3] === 'commands' &&
      ['accept', 'decline'].includes(path[4]) &&
      offerCommandIdSchema.safeParse(path[5]).success;
  if (!(
    (request.method === 'GET' && (list || detail || events || receipt)) ||
    (request.method === 'POST' && action)
  ))
    return new Response(null, { status: 404, headers });
  const base = environment.SHOP_API_URL,
    origin = publicOrigin(environment);
  if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'sourcing_offer_unconfigured' }, { status: 503, headers });
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
        (list || events) &&
        [...params.keys()].length === 1 &&
        params.getAll('cursor').length === 1 &&
        cursor &&
        /^[A-Za-z0-9_-]{1,200}$/.test(cursor)
      )
    )
      throw new OfferProxyError(400);
    const authorization = request.headers.get('Authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization))
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    let body: string | undefined;
    if (action) {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new OfferProxyError(413);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new OfferProxyError(400);
      let value: unknown;
      try {
        value = JSON.parse(await readText(request.body, 16384, 413));
      } catch (error) {
        if (error instanceof OfferProxyError) throw error;
        throw new OfferProxyError(400);
      }
      const parsed = offerActionSchema.safeParse(value);
      if (!parsed.success) throw new OfferProxyError(400);
      body = JSON.stringify(parsed.data);
    }
    const forwarded = new Headers({
      'Content-Type': 'application/json',
      Authorization: authorization,
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) forwarded.set('Origin', supplied);
    const upstream = await fetcher(
      `${base.replace(/\/$/, '')}/api/sourcing/requests/${path.join('/')}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      {
        method: request.method,
        headers: forwarded,
        body,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      },
    );
    const responseLimit = detail ? 524288 : 2097152;
    if (Number(upstream.headers.get('Content-Length')) > responseLimit) {
      await upstream.body?.cancel();
      throw new OfferProxyError(503);
    }
    const raw = await readText(upstream.body, responseLimit, 503);
    if (!upstream.ok) {
      let title = 'sourcing_offer_unavailable';
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
          headers,
        },
      );
    }
    if (
      ![200, 201].includes(upstream.status) ||
      !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('Content-Type') ?? '')
    )
      throw new OfferProxyError(503);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new OfferProxyError(503);
    }
    const parsed = (
      list
        ? offerPageSchema
        : detail
          ? offerDetailSchema
          : events
            ? offerEventsSchema
            : offerMutationSchema
    ).safeParse(value);
    if (!parsed.success) throw new OfferProxyError(503);
    if (
      (list && offerPageSchema.parse(parsed.data).requestId !== path[0]) ||
      (detail &&
        (offerDetailSchema.parse(parsed.data).requestId !== path[0] ||
          offerDetailSchema.parse(parsed.data).offer.summary.id !== path[2]))
    )
      throw new OfferProxyError(503);
    if (action || receipt) {
      const result = offerMutationSchema.parse(parsed.data),
        operation = action ? path[3] : path[4];
      if (
        !offerMutationMatches(result, path[0], path[2], operation as 'accept' | 'decline') ||
        (receipt && !result.replayed)
      )
        throw new OfferProxyError(503);
    }
    return Response.json(parsed.data, { status: upstream.status, headers });
  } catch (error) {
    const status = error instanceof OfferProxyError ? error.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_sourcing_offer'
            : status === 413
              ? 'sourcing_offer_too_large'
              : 'sourcing_offer_unavailable',
      },
      { status, headers },
    );
  }
}

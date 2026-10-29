import { offerIdSchema } from './offer-contract.ts';
import {
  supplyDetailSchema,
  supplyEventsSchema,
  supplyPageSchema,
  supplyDetailV2Schema,
  supplyPageV2Schema,
} from './supply-contract.ts';
import { publicOrigin } from './seo.ts';
import type { SourcingProxyEnvironment } from './sourcing-proxy.ts';

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class SupplyProxyError extends Error {
  status: number;
  constructor(status: number) {
    super('Supply read unavailable');
    this.status = status;
  }
}
async function read(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return '';
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 524288) {
        await reader.cancel();
        throw new SupplyProxyError(503);
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
    throw new SupplyProxyError(503);
  }
}
export async function proxySourcingSupply(
  request: Request,
  path: string[],
  environment: SourcingProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const root = offerIdSchema.safeParse(path[0]).success && path[1] === 'supply',
    v2 = root && path[2] === 'v2',
    taskIndex = v2 ? 3 : 2,
    list = root && path.length === (v2 ? 3 : 2),
    detail =
      root && path.length === (v2 ? 4 : 3) && offerIdSchema.safeParse(path[taskIndex]).success,
    events =
      root &&
      !v2 &&
      path.length === 4 &&
      offerIdSchema.safeParse(path[2]).success &&
      path[3] === 'events';
  if (request.method !== 'GET' || !(list || detail || events))
    return new Response(null, { status: 404, headers });
  const base = environment.SHOP_API_URL,
    origin = publicOrigin(environment);
  if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'sourcing_supply_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if (supplied && supplied !== origin) return new Response(null, { status: 403, headers });
  try {
    const params = new URL(request.url).searchParams,
      cursor = params.get('cursor');
    if (
      ([...params.keys()].length && !(list || events)) ||
      [...params.keys()].some((key) => key !== 'cursor') ||
      params.getAll('cursor').length > 1 ||
      (params.has('cursor') && (!cursor || !/^[A-Za-z0-9_-]{1,200}$/.test(cursor)))
    )
      throw new SupplyProxyError(400);
    const authorization = request.headers.get('Authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization))
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    const forwarded = new Headers({
      Authorization: authorization,
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) forwarded.set('Origin', supplied);
    const upstream = await fetcher(
      `${base.replace(/\/$/, '')}/api/sourcing/requests/${path.join('/')}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      {
        method: 'GET',
        headers: forwarded,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      },
    );
    if (Number(upstream.headers.get('Content-Length')) > 524288) {
      await upstream.body?.cancel();
      throw new SupplyProxyError(503);
    }
    const raw = await read(upstream.body);
    if (!upstream.ok) {
      let title = 'sourcing_supply_unavailable';
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
      upstream.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('Content-Type') ?? '')
    )
      throw new SupplyProxyError(503);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new SupplyProxyError(503);
    }
    const parsed = (
      list
        ? v2
          ? supplyPageV2Schema
          : supplyPageSchema
        : detail
          ? v2
            ? supplyDetailV2Schema
            : supplyDetailSchema
          : supplyEventsSchema
    ).safeParse(value);
    if (!parsed.success) throw new SupplyProxyError(503);
    if (
      (list &&
        (v2 ? supplyPageV2Schema : supplyPageSchema).parse(parsed.data).requestId !== path[0]) ||
      (detail &&
        ((v2 ? supplyDetailV2Schema : supplyDetailSchema).parse(parsed.data).requestId !==
          path[0] ||
          (v2 ? supplyDetailV2Schema : supplyDetailSchema).parse(parsed.data).task.id !==
            path[taskIndex]))
    )
      throw new SupplyProxyError(503);
    return Response.json(parsed.data, { status: 200, headers });
  } catch (error) {
    const status = error instanceof SupplyProxyError ? error.status : 503;
    return Response.json(
      { title: status === 400 ? 'invalid_sourcing_supply_cursor' : 'sourcing_supply_unavailable' },
      { status, headers },
    );
  }
}

import { readCustomerShipment } from './order-shipment-contract.ts';
import {
  cancelOrderSchema,
  createOrderResultV2Schema,
  orderDetailV2Schema,
  orderInputSchema,
  orderPageV2Schema,
} from './order-v2-contract.ts';
import { isCustomerOrderV2Path } from './order-v2-path.ts';
import { publicOrigin } from './seo.ts';
import type { OrderProxyEnvironment } from './order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class BoundaryError extends Error {
  status: number;
  constructor(status: number) {
    super('Private order boundary unavailable');
    this.status = status;
  }
}
async function readText(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
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
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return new TextDecoder('utf8', { fatal: true }).decode(bytes);
  } catch {
    throw new BoundaryError(status);
  }
}
export async function proxyOrdersV2(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const full = '/api/orders/v2' + (path.length ? '/' + path.join('/') : ''),
    search = new URL(request.url).search;
  if (!isCustomerOrderV2Path(full + search, request.method))
    return new Response(null, { status: 404, headers });
  const base = environment.SHOP_API_URL,
    origin = publicOrigin(environment);
  if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'order_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization))
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    const root = path.length === 0;
    let body: string | undefined, input: unknown;
    if (request.method === 'POST') {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new BoundaryError(413);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new BoundaryError(400);
      try {
        input = JSON.parse(await readText(request.body, 16384, 413));
      } catch (e) {
        if (e instanceof BoundaryError) throw e;
        throw new BoundaryError(400);
      }
      const parsed = (root ? orderInputSchema : cancelOrderSchema).safeParse(input);
      if (!parsed.success) throw new BoundaryError(400);
      input = parsed.data;
      body = JSON.stringify(input);
    }
    const forwarded = new Headers({
      'Content-Type': 'application/json',
      Authorization: authorization,
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) forwarded.set('Origin', supplied);
    const response = await fetcher(base.replace(/\/$/, '') + full + search, {
      method: request.method,
      headers: forwarded,
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 1048576) {
      await response.body?.cancel();
      throw new BoundaryError(503);
    }
    const raw = await readText(response.body, 1048576, 503);
    if (!response.ok) {
      let title = 'order_unavailable';
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
          headers,
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
    if (root && request.method === 'POST') {
      const parsed = createOrderResultV2Schema.parse(value);
      if (
        parsed.order.quoteId !== orderInputSchema.parse(input).quoteId ||
        parsed.order.originalSnapshotVersion !== 2
      )
        throw new BoundaryError(503);
      return Response.json(parsed, { status: response.status, headers });
    }
    if (root) return Response.json(orderPageV2Schema.parse(value), { headers });
    if (path.length === 2 && path[1] === 'shipment') {
      if (response.status !== 200) throw new BoundaryError(503);
      return Response.json(readCustomerShipment(value, path[0]), { headers });
    }
    const parsed = orderDetailV2Schema.parse(value);
    if (parsed.summary.id !== path[0]) throw new BoundaryError(503);
    return Response.json(parsed, { headers });
  } catch (e) {
    const status = e instanceof BoundaryError ? e.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_order'
            : status === 413
              ? 'order_too_large'
              : 'order_unavailable',
      },
      { status, headers },
    );
  }
}

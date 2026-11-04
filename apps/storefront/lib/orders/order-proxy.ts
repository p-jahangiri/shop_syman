import {
  cancelOrderSchema,
  createOrderResultSchema,
  orderDetailSchema,
  orderInputSchema,
  orderPageSchema,
} from '@sayman/web-shared/lib/orders/order-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class ProxyError extends Error {
  status: number;
  constructor(status: number) {
    super('Order proxy failed');
    this.status = status;
  }
}
async function text(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ProxyError(status);
      }
      parts.push(p.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
export interface OrderProxyEnvironment {
  SHOP_API_URL?: string;
  SHOP_PUBLIC_URL?: string;
  SHOP_DATA_MODE?: string;
}
export async function proxyOrders(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const root = path.length === 0;
  const detail = path.length === 1 && /^[a-f0-9]{32}$/.test(path[0]);
  const cancel = path.length === 2 && /^[a-f0-9]{32}$/.test(path[0]) && path[1] === 'cancel';
  if (!(
    (root && ['GET', 'POST'].includes(request.method)) ||
    (detail && request.method === 'GET') ||
    (cancel && request.method === 'POST')
  ))
    return new Response(null, { status: 404, headers });
  const base = environment.SHOP_API_URL,
    origin = publicOrigin(environment);
  if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'order_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    const search = new URL(request.url).searchParams;
    const keys = [...search.keys()];
    const cursor = search.get('cursor');
    if (
      keys.length &&
      (!root ||
        request.method !== 'GET' ||
        keys.length !== 1 ||
        keys[0] !== 'cursor' ||
        !cursor ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    )
      throw new ProxyError(400);
    const authorization = request.headers.get('Authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization))
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    let body: string | undefined;
    if (request.method === 'POST') {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new ProxyError(413);
      let value: unknown;
      try {
        value = JSON.parse(await text(request.body, 16384, 413));
      } catch (e) {
        if (e instanceof ProxyError) throw e;
        throw new ProxyError(400);
      }
      const parsed = (root ? orderInputSchema : cancelOrderSchema).safeParse(value);
      if (!parsed.success) throw new ProxyError(400);
      body = JSON.stringify(parsed.data);
    }
    const forwarded = new Headers({
      'Content-Type': 'application/json',
      Authorization: authorization,
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) forwarded.set('Origin', supplied);
    const upstream = await fetcher(
      `${base.replace(/\/$/, '')}/api/orders${path.length ? '/' + path.join('/') : ''}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      {
        method: request.method,
        headers: forwarded,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
      },
    );
    const raw = await text(upstream.body, 1048576, 503);
    if (!upstream.ok) {
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
          status: [400, 401, 403, 404, 409, 429, 503].includes(upstream.status)
            ? upstream.status
            : 503,
          headers,
        },
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ProxyError(503);
    }
    const result = (
      root
        ? request.method === 'POST'
          ? createOrderResultSchema
          : orderPageSchema
        : orderDetailSchema
    ).safeParse(value);
    if (!result.success) throw new ProxyError(503);
    if (root && request.method === 'POST') {
      const parsed = createOrderResultSchema.parse(result.data);
      if (parsed.order.quoteId !== JSON.parse(body!).quoteId) throw new ProxyError(503);
    } else if (!root && orderDetailSchema.parse(result.data).summary.id !== path[0])
      throw new ProxyError(503);
    return Response.json(result.data, { status: upstream.status === 201 ? 201 : 200, headers });
  } catch (e) {
    const status = e instanceof ProxyError ? e.status : 503;
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

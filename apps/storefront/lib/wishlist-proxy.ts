import { wishlistInputSchema, wishlistSchema, isWishlistPath } from './wishlist-contract.ts';
import { publicOrigin } from './seo.ts';
import type { OrderProxyEnvironment } from './order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
class Bounded extends Error {
  status: number;
  constructor(status: number) {
    super();
    this.status = status;
  }
}
async function text(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  const reader = stream?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new Bounded(status);
        }
        chunks.push(p.value);
      }
  } finally {
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function proxyWishlist(
  request: Request,
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const u = new URL(request.url),
    origin = publicOrigin(environment);
  if (!isWishlistPath(u.pathname + u.search, request.method) || u.hash)
    return new Response(null, { status: 404, headers });
  let api: URL;
  try {
    api = new URL(environment.SHOP_API_URL ?? '');
    if (
      environment.SHOP_DATA_MODE !== 'api' ||
      !origin ||
      !['http:', 'https:'].includes(api.protocol) ||
      api.username ||
      api.password ||
      api.search ||
      api.hash ||
      !['', '/'].includes(api.pathname)
    )
      throw Error();
  } catch {
    return Response.json({ title: 'wishlist_unavailable' }, { status: 503, headers });
  }
  if (
    (request.method !== 'GET' || request.headers.has('Origin')) &&
    request.headers.get('Origin') !== origin
  )
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return new Response(null, { status: 401, headers });
  try {
    let body: string | undefined;
    if (request.method === 'PUT') {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new Bounded(413);
      const raw = await text(request.body, 16384, 413);
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Bounded(400);
      }
      const input = wishlistInputSchema.safeParse(value);
      if (!input.success) throw new Bounded(400);
      body = JSON.stringify(input.data);
    }
    const response = await fetcher(api.origin + '/api/wishlist', {
      method: request.method,
      body,
      headers: {
        Authorization: bearer,
        Origin: origin!,
        'Content-Type': 'application/json',
        'X-Sayman-Client': 'storefront',
      },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 32768) {
      await response.body?.cancel();
      throw new Bounded(503);
    }
    const raw = await text(response.body, 32768, 503);
    if (!response.ok) {
      let title = 'wishlist_unavailable';
      try {
        const p = JSON.parse(raw);
        if (typeof p.title === 'string' && /^[a-z_]{1,100}$/.test(p.title)) title = p.title;
      } catch {
        /* Preserve the status-based error when the optional response body is invalid. */
      }
      return Response.json(
        { title },
        {
          status: [400, 401, 403, 409, 429, 503].includes(response.status) ? response.status : 503,
          headers,
        },
      );
    }
    if (
      response.status !== 200 ||
      response.headers.has('Set-Cookie') ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw new Bounded(503);
    return Response.json(wishlistSchema.parse(JSON.parse(raw)), { headers });
  } catch (error) {
    const status = error instanceof Bounded ? error.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_wishlist'
            : status === 413
              ? 'wishlist_too_large'
              : 'wishlist_unavailable',
      },
      { status, headers },
    );
  }
}

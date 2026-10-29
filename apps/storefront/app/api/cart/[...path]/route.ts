import type { NextRequest } from 'next/server';
import { cartInputSchema, cartSnapshotSchema } from '@/lib/cart-contract';
import { quoteInputSchema, quoteSnapshotSchema } from '@/lib/quote-contract';
import { publicOrigin } from '@/lib/seo';
import { proxySourcingCart } from '@/lib/sourcing-proxy';
import { proxyCartV2 } from '@/lib/cart-v2-proxy';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class ProxyError extends Error {
  constructor(public status: number) {
    super('Cart proxy failed');
  }
}
async function boundedText(stream: ReadableStream<Uint8Array> | null, max: number, status = 413) {
  if (!stream) return '';
  const reader = stream.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ProxyError(status);
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
  return new TextDecoder().decode(bytes);
}
async function handler(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path;
  const locale = path[0];
  const merge = path.length === 2 && path[1] === 'merge';
  const quote = path.length === 2 && path[1] === 'quote';
  if (path[1] === 'v2')
    return proxyCartV2(request, locale, path.slice(2), {
      SHOP_API_URL: process.env.SHOP_API_URL,
      SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
      SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    });
  if (path[1] === 'sourcing')
    return proxySourcingCart(request, locale, path.slice(2), {
      SHOP_API_URL: process.env.SHOP_API_URL,
      SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
      SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    });
  if (
    !['fa', 'en'].includes(locale) ||
    !(
      (path.length === 1 && ['GET', 'PUT'].includes(request.method)) ||
      ((merge || quote) && request.method === 'POST')
    )
  )
    return new Response(null, { status: 404, headers });
  const base = process.env.SHOP_API_URL;
  const origin = publicOrigin();
  if (!base || !origin || process.env.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'cart_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    let body: string | undefined;
    if (request.method !== 'GET') {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new ProxyError(413);
      let input: unknown;
      try {
        input = JSON.parse((await boundedText(request.body, 16384)) || '{}');
      } catch (e) {
        if (e instanceof ProxyError) throw e;
        throw new ProxyError(400);
      }
      if (merge) {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new ProxyError(400);
        body = '{}';
      } else {
        const parsed = (quote ? quoteInputSchema : cartInputSchema).safeParse(input);
        if (!parsed.success) throw new ProxyError(400);
        body = JSON.stringify(parsed.data);
      }
    }
    const upstreamHeaders = new Headers({
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    const authorization = request.headers.get('Authorization');
    if (authorization) {
      if (authorization.length > 8192) throw new ProxyError(400);
      upstreamHeaders.set('Authorization', authorization);
    }
    if (supplied) upstreamHeaders.set('Origin', supplied);
    const cookie = request.cookies.get('sayman_cart')?.value;
    if (cookie)
      upstreamHeaders.set(
        'Cookie',
        `sayman_cart=${/^[A-Za-z0-9_-]{43}$/.test(cookie) ? cookie : 'invalid'}`,
      );
    const response = await fetch(
      `${base.replace(/\/$/, '')}/api/cart/${locale}${merge ? '/merge' : quote ? '/quote' : ''}`,
      {
        method: request.method,
        headers: upstreamHeaders,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      },
    );
    const outgoing = new Headers(headers);
    for (const cookie of response.headers.getSetCookie())
      if (cookie.startsWith('sayman_cart=')) outgoing.append('Set-Cookie', cookie);
    const raw = await boundedText(response.body, quote ? 1048576 : 262144, 503);
    if (!response.ok) {
      let title = 'cart_unavailable';
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.title === 'string' && /^[a-z_]{1,80}$/.test(parsed.title))
          title = parsed.title;
      } catch {
        /* Error bodies are not passed through. */
      }
      return Response.json(
        { title },
        {
          status: [400, 401, 403, 409, 429, 503].includes(response.status) ? response.status : 503,
          headers: outgoing,
        },
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ProxyError(503);
    }
    const result = (quote ? quoteSnapshotSchema : cartSnapshotSchema).safeParse(value);
    if (!result.success || result.data.locale !== locale) throw new ProxyError(503);
    return Response.json(result.data, { headers: outgoing });
  } catch (e) {
    const status = e instanceof ProxyError ? e.status : 503;
    return Response.json(
      {
        title:
          status === 400 ? 'invalid_cart' : status === 413 ? 'cart_too_large' : 'cart_unavailable',
      },
      { status, headers },
    );
  }
}
export const GET = handler;
export const PUT = handler;
export const POST = handler;
export const DELETE = handler;

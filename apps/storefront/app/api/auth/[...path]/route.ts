import type { NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/seo';
import { refreshCookieName, readRefreshCookie, safeRefreshCookie } from '@/lib/auth-cookie';
const routes: Record<string, string[]> = {
  password: ['POST'],
  refresh: ['POST'],
  logout: ['POST'],
  me: ['GET'],
  'mfa/verify': ['POST'],
  otp: ['POST'],
  register: ['POST'],
  'password-reset': ['POST'],
};
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class ProxyError extends Error {
  constructor(public status: number) {
    super('Authentication proxy unavailable');
  }
}
async function text(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ProxyError(status);
      }
      chunks.push(chunk.value);
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
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  if (!routes[path]?.includes(request.method))
    return new Response(null, { status: 404, headers: privateHeaders });
  const base = process.env.SHOP_API_URL;
  const origin = publicOrigin();
  if (!base || !origin || process.env.SHOP_DATA_MODE === 'preview')
    return Response.json({ title: 'unconfigured' }, { status: 503, headers: privateHeaders });
  const supplied = request.headers.get('Origin');
  if (
    request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
    ((request.method !== 'GET' || supplied) && supplied !== origin)
  )
    return new Response(null, { status: 403, headers: privateHeaders });
  try {
    if (request.nextUrl.search) throw new ProxyError(400);
    if (
      request.method !== 'GET' &&
      !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')
    )
      throw new ProxyError(415);
    if (Number(request.headers.get('Content-Length')) > 16000) throw new ProxyError(413);
    const body = request.method === 'GET' ? undefined : await text(request.body, 16000, 413);
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) headers.set('Origin', supplied);
    const token = request.headers.get('Authorization');
    if (token) {
      if (token.length > 8192) throw new ProxyError(400);
      headers.set('Authorization', token);
    }
    const https = origin.startsWith('https:');
    const cookieName = refreshCookieName(https);
    let cookie: string | undefined;
    try {
      cookie = readRefreshCookie(request.headers.get('Cookie'), cookieName);
    } catch {
      throw new ProxyError(400);
    }
    if (cookie) headers.set('Cookie', `${cookieName}=${cookie}`);
    const response = await fetch(`${base.replace(/\/$/, '')}/api/auth/${path}`, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const outgoing = new Headers(privateHeaders);
    for (const cookie of response.headers.getSetCookie()) {
      const safe = safeRefreshCookie(cookie, https);
      if (safe) outgoing.append('Set-Cookie', safe);
      else throw new ProxyError(503);
    }
    if (response.status === 204) return new Response(null, { status: 204, headers: outgoing });
    const raw = await text(response.body, 32768, 503);
    if (!response.ok) {
      const status = [400, 401, 403, 409, 415, 429, 503].includes(response.status)
        ? response.status
        : 503;
      return Response.json(
        {
          title:
            status === 401
              ? 'invalid_credentials'
              : status === 429
                ? 'rate_limited'
                : 'unavailable',
        },
        { status, headers: outgoing },
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ProxyError(503);
    }
    return Response.json(value, { status: response.status, headers: outgoing });
  } catch (error) {
    const status = error instanceof ProxyError ? error.status : 503;
    return Response.json({ title: 'unavailable' }, { status, headers: privateHeaders });
  }
}
export const GET = proxy;
export const POST = proxy;

import { boundedRealtimeBody } from '@sayman/web-shared/lib/notifications/realtime-stream.ts';
import {
  isPrivateRealtimePath,
  realtimeNegotiationSchema,
  validRealtimeClientFrames,
  validRealtimeServerFrames,
} from '@sayman/web-shared/lib/notifications/realtime-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import type { OrderProxyEnvironment } from '../orders/order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
export async function proxyPrivateRealtime(
  request: Request,
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(request.url),
    path = url.pathname + url.search,
    method = request.method;
  if (!isPrivateRealtimePath(path, method)) return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment),
    api = environment.SHOP_API_URL;
  if (environment.SHOP_DATA_MODE !== 'api' || !origin || !api)
    return Response.json({ title: 'realtime_unconfigured' }, { status: 503, headers });
  let target: URL;
  try {
    target = new URL(api);
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      !['', '/'].includes(target.pathname)
    )
      throw Error();
  } catch {
    return Response.json({ title: 'realtime_unconfigured' }, { status: 503, headers });
  }
  const supplied = request.headers.get('Origin');
  if ((supplied && supplied !== origin) || (method !== 'GET' && supplied !== origin))
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return new Response(null, { status: 401, headers });
  const negotiate = url.pathname.endsWith('/negotiate');
  let body: string | undefined;
  try {
    if (Number(request.headers.get('Content-Length')) > 4096)
      return new Response(null, { status: 413, headers });
    const raw = await boundedRealtimeBody(request.body, 4096);
    if (negotiate || method !== 'POST') {
      if (raw !== '') return new Response(null, { status: 400, headers });
    } else {
      if (!/^text\/plain(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        return new Response(null, { status: 415, headers });
      if (!validRealtimeClientFrames(raw)) return new Response(null, { status: 400, headers });
      body = raw;
    }
  } catch {
    return new Response(null, { status: 400, headers });
  }
  try {
    const response = await fetcher(target.origin + path, {
      method,
      body,
      headers: {
        Authorization: bearer,
        Origin: origin,
        'Content-Type': 'text/plain;charset=UTF-8',
        'X-Sayman-Client': 'storefront',
      },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 65536) {
      await response.body?.cancel();
      throw Error('Private realtime capacity');
    }
    const raw = await boundedRealtimeBody(response.body, 65536);
    if (!response.ok)
      return Response.json(
        { title: 'realtime_unavailable' },
        {
          status: [400, 401, 403, 404, 405, 413, 415, 429, 503].includes(response.status)
            ? response.status
            : 503,
          headers,
        },
      );
    if (negotiate) {
      if (
        response.status !== 200 ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
      )
        throw Error('Private realtime negotiation');
      return Response.json(realtimeNegotiationSchema.parse(JSON.parse(raw)), { headers });
    }
    if (![200, 202, 204].includes(response.status) || !validRealtimeServerFrames(raw))
      throw Error('Private realtime frames');
    return new Response(response.status === 204 ? null : raw, {
      status: response.status,
      headers: { ...headers, 'Content-Type': 'text/plain;charset=UTF-8' },
    });
  } catch {
    return Response.json({ title: 'realtime_unavailable' }, { status: 503, headers });
  }
}

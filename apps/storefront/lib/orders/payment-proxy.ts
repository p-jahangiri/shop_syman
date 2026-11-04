import { isCustomerPaymentPath } from './payment-path.ts';
import {
  readCustomerPaymentPage,
  readPaymentAttempt,
} from '@sayman/web-shared/lib/orders/payment-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import type { OrderProxyEnvironment } from './order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
async function bounded(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return '';
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 262144) {
        await reader.cancel();
        throw Error('Payment response limit');
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder('utf8', { fatal: true }).decode(bytes);
}
export async function proxyPayment(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const full = '/api/payments/' + path.join('/'),
    search = new URL(request.url).search;
  if (!isCustomerPaymentPath(full + search, request.method))
    return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment),
    base = environment.SHOP_API_URL;
  if (!origin || !base || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'payment_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if (supplied && supplied !== origin) return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
  try {
    const forwarded = new Headers({
      Authorization: bearer,
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) forwarded.set('Origin', supplied);
    const response = await fetcher(base.replace(/\/$/, '') + full + search, {
      method: 'GET',
      headers: forwarded,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 262144) {
      await response.body?.cancel();
      throw Error('Payment response limit');
    }
    const raw = await bounded(response.body);
    if (!response.ok) {
      let title = 'payment_unavailable';
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
          status: [400, 401, 403, 404, 409, 429, 503].includes(response.status)
            ? response.status
            : 503,
          headers,
        },
      );
    }
    if (
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw Error('Payment response unavailable');
    const value = JSON.parse(raw),
      data =
        path[0] === 'orders'
          ? readCustomerPaymentPage(value, path[1])
          : readPaymentAttempt(value, path[1]);
    return Response.json(data, { headers });
  } catch {
    return Response.json({ title: 'payment_unavailable' }, { status: 503, headers });
  }
}

import {
  readCustomerDigitalDeliveries,
  readDigitalDeliveryContent,
  customerDigitalPath,
} from '@sayman/web-shared/lib/orders/order-digital-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import type { OrderProxyEnvironment } from './order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
class Boundary extends Error {
  status: number;
  constructor(status: number) {
    super('Private digital delivery boundary unavailable');
    this.status = status;
  }
}
async function text(stream: ReadableStream<Uint8Array> | null, max: number) {
  if (!stream) return '';
  const r = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const p = await r.read();
      if (p.done) break;
      size += p.value.byteLength;
      if (size > max) {
        await r.cancel();
        throw new Boundary(503);
      }
      parts.push(p.value);
    }
  } finally {
    r.releaseLock();
  }
  const out = new Uint8Array(size);
  let n = 0;
  for (const p of parts) {
    out.set(p, n);
    n += p.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}
export async function proxyOrderDigital(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const baseHeaders = new Headers(headers),
    problem = (status: number, title = 'digital_delivery_unavailable') =>
      Response.json({ title }, { status, headers: baseHeaders });
  try {
    if (request.method !== 'GET') return problem(405);
    const v2 = path[0] === 'v2',
      p = v2 ? path.slice(1) : path;
    if (
      (p.length !== 3 && p.length !== 5) ||
      p[1] !== 'fulfillment' ||
      p[2] !== 'digital' ||
      (p.length === 5 && p[4] !== 'content')
    )
      return problem(404);
    if ([...new URL(request.url).searchParams].length)
      return problem(400, 'invalid_digital_delivery');
    let target: string;
    try {
      target = customerDigitalPath(p[0], p.length === 5 ? p[3] : undefined, v2);
    } catch {
      return problem(400, 'invalid_digital_delivery');
    }
    const base = environment.SHOP_API_URL,
      origin = publicOrigin(environment);
    if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
      return problem(503, 'digital_delivery_unconfigured');
    const supplied = request.headers.get('Origin');
    if (supplied && supplied !== origin) return problem(403);
    const authorization = request.headers.get('Authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization))
      return problem(401, 'invalid_credentials');
    const forwarded = new Headers({
      Authorization: authorization,
      'X-Sayman-Client': 'storefront',
      Accept: 'application/json',
    });
    if (supplied) forwarded.set('Origin', supplied);
    const response = await fetcher(base.replace(/\/$/, '') + target, {
      headers: forwarded,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    const max = p.length === 5 ? 524288 : 16777216;
    if (
      response.headers.has('Set-Cookie') ||
      Number(response.headers.get('Content-Length')) > max
    ) {
      await response.body?.cancel();
      throw new Boundary(503);
    }
    const raw = await text(response.body, max),
      installed = response.headers.get('X-Sayman-Fulfillment-Contract') === 'digital-v1';
    if (installed) baseHeaders.set('X-Sayman-Fulfillment-Contract', 'digital-v1');
    if (!response.ok) {
      if (response.status === 404 && !installed)
        return problem(503, 'digital_delivery_contract_unavailable');
      let title = 'digital_delivery_unavailable';
      try {
        const value = JSON.parse(raw);
        if (typeof value.title === 'string' && /^[a-z_]{1,100}$/.test(value.title))
          title = value.title;
      } catch {
        /* Preserve the status-based error when the optional response body is invalid. */
      }
      return problem(
        [400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 503,
        title,
      );
    }
    if (
      response.status !== 200 ||
      !installed ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw new Boundary(503);
    const value = JSON.parse(raw),
      parsed =
        p.length === 5
          ? readDigitalDeliveryContent(value, p[0], p[3])
          : readCustomerDigitalDeliveries(value, p[0]);
    return Response.json(parsed, { headers: baseHeaders });
  } catch (e) {
    return problem(e instanceof Boundary ? e.status : 503);
  }
}

import {
  readCustomerFulfillment,
  readParcelDetail,
  customerFulfillmentPath,
} from './order-parcel-contract.ts';
import { publicOrigin } from './seo.ts';
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
    super('Private parcel boundary unavailable');
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
export async function proxyOrderParcels(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const baseHeaders = new Headers(headers),
    problem = (status: number, title = 'parcel_unavailable') =>
      Response.json({ title }, { status, headers: baseHeaders });
  try {
    if (request.method !== 'GET') return problem(405);
    const v2 = path[0] === 'v2',
      p = v2 ? path.slice(1) : path;
    if (
      (p.length !== 2 && p.length !== 4) ||
      p[1] !== 'fulfillment' ||
      (p.length === 4 && p[2] !== 'parcels')
    )
      return problem(404);
    const search = new URL(request.url).searchParams,
      keys = [...search.keys()];
    let after: string | undefined;
    if (keys.length) {
      if (
        p.length !== 2 ||
        keys.length !== 1 ||
        keys[0] !== 'after' ||
        !(after = search.get('after') ?? undefined)
      )
        return problem(400, 'invalid_parcel');
    }
    let target: string;
    try {
      target = customerFulfillmentPath(p[0], p.length === 4 ? p[3] : undefined, after);
      if (!v2) target = target.replace('/orders/v2/', '/orders/');
    } catch {
      return problem(400, 'invalid_parcel');
    }
    const base = environment.SHOP_API_URL,
      origin = publicOrigin(environment);
    if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
      return problem(503, 'parcel_unconfigured');
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
    const max = p.length === 4 ? 4194304 : 524288;
    if (
      response.headers.has('Set-Cookie') ||
      Number(response.headers.get('Content-Length')) > max
    ) {
      await response.body?.cancel();
      throw new Boundary(503);
    }
    const raw = await text(response.body, max),
      installed = response.headers.get('X-Sayman-Fulfillment-Contract') === 'parcels-v1';
    if (installed) baseHeaders.set('X-Sayman-Fulfillment-Contract', 'parcels-v1');
    if (!response.ok) {
      if (response.status === 404 && !installed) return problem(503, 'parcel_contract_unavailable');
      let title = 'parcel_unavailable';
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
        p.length === 4
          ? readParcelDetail(value, p[0], p[3], true)
          : readCustomerFulfillment(value, p[0]);
    return Response.json(parsed, { headers: baseHeaders });
  } catch (e) {
    return problem(e instanceof Boundary ? e.status : 503);
  }
}

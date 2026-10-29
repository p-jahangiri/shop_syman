import {
  addressBook,
  saveAddressInput,
  saveAddressResult,
  deleteAddressInput,
} from './address-contract.ts';
import { publicOrigin } from './seo.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class ProxyError extends Error {
  status: number;
  constructor(status: number) {
    super('Address proxy failed');
    this.status = status;
  }
}
async function read(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
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
export interface AddressProxyEnvironment {
  SHOP_API_URL?: string;
  SHOP_PUBLIC_URL?: string;
  SHOP_DATA_MODE?: string;
}
export async function proxyAddresses(
  request: Request,
  path: string[],
  environment: AddressProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const root = path.length === 0;
  const item = path.length === 1 && /^[a-f0-9]{32}$/.test(path[0]);
  if (!((root && request.method === 'GET') || (item && ['PUT', 'DELETE'].includes(request.method))))
    return new Response(null, { status: 404, headers });
  const base = environment.SHOP_API_URL,
    origin = publicOrigin(environment);
  if (!base || !origin || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'address_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    if (new URL(request.url).search) throw new ProxyError(400);
    const authorization = request.headers.get('Authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(authorization))
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    let body: string | undefined;
    if (request.method !== 'GET') {
      if (Number(request.headers.get('Content-Length')) > 16384) throw new ProxyError(413);
      let value: unknown;
      try {
        value = JSON.parse(await read(request.body, 16384, 413));
      } catch (e) {
        if (e instanceof ProxyError) throw e;
        throw new ProxyError(400);
      }
      const parsed = (request.method === 'PUT' ? saveAddressInput : deleteAddressInput).safeParse(
        value,
      );
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
      `${base.replace(/\/$/, '')}/api/addresses${item ? '/' + path[0] : ''}`,
      {
        method: request.method,
        headers: forwarded,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
      },
    );
    const raw = await read(upstream.body, 524288, 503);
    if (!upstream.ok) {
      let title = 'address_unavailable';
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
    if (request.method === 'DELETE') {
      if (upstream.status !== 204 || raw) throw new ProxyError(503);
      return new Response(null, { status: 204, headers });
    }
    if (![200, 201].includes(upstream.status) || (root && upstream.status !== 200))
      throw new ProxyError(503);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ProxyError(503);
    }
    if (root) {
      const parsed = addressBook.safeParse(value);
      if (!parsed.success) throw new ProxyError(503);
      return Response.json(parsed.data, { status: 200, headers });
    }
    const parsed = saveAddressResult.safeParse(value);
    if (!parsed.success || parsed.data.address.id !== path[0]) throw new ProxyError(503);
    return Response.json(parsed.data, { status: upstream.status, headers });
  } catch (e) {
    const status = e instanceof ProxyError ? e.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_address'
            : status === 413
              ? 'address_too_large'
              : 'address_unavailable',
      },
      { status, headers },
    );
  }
}

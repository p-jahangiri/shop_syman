import { isChequeApprovalPath, approvalPageSchema } from './cheque-approval-contract.ts';
import { publicOrigin } from './seo.ts';
import type { OrderProxyEnvironment } from './order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
export async function proxyChequeApproval(
  request: Request,
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const u = new URL(request.url),
    path = u.pathname + u.search;
  if (!isChequeApprovalPath(path, request.method) || u.hash)
    return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment);
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
    return Response.json({ title: 'cheque_approval_unavailable' }, { status: 503, headers });
  }
  if (request.headers.has('Origin') && request.headers.get('Origin') !== origin)
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return new Response(null, { status: 401, headers });
  try {
    const response = await fetcher(api.origin + path, {
      method: 'GET',
      headers: { Authorization: bearer, Origin: origin!, 'X-Sayman-Client': 'storefront' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 262144) {
      await response.body?.cancel();
      throw Error('Capacity');
    }
    const reader = response.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 262144) {
            await reader.cancel();
            throw Error('Capacity');
          }
          chunks.push(part.value);
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
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!response.ok) {
      let title = 'cheque_approval_unavailable';
      try {
        const p = JSON.parse(raw);
        if (typeof p.title === 'string' && /^[a-z_]{1,100}$/.test(p.title)) title = p.title;
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
      response.headers.has('Set-Cookie') ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw Error('Private JSON required');
    const id = u.pathname.split('/')[4],
      page = approvalPageSchema.parse(JSON.parse(raw));
    if (page.orderId !== id) throw Error('Wrong customer upfront confirmation');
    return Response.json(page, { headers });
  } catch {
    return Response.json({ title: 'cheque_approval_unavailable' }, { status: 503, headers });
  }
}

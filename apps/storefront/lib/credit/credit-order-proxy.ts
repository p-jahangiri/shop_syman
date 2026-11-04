import {
  isCreditOrderPath,
  creditOrderInputSchema,
  creditOrderResultSchema,
  creditOrderDetailSchema,
  creditOrderReadinessSchema,
  creditQuoteHistorySchema,
  readCreditOrderInputResult,
  type CreditOrderInput,
} from '@sayman/web-shared/lib/credit/credit-order-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import type { OrderProxyEnvironment } from '../orders/order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
class BoundaryError extends Error {
  status: number;
  constructor(status: number) {
    super('Private cheque order boundary');
    this.status = status;
  }
}
async function bounded(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new BoundaryError(status);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BoundaryError(status);
  }
}
export async function proxyCreditOrders(
  request: Request,
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!isCreditOrderPath(path + url.search, method) || url.hash)
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
    return Response.json({ title: 'credit_order_unavailable' }, { status: 503, headers });
  }
  const supplied = request.headers.get('Origin');
  if ((supplied && supplied !== origin) || (method !== 'GET' && supplied !== origin))
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return new Response(null, { status: 401, headers });
  let input: CreditOrderInput | undefined, body: string | undefined;
  try {
    if (method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new BoundaryError(415);
      if (Number(request.headers.get('Content-Length')) > 16384) throw new BoundaryError(413);
      try {
        input = creditOrderInputSchema.parse(JSON.parse(await bounded(request.body, 16384, 413)));
        body = JSON.stringify(input);
      } catch (e) {
        if (e instanceof BoundaryError) throw e;
        throw new BoundaryError(400);
      }
    }
    const response = await fetcher(api.origin + path + url.search, {
      method,
      headers: {
        Authorization: bearer,
        Origin: origin!,
        'Content-Type': 'application/json',
        'X-Sayman-Client': 'storefront',
      },
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 1048576) {
      await response.body?.cancel();
      throw new BoundaryError(503);
    }
    const raw = await bounded(response.body, 1048576, 503);
    if (!response.ok) {
      let title = 'credit_order_unavailable';
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
          status: [400, 401, 403, 404, 409, 413, 415, 429, 503].includes(response.status)
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
      throw new BoundaryError(503);
    const value = JSON.parse(raw),
      parts = path.split('/'),
      id = parts.at(-1)!;
    if (input) return Response.json(readCreditOrderInputResult(value, id, input), { headers });
    if (parts.length === 4 && parts[3] === 'quotes')
      return Response.json(creditQuoteHistorySchema.parse(value), { headers });
    if (parts.length === 6 && parts[3] === 'quotes' && parts[5] === 'readiness') {
      const r = creditOrderReadinessSchema.parse(value);
      if (r.creditQuoteId !== parts[4]) throw new BoundaryError(503);
      return Response.json(r, { headers });
    }
    if (parts[3] === 'commands') {
      const r = creditOrderResultSchema.parse(value);
      if (r.commandId !== id || !r.replayed) throw new BoundaryError(503);
      return Response.json(r, { headers });
    }
    const r = creditOrderDetailSchema.parse(value);
    if (r.order.summary.id !== id) throw new BoundaryError(503);
    return Response.json(r, { headers });
  } catch (e) {
    const status = e instanceof BoundaryError ? e.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_credit_order'
            : status === 413
              ? 'credit_order_too_large'
              : 'credit_order_unavailable',
      },
      { status, headers },
    );
  }
}

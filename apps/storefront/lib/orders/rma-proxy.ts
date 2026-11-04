import {
  isCustomerRmaPath,
  readRmaCommandResult,
  readRmaContext,
  readRmaDetail,
  readRmaPage,
  readRmaPublicPolicy,
  rmaCreateInputSchema,
  rmaWithdrawInputSchema,
  type RmaCommandResult,
} from '@sayman/web-shared/lib/orders/rma-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import type { OrderProxyEnvironment } from './order-proxy.ts';

const requestLimit = 32768,
  responseLimit = 2097152;
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
class Boundary extends Error {
  status: number;
  constructor(status: number) {
    super('Return request boundary unavailable');
    this.status = status;
  }
}

// Parse before validating the schema, while retaining object keys that JSON.parse
// would otherwise collapse. Match the API's case-insensitive duplicate rule.
function parseJson(raw: string): unknown {
  const result: unknown = JSON.parse(raw);
  // eslint-disable-next-line no-control-regex -- A JSON string cannot contain literal controls.
  const stringToken = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/y;
  let at = 0;
  const whitespace = () => {
    while (at < raw.length && /[ \t\r\n]/.test(raw[at])) at++;
  };
  const string = () => {
    stringToken.lastIndex = at;
    const match = stringToken.exec(raw);
    if (!match) throw Error('Invalid JSON');
    at = stringToken.lastIndex;
    return JSON.parse(match[0]) as string;
  };
  const value = (depth: number): void => {
    if (depth > 32) throw Error('JSON nesting exceeds its bound');
    whitespace();
    if (raw[at] === '{') {
      at++;
      whitespace();
      const keys = new Set<string>();
      if (raw[at] !== '}')
        while (true) {
          const key = string().toLowerCase();
          if (keys.has(key)) throw Error('Ambiguous JSON');
          keys.add(key);
          whitespace();
          if (raw[at++] !== ':') throw Error('Invalid JSON');
          value(depth + 1);
          whitespace();
          if (raw[at] !== ',') break;
          at++;
          whitespace();
        }
      if (raw[at++] !== '}') throw Error('Invalid JSON');
    } else if (raw[at] === '[') {
      at++;
      whitespace();
      if (raw[at] !== ']')
        while (true) {
          value(depth + 1);
          whitespace();
          if (raw[at] !== ',') break;
          at++;
        }
      if (raw[at++] !== ']') throw Error('Invalid JSON');
    } else if (raw[at] === '"') string();
    else {
      const start = at;
      while (at < raw.length && !/[\s,}\]]/.test(raw[at])) at++;
      if (at === start) throw Error('Invalid JSON');
    }
  };
  value(0);
  whitespace();
  if (at !== raw.length) throw Error('Invalid JSON');
  return result;
}

async function read(stream: ReadableStream<Uint8Array> | null, maximum: number, status: number) {
  const reader = stream?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw new Boundary(status);
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
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Boundary(status === 413 ? 400 : status);
  }
}

export async function proxyRma(
  request: Request,
  path: string[],
  scope: 'returns' | 'orders',
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(request.url),
    pathname = '/api/' + scope + (path.length ? '/' + path.join('/') : ''),
    publicPolicy = scope === 'returns' && path.length === 1 && path[0] === 'policy',
    headers = new Headers(
      publicPolicy
        ? { ...privateHeaders, 'Cache-Control': 'public, no-store', Vary: 'Origin' }
        : privateHeaders,
    ),
    problem = (status: number, title = 'rma_unavailable') =>
      Response.json({ title }, { status, headers });
  try {
    const route = pathname + url.search;
    if (url.pathname !== pathname || url.hash) return problem(404, 'rma_not_found');
    if (path.some((part) => /^0{32}$/.test(part))) return problem(400, 'invalid_rma');
    if (
      publicPolicy
        ? request.method !== 'GET' || !!url.search
        : !isCustomerRmaPath(route, request.method)
    )
      return problem(
        request.method === 'GET' || request.method === 'PUT' ? 400 : 405,
        'invalid_rma',
      );
    let api: URL;
    const origin = publicOrigin(environment);
    try {
      api = new URL(environment.SHOP_API_URL ?? '');
      if (
        environment.SHOP_DATA_MODE !== 'api' ||
        !origin ||
        !['http:', 'https:'].includes(api.protocol) ||
        publicOrigin({ SHOP_PUBLIC_URL: api.origin }) !== api.origin ||
        api.username ||
        api.password ||
        api.search ||
        api.hash ||
        api.pathname !== '/'
      )
        throw Error('Unconfigured');
    } catch {
      return problem(503, 'rma_unconfigured');
    }
    const forwarded = new Headers({ Accept: 'application/json' });
    if (!publicPolicy) {
      const supplied = request.headers.get('Origin');
      if (
        request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
        ((request.method !== 'GET' || request.headers.has('Origin')) && supplied !== origin)
      )
        return problem(403, 'forbidden');
      const bearer = request.headers.get('Authorization');
      if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
        return problem(401, 'invalid_credentials');
      forwarded.set('Authorization', bearer);
      forwarded.set('X-Sayman-Client', 'storefront');
      if (supplied) forwarded.set('Origin', supplied);
    }
    let body: string | undefined;
    if (request.method === 'PUT') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        return problem(415, 'invalid_rma');
      if (Number(request.headers.get('Content-Length')) > requestLimit) throw new Boundary(413);
      const raw = await read(request.body, requestLimit, 413);
      try {
        const input = (scope === 'orders' ? rmaCreateInputSchema : rmaWithdrawInputSchema).parse(
          parseJson(raw),
        );
        body = JSON.stringify(input);
      } catch {
        return problem(400, 'invalid_rma');
      }
      forwarded.set('Content-Type', 'application/json');
    } else if (request.body || Number(request.headers.get('Content-Length')) > 0)
      return problem(400, 'invalid_rma');
    const response = await fetcher(api.origin + route, {
      method: request.method,
      body,
      headers: forwarded,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (
      response.headers.has('Set-Cookie') ||
      Number(response.headers.get('Content-Length')) > responseLimit ||
      response.redirected
    ) {
      await response.body?.cancel();
      throw new Boundary(503);
    }
    const installed = response.headers.get('X-Sayman-Returns-Contract') === 'rma-v1';
    if (installed) headers.set('X-Sayman-Returns-Contract', 'rma-v1');
    if (response.status === 404 && !installed) {
      await response.body?.cancel();
      return problem(503, 'rma_contract_unavailable');
    }
    const raw = await read(response.body, responseLimit, 503);
    if (!response.ok) {
      if (!raw && [401, 403].includes(response.status))
        return new Response(null, { status: response.status, headers });
      if (![400, 401, 403, 404, 409, 413, 415, 429, 503].includes(response.status))
        return problem(503);
      let title = 'rma_unavailable';
      if (raw) {
        if (
          !/^application\/(?:problem\+)?json(?:\s*;|$)/i.test(
            response.headers.get('Content-Type') ?? '',
          )
        )
          throw new Boundary(503);
        const value = parseJson(raw);
        if (
          value &&
          typeof value === 'object' &&
          'title' in value &&
          typeof value.title === 'string' &&
          /^[a-z_]{1,100}$/.test(value.title)
        )
          title = value.title;
      }
      return problem(response.status, title);
    }
    if (
      ![200, ...(request.method === 'PUT' && scope === 'orders' ? [201] : [])].includes(
        response.status,
      ) ||
      !installed ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw new Boundary(503);
    const value = parseJson(raw),
      commandId = path.at(-1)!,
      parsed = publicPolicy
        ? readRmaPublicPolicy(value)
        : scope === 'orders'
          ? request.method === 'GET'
            ? readRmaContext(value, path[0])
            : readRmaCommandResult(value, { orderId: path[0], commandId })
          : path.length === 0
            ? readRmaPage(value)
            : path.length === 1
              ? readRmaDetail(value, { caseId: path[0] })
              : readRmaCommandResult(value, {
                  commandId,
                  ...(path[0] === 'commands' ? {} : { caseId: path[0] }),
                });
    if (response.status === 201)
      headers.set('Location', '/api/returns/' + (parsed as RmaCommandResult).case.case.id);
    return Response.json(parsed, { status: response.status, headers });
  } catch (e) {
    return problem(e instanceof Boundary ? e.status : 503);
  }
}

export const proxyReturns = (
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) => proxyRma(request, path, 'returns', environment, fetcher);
export const proxyOrderReturns = (
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) => proxyRma(request, path, 'orders', environment, fetcher);

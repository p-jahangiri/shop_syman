import { marketIdSchema } from './market-contract.ts';
import {
  phoneItemSchema,
  phonePageSchema,
  phoneSearchSchema,
  phoneCommandId,
  phoneId,
  phoneInterestInputSchema,
  phoneInterestPageSchema,
  phoneInterestSchema,
  phoneInterestResultSchema,
  type PhoneSearch,
} from './phone-discovery-contract.ts';
import { publicOrigin } from './seo.ts';
import type { Locale } from './types.ts';
export interface PhoneEnvironment {
  SHOP_API_URL?: string;
  SHOP_DATA_MODE?: string;
  SHOP_PUBLIC_URL?: string;
}
export class PhoneReadError extends Error {
  status: number;
  constructor(status: number) {
    super('phone_unavailable');
    this.status = status;
  }
}
const publicHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  },
  privateHeaders = {
    ...publicHeaders,
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Authorization',
  };
async function bounded(stream: ReadableStream<Uint8Array> | null, max: number) {
  if (!stream) return '';
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const v = await reader.read();
      if (v.done) break;
      size += v.value.length;
      if (size > max) {
        await reader.cancel();
        throw new PhoneReadError(413);
      }
      parts.push(v.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function base(e: PhoneEnvironment) {
  if (!e.SHOP_API_URL || e.SHOP_DATA_MODE !== 'api') throw new PhoneReadError(503);
  const u = new URL(e.SHOP_API_URL);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !['', '/'].includes(u.pathname)
  )
    throw new PhoneReadError(503);
  return u.origin;
}
async function remote(
  path: string,
  e: PhoneEnvironment,
  body: object | undefined,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  bearer?: string,
  method?: string,
) {
  try {
    const response = await fetcher(base(e) + '/api/phones/' + path, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer
          ? {
              Authorization: bearer,
              Origin: publicOrigin(e) ?? '',
              'X-Sayman-Client': 'storefront',
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (response.headers.has('Set-Cookie')) {
      await response.body?.cancel();
      throw new PhoneReadError(503);
    }
    if (Number(response.headers.get('Content-Length')) > 2097152) {
      await response.body?.cancel();
      throw new PhoneReadError(503);
    }
    const raw = await bounded(response.body, 2097152);
    if (!response.ok) {
      throw new PhoneReadError(
        [400, 401, 403, 404, 409, 413, 415, 429].includes(response.status) ? response.status : 503,
      );
    }
    if (
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw new PhoneReadError(503);
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof PhoneReadError) throw error;
    throw new PhoneReadError(503);
  }
}
export async function readPhonePage(
  locale: Locale,
  input: Partial<PhoneSearch>,
  e: PhoneEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const query = phoneSearchSchema.parse(input),
    v = phonePageSchema.safeParse(await remote(locale + '/search', e, query, fetcher, signal));
  if (
    !v.success ||
    v.data.locale !== locale ||
    v.data.page !== query.page ||
    v.data.pageSize !== query.pageSize ||
    v.data.items.some(
      (i) =>
        (query.brandId && i.model.brandId !== query.brandId) ||
        !i.configurations.some(
          (c) =>
            (!query.ramGb || c.ramGb === query.ramGb) &&
            (!query.storageGb || c.storageGb === query.storageGb) &&
            (!query.colorKey || c.colorKey === query.colorKey),
        ),
    )
  )
    throw new PhoneReadError(503);
  return v.data;
}
export async function readPhoneItem(
  locale: Locale,
  id: string,
  e: PhoneEnvironment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  marketIdSchema.parse(id);
  const v = phoneItemSchema.safeParse(
    await remote(locale + '/' + encodeURIComponent(id), e, undefined, fetcher, signal),
  );
  if (!v.success || v.data.id !== id) throw new PhoneReadError(503);
  return v.data;
}
export async function proxyPhones(
  request: Request,
  path: string[],
  e: PhoneEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(request.url),
    isPrivate = path[0] === 'interests',
    headers = isPrivate ? privateHeaders : publicHeaders,
    locale = path[0] as Locale;
  const search =
      path.length === 2 &&
      ['fa', 'en'].includes(locale) &&
      path[1] === 'search' &&
      request.method === 'POST',
    detail =
      path.length === 2 &&
      ['fa', 'en'].includes(locale) &&
      path[1] !== 'search' &&
      marketIdSchema.safeParse(path[1]).success &&
      request.method === 'GET';
  const interestDetail =
    isPrivate &&
    path.length === 3 &&
    path[1] !== 'commands' &&
    marketIdSchema.safeParse(path[1]).success &&
    phoneId.safeParse(path[2]).success &&
    request.method === 'GET';
  const list = isPrivate && path.length === 1 && request.method === 'GET',
    receipt =
      isPrivate &&
      path.length === 3 &&
      path[1] === 'commands' &&
      phoneCommandId.safeParse(path[2]).success &&
      request.method === 'GET',
    write =
      isPrivate &&
      path.length === 4 &&
      marketIdSchema.safeParse(path[1]).success &&
      path[2] === 'commands' &&
      phoneCommandId.safeParse(path[3]).success &&
      request.method === 'PUT';
  if (!search && !detail && !list && !receipt && !write && !interestDetail)
    return new Response(null, { status: 404, headers });
  try {
    const expected = publicOrigin(e) ?? url.origin,
      origin = request.headers.get('Origin');
    if ((origin && origin !== expected) || (write && origin !== expected))
      throw new PhoneReadError(403);
    if (list) {
      if (
        [...url.searchParams.keys()].some((k) => k !== 'cursor') ||
        url.searchParams.getAll('cursor').length > 1 ||
        (url.searchParams.has('cursor') &&
          !phoneId.safeParse(url.searchParams.get('cursor')).success)
      )
        throw new PhoneReadError(400);
    } else if (url.search) throw new PhoneReadError(400);
    let bearer: string | undefined;
    if (isPrivate) {
      bearer = request.headers.get('Authorization') ?? undefined;
      if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
        throw new PhoneReadError(401);
      if (!publicOrigin(e)) throw new PhoneReadError(503);
    }
    let body: unknown;
    if (search || write) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new PhoneReadError(415);
      if (Number(request.headers.get('Content-Length')) > 4096) throw new PhoneReadError(413);
      try {
        body = JSON.parse(await bounded(request.body, 4096));
      } catch (error) {
        if (error instanceof PhoneReadError) throw error;
        throw new PhoneReadError(400);
      }
    }
    let value;
    if (search) {
      const p = phoneSearchSchema.safeParse(body);
      if (!p.success) throw new PhoneReadError(400);
      value = await readPhonePage(locale, p.data, e, fetcher, request.signal);
    } else if (detail) value = await readPhoneItem(locale, path[1], e, fetcher, request.signal);
    else {
      const p = write ? phoneInterestInputSchema.safeParse(body) : null;
      if (p && !p.success) throw new PhoneReadError(400);
      const raw = await remote(
          path.join('/') + url.search,
          e,
          p?.data,
          fetcher,
          request.signal,
          bearer,
          request.method,
        ),
        parsed = (
          list
            ? phoneInterestPageSchema
            : interestDetail
              ? phoneInterestSchema
              : phoneInterestResultSchema
        ).safeParse(raw);
      if (!parsed.success) throw new PhoneReadError(503);
      if (interestDetail) {
        const v = phoneInterestSchema.parse(parsed.data);
        if (v.listingId !== path[1] || v.configuration.id !== path[2])
          throw new PhoneReadError(503);
      } else if (!list) {
        const result = phoneInterestResultSchema.parse(parsed.data);
        if (
          result.requestId !== (write ? path[3] : path[2]) ||
          (write &&
            (result.interest.listingId !== path[1] ||
              result.interest.configuration.id !== p!.data!.configurationId ||
              result.interest.state !== (p!.data!.active ? 'Active' : 'Cancelled')))
        )
          throw new PhoneReadError(503);
      }
      value = parsed.data;
    }
    return Response.json(value, { headers });
  } catch (error) {
    const status = error instanceof PhoneReadError ? error.status : 503;
    return Response.json(
      {
        title:
          status === 401
            ? 'invalid_credentials'
            : status === 409
              ? 'phone_conflict'
              : status === 400
                ? 'invalid_phone_query'
                : 'phone_unavailable',
      },
      { status, headers },
    );
  }
}

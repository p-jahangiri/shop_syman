import {
  otpChallengeSchema,
  otpRequestSchema,
  otpVerifySchema,
  otpPublicErrors,
} from './customer-otp-contract.ts';
import { refreshCookieName, readRefreshCookie, safeRefreshCookie } from './auth-cookie.ts';
import { customerAuthSchema } from './customer-auth-contract.ts';
const routes: Record<string, string[]> = {
  password: ['POST'],
  refresh: ['POST'],
  logout: ['POST'],
  me: ['GET'],
  'mfa/verify': ['POST'],
  otp: ['POST'],
  'otp/verify': ['POST'],
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
  status: number;
  constructor(status: number) {
    super('Authentication proxy unavailable');
    this.status = status;
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
export type AuthProxyEnvironment = {
  SHOP_API_URL?: string;
  SHOP_PUBLIC_URL?: string;
  SHOP_DATA_MODE?: string;
};
export async function proxyAuth(
  request: Request,
  segments: string[],
  environment: AuthProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const path = segments.join('/');
  const isOtp = path === 'otp' || path === 'otp/verify';
  if (!routes[path]?.includes(request.method))
    return new Response(null, { status: 404, headers: privateHeaders });
  const base = environment.SHOP_API_URL;
  const origin = environment.SHOP_PUBLIC_URL;
  if (!base || !origin || environment.SHOP_DATA_MODE === 'preview')
    return Response.json({ title: 'unconfigured' }, { status: 503, headers: privateHeaders });
  const supplied = request.headers.get('Origin');
  if (
    request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
    ((request.method !== 'GET' || supplied) && supplied !== origin)
  )
    return new Response(null, { status: 403, headers: privateHeaders });
  try {
    if (new URL(request.url).search) throw new ProxyError(400);
    if (
      request.method !== 'GET' &&
      !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')
    )
      throw new ProxyError(415);
    if (Number(request.headers.get('Content-Length')) > 16000) throw new ProxyError(413);
    let body = request.method === 'GET' ? undefined : await text(request.body, 16000, 413);
    if (isOtp) {
      let input: unknown;
      try {
        input = JSON.parse(body ?? '');
      } catch {
        throw new ProxyError(400);
      }
      const parsed = (path === 'otp' ? otpRequestSchema : otpVerifySchema).safeParse(input);
      if (!parsed.success) throw new ProxyError(400);
      body = JSON.stringify(parsed.data);
    }
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) headers.set('Origin', supplied);
    const token = request.headers.get('Authorization');
    if (token && !isOtp) {
      if (token.length > 8192) throw new ProxyError(400);
      headers.set('Authorization', token);
    }
    const https = origin.startsWith('https:');
    const cookieName = refreshCookieName(https);
    let cookie: string | undefined;
    try {
      cookie = isOtp ? undefined : readRefreshCookie(request.headers.get('Cookie'), cookieName);
    } catch {
      throw new ProxyError(400);
    }
    if (cookie && !isOtp) headers.set('Cookie', `${cookieName}=${cookie}`);
    const response = await fetcher(`${base.replace(/\/$/, '')}/api/auth/${path}`, {
      method: request.method,
      credentials: 'omit',
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const outgoing = new Headers(privateHeaders);
    const cookies = response.headers.getSetCookie();
    if ((path === 'otp' || (isOtp && !response.ok)) && cookies.length) throw new ProxyError(503);
    for (const cookie of cookies) {
      const safe = safeRefreshCookie(cookie, https);
      if (safe) outgoing.append('Set-Cookie', safe);
      else throw new ProxyError(503);
    }
    if (response.status === 204) {
      if (isOtp) throw new ProxyError(503);
      return new Response(null, { status: 204, headers: outgoing });
    }
    const raw = await text(response.body, 32768, 503);
    if (!response.ok) {
      const statuses = isOtp
        ? [400, 401, 403, 409, 410, 415, 429, 503]
        : [400, 401, 403, 409, 415, 429, 503];
      const status = statuses.includes(response.status) ? response.status : 503;
      let safeOtpTitle: string | undefined;
      if (isOtp) {
        try {
          const title: unknown = JSON.parse(raw)?.title;
          if (
            typeof title === 'string' &&
            otpPublicErrors[title]?.includes(status) &&
            (path === 'otp' || title !== 'otp_unknown')
          )
            safeOtpTitle = title;
        } catch {
          /* Never forward a raw provider error. */
        }
        const retry = response.headers.get('Retry-After');
        if (status === 429 && retry && /^[1-9][0-9]{0,3}$/.test(retry) && Number(retry) <= 3600)
          outgoing.set('Retry-After', retry);
      }
      return Response.json(
        {
          title:
            safeOtpTitle ??
            (path === 'otp' && status === 503
              ? 'otp_unknown'
              : status === 401
                ? 'invalid_credentials'
                : status === 429
                  ? 'rate_limited'
                  : 'unavailable'),
        },
        { status, headers: outgoing },
      );
    }
    let value: unknown;
    try {
      if (
        isOtp &&
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
      )
        throw new ProxyError(503);
      value = JSON.parse(raw);
    } catch {
      throw new ProxyError(503);
    }
    if (isOtp && response.status !== 200) throw new ProxyError(503);
    if (path === 'otp') {
      const parsed = otpChallengeSchema.safeParse(value);
      if (!parsed.success) throw new ProxyError(503);
      value = parsed.data;
    } else if (path === 'otp/verify') {
      const parsed = customerAuthSchema.safeParse(value);
      if (!parsed.success) throw new ProxyError(503);
      value = parsed.data;
    }
    return Response.json(value, { status: response.status, headers: outgoing });
  } catch (error) {
    const status = error instanceof ProxyError ? error.status : 503;
    return Response.json(
      { title: path === 'otp' && status === 503 ? 'otp_unknown' : 'unavailable' },
      { status, headers: privateHeaders },
    );
  }
}

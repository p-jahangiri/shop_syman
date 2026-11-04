import { isCustomerNotificationPath } from './notification-path.ts';
import {
  readNotifications,
  readNotificationResult,
  notificationCountSchema,
  notificationReadInputSchema,
} from '@sayman/web-shared/lib/notifications/notification-contract.ts';
import { readPhoneInbox, readPhoneInboxAcknowledgement } from './phone-inbox-contract.ts';
import { readCreditInbox, readCreditInboxAcknowledgement } from './credit-inbox-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import type { OrderProxyEnvironment } from '../orders/order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
async function bounded(stream: ReadableStream<Uint8Array> | null, maximum: number) {
  if (!stream) return '';
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw Error('Notification capacity');
      }
      parts.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function proxyNotifications(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const method = request.method,
    full = '/api/notifications' + (path.length ? '/' + path.join('/') : ''),
    url = new URL(request.url),
    search = url.search;
  if (!isCustomerNotificationPath(full + search, method) || url.pathname !== full)
    return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment),
    base = environment.SHOP_API_URL;
  if (!origin || !base || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'notifications_unconfigured' }, { status: 503, headers });
  try {
    const api = new URL(base);
    if (
      !['http:', 'https:'].includes(api.protocol) ||
      api.username ||
      api.password ||
      api.search ||
      api.hash ||
      !['', '/'].includes(api.pathname)
    )
      throw Error();
  } catch {
    return Response.json({ title: 'notifications_unconfigured' }, { status: 503, headers });
  }
  const supplied = request.headers.get('Origin');
  if ((supplied && supplied !== origin) || (method !== 'GET' && supplied !== origin))
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
  let body: string | undefined;
  if (method === 'PUT') {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
      return new Response(null, { status: 415, headers });
    if (Number(request.headers.get('Content-Length')) > 1024)
      return new Response(null, { status: 413, headers });
    try {
      notificationReadInputSchema.parse(JSON.parse(await bounded(request.body, 1024)));
      body = '{}';
    } catch {
      return Response.json({ title: 'invalid_notification' }, { status: 400, headers });
    }
  }
  try {
    const response = await fetcher(base.replace(/\/$/, '') + full + search, {
      method,
      headers: {
        Authorization: bearer,
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Sayman-Client': 'storefront',
      },
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (['credit-reminders', 'phones'].includes(path[0]) && response.headers.has('Set-Cookie')) {
      await response.body?.cancel();
      throw Error('Private credit notification cookie rejected');
    }
    if (Number(response.headers.get('Content-Length')) > 65536) {
      await response.body?.cancel();
      throw Error('Notification capacity');
    }
    const raw = await bounded(response.body, 65536);
    if (!response.ok) {
      let title = 'notification_unavailable';
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
          status: [400, 401, 403, 404, 409, 413, 415, 429, 503].includes(response.status)
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
      throw Error('Notification unavailable');
    const value = JSON.parse(raw),
      credit = path[0] === 'credit-reminders',
      data =
        path[0] === 'phones'
          ? method === 'PUT'
            ? readPhoneInboxAcknowledgement(value, path[1])
            : path[1] === 'unread-count'
              ? notificationCountSchema.parse(value)
              : readPhoneInbox(
                  value,
                  url.searchParams.get('unreadOnly') === 'true',
                  url.searchParams.get('cursor'),
                )
          : credit
            ? method === 'PUT'
              ? readCreditInboxAcknowledgement(value, path[1])
              : path[1] === 'unread-count'
                ? notificationCountSchema.parse(value)
                : readCreditInbox(
                    value,
                    url.searchParams.get('unreadOnly') === 'true',
                    url.searchParams.get('cursor'),
                  )
            : method === 'PUT'
              ? readNotificationResult(value, path[0])
              : path[0] === 'unread-count'
                ? notificationCountSchema.parse(value)
                : readNotifications(
                    value,
                    url.searchParams.get('unreadOnly') === 'true',
                    url.searchParams.get('cursor'),
                  );
    return Response.json(data, { headers });
  } catch {
    return Response.json({ title: 'notification_unavailable' }, { status: 503, headers });
  }
}

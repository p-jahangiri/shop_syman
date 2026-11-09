import { isCustomerTicketPath } from './ticket-path.ts';
import { isTicketFilePath } from '@sayman/web-shared/lib/support/ticket-file-contract.ts';
import { proxyTicketFile } from './ticket-file-proxy.ts';
import {
  readTicketPage,
  readTicketDetail,
  readTicketMessages,
  readTicketResult,
  ticketResultSchema,
  ticketCreateSchema,
  ticketReplySchema,
  ticketStateInputSchema,
  type TicketCommand,
} from '@sayman/web-shared/lib/support/ticket-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import { communityReplyInput } from '@sayman/web-shared/lib/support/product-questions.ts';
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
        throw Error('Private support payload limit');
      }
      parts.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function proxyTicket(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const full = '/api/support/' + path.join('/'),
    search = new URL(request.url).search,
    method = request.method;
  if (isTicketFilePath(full + search, method))
    return proxyTicketFile(request, environment, fetcher);
  if (!isCustomerTicketPath(full + search, method))
    return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment),
    base = environment.SHOP_API_URL;
  if (!origin || !base || environment.SHOP_DATA_MODE !== 'api')
    return Response.json({ title: 'support_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((supplied && supplied !== origin) || (method !== 'GET' && supplied !== origin))
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
  const communityReply = path[0] === 'product-questions';
  let body: string | undefined, command: TicketCommand | undefined;
  if (method !== 'GET') {
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        return new Response(null, { status: 415, headers });
      if (Number(request.headers.get('Content-Length')) > 32768)
        return new Response(null, { status: 413, headers });
      const raw = JSON.parse(await bounded(request.body, 32768));
      if (communityReply) body = JSON.stringify(communityReplyInput.parse(raw));
      else {
        command =
          path[1] === 'commands'
            ? { id: path[2], kind: 'create', staff: false, body: ticketCreateSchema.parse(raw) }
            : path[2] === 'replies'
              ? {
                  id: path[3],
                  kind: 'reply',
                  staff: false,
                  ticketId: path[1],
                  body: ticketReplySchema.parse(raw),
                }
              : {
                  id: path[3],
                  kind: 'state',
                  staff: false,
                  ticketId: path[1],
                  body: ticketStateInputSchema.parse(raw),
                };
        body = JSON.stringify(command.body);
      }
    } catch {
      return Response.json({ title: 'invalid_ticket' }, { status: 400, headers });
    }
  }
  try {
    const forwarded = new Headers({
      Authorization: bearer,
      'Content-Type': 'application/json',
      Origin: origin,
      'X-Sayman-Client': 'storefront',
    });
    const response = await fetcher(base.replace(/\/$/, '') + full + search, {
      method,
      headers: forwarded,
      body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 1048576) {
      await response.body?.cancel();
      throw Error('Support response limit');
    }
    const raw = await bounded(response.body, 1048576);
    if (!response.ok) {
      let title = 'ticket_unavailable';
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.title === 'string' && /^[a-z_]{1,100}$/.test(parsed.title))
          title = parsed.title;
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
    if (communityReply && response.status === 204)
      return new Response(null, { status: 204, headers });
    if (
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw Error('Support response unavailable');
    const value = JSON.parse(raw);
    let data: unknown;
    if (command) data = readTicketResult(value, command);
    else if (path[0] === 'commands') {
      const receipt = ticketResultSchema.parse(value);
      if (receipt.commandId !== path[1]) throw Error('Wrong command receipt');
      data = receipt;
    } else if (path.length === 1)
      data = readTicketPage(value, new URL(request.url).searchParams.get('state'));
    else
      data =
        path.length === 2 ? readTicketDetail(value, path[1]) : readTicketMessages(value, path[1]);
    return Response.json(data, { headers });
  } catch {
    return Response.json({ title: 'ticket_unavailable' }, { status: 503, headers });
  }
}

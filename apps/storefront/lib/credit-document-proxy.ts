import {
  boundedPrivateBytes,
  PrivateFileBoundError,
  privateFileMaximum,
  privateFileTypes,
  privateFileSignature,
  selectedTicketFile,
} from './ticket-file-contract.ts';
import {
  isCreditDocumentPath,
  creditDocumentCommandSchema,
  creditDocumentResultSchema,
  readCreditDocumentResult,
  readCreditDocuments,
  type CreditDocumentCommand,
} from './credit-document-contract.ts';
import { publicOrigin } from './seo.ts';
import type { OrderProxyEnvironment } from './order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
let activeUploads = 0;
let activeDownloads = 0;
function privateDownloadBody(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  release: () => void,
) {
  let offset = 0,
    finished = false,
    timer: ReturnType<typeof setTimeout>,
    controller: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    bytes.fill(0);
    release();
  };
  const abort = () => {
    if (finished) return;
    controller.error(Error('Private download closed'));
    finish();
  };
  return new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
        timer = setTimeout(abort, 30000);
        timer.unref?.();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      },
      pull(value) {
        if (finished) return;
        if (offset === bytes.length) {
          value.close();
          finish();
          return;
        }
        const end = Math.min(bytes.length, offset + 65536);
        value.enqueue(bytes.slice(offset, end));
        offset = end;
      },
      cancel() {
        finish();
      },
    },
    { highWaterMark: 0 },
  );
}
export async function proxyCreditDocument(
  request: Request,
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!isCreditDocumentPath(path + url.search, method))
    return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment),
    base = environment.SHOP_API_URL;
  let api: URL;
  try {
    api = new URL(base ?? '');
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
    return Response.json({ title: 'private_file_unavailable' }, { status: 503, headers });
  }
  const supplied = request.headers.get('Origin');
  if ((supplied && supplied !== origin) || (method !== 'GET' && supplied !== origin))
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return new Response(null, { status: 401, headers });
  if (request.headers.has('Range')) return new Response(null, { status: 400, headers });
  const upload = method === 'POST',
    parts = path.split('/'),
    download = method === 'GET' && parts.length === 8 && parts[6] === 'files';
  let body: Uint8Array<ArrayBuffer> | undefined, command: CreditDocumentCommand | undefined;
  const contentType = request.headers.get('Content-Type') ?? '';
  if ((upload && activeUploads >= 2) || (download && activeDownloads >= 2))
    return new Response(null, { status: 429, headers });
  if (upload) activeUploads++;
  if (download) activeDownloads++;
  let transferred = false,
    released = false;
  const releaseDownload = () => {
    if (download && !released) {
      released = true;
      activeDownloads--;
    }
  };
  try {
    if (upload) {
      if (!/^multipart\/form-data;\s*boundary=/i.test(contentType))
        return new Response(null, { status: 415, headers });
      if (Number(request.headers.get('Content-Length')) > privateFileMaximum + 65536)
        return new Response(null, { status: 413, headers });
      try {
        body = await boundedPrivateBytes(
          request.body,
          privateFileMaximum + 65536,
          AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
        );
        const form = await new Response(body, {
          headers: { 'Content-Type': contentType },
        }).formData();
        const keys = [...form.keys()];
        if (
          keys.length !== 7 ||
          new Set(keys).size !== 7 ||
          keys.some(
            (x) =>
              ![
                'version',
                'consentId',
                'requirementsRevisionId',
                'documentKey',
                'replacesFileId',
                'sha256',
                'file',
              ].includes(x),
          )
        )
          throw Error();
        const file = form.get('file');
        if (!(file instanceof File)) throw Error();
        if (file.size > privateFileMaximum) throw new PrivateFileBoundError();
        const selected = await selectedTicketFile(file);
        if (form.get('sha256') !== selected.metadata.sha256) throw Error();
        command = creditDocumentCommandSchema.parse({
          id: parts[7],
          applicationId: parts[4],
          body: {
            version: form.get('version'),
            consentId: form.get('consentId'),
            requirementsRevisionId: form.get('requirementsRevisionId'),
            documentKey: form.get('documentKey'),
            replacesFileId: form.get('replacesFileId') === '' ? null : form.get('replacesFileId'),
          },
          file: selected.metadata,
        });
      } catch (error) {
        return Response.json(
          {
            title:
              error instanceof PrivateFileBoundError
                ? 'private_file_too_large'
                : 'invalid_private_file',
          },
          { status: error instanceof PrivateFileBoundError ? 413 : 400, headers },
        );
      }
    }
    const response = await fetcher(api.origin + path, {
      method,
      body,
      headers: {
        Authorization: bearer,
        Origin: origin!,
        ...(upload ? { 'Content-Type': contentType } : {}),
        'X-Sayman-Client': 'storefront',
      },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
    });
    if (!response.ok) {
      const raw = await boundedPrivateBytes(response.body, 65536);
      let title = 'private_file_unavailable';
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
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
    if (response.status !== 200 || response.headers.has('Set-Cookie'))
      throw Error('Unsafe private document response');
    if (download) {
      const mime = response.headers.get('Content-Type') ?? '',
        length = Number(response.headers.get('Content-Length')),
        disposition = response.headers.get('Content-Disposition') ?? '',
        id = parts[7];
      if (
        !privateFileTypes.includes(mime as (typeof privateFileTypes)[number]) ||
        !Number.isSafeInteger(length) ||
        length < 16 ||
        length > privateFileMaximum ||
        response.headers.get('X-Sayman-Private-File') !== id ||
        !/^attachment(?:;|$)/i.test(disposition) ||
        !response.headers.get('Cache-Control')?.includes('no-store')
      ) {
        await response.body?.cancel();
        throw Error('Private document boundary');
      }
      const bytes = await boundedPrivateBytes(response.body, length);
      if (bytes.length !== length || !privateFileSignature(bytes, mime))
        throw Error('Private document integrity');
      const result = new Response(privateDownloadBody(bytes, request.signal, releaseDownload), {
        headers: {
          ...headers,
          'Content-Type': mime,
          'Content-Length': String(length),
          'Content-Disposition': disposition,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Sayman-Private-File': id,
        },
      });
      transferred = true;
      return result;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? ''))
      throw Error('Private document contract');
    const raw = await boundedPrivateBytes(response.body, 262144),
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    let result: unknown;
    if (command) result = readCreditDocumentResult(value, command);
    else if (parts[6] === 'commands') {
      const receipt = creditDocumentResultSchema.parse(value);
      if (
        !receipt.replayed ||
        receipt.commandId !== parts[7] ||
        receipt.application.id !== parts[4]
      )
        throw Error('Wrong credit document receipt');
      result = receipt;
    } else result = readCreditDocuments(value, parts[4]);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ title: 'private_file_unavailable' }, { status: 503, headers });
  } finally {
    body?.fill(0);
    if (upload) activeUploads--;
    if (!transferred) releaseDownload();
  }
}

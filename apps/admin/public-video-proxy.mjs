// Public issued videos only. No cookies, bearer tokens, redirects or arbitrary URLs.
const maximum = 40 * 1024 * 1024;
export function videoRange(value) {
  return value == null || /^bytes=(?:\d{1,10}-\d{0,10}|-\d{1,10})$/.test(value);
}
export async function publicCatalogVideo(request, response, destination) {
  const aborter = new AbortController(),
    abort = () => aborter.abort();
  request.once('aborted', abort);
  response.once('close', abort);
  const fail = (status = 503) => {
    if (!response.headersSent) {
      response.writeHead(status, { 'Cache-Control': 'no-store' });
      response.end();
    } else response.destroy();
  };
  try {
    const headers = { Accept: destination.pathname.endsWith('.mp4') ? 'video/mp4' : 'video/webm' };
    if (request.headers.range) headers.Range = request.headers.range;
    for (const name of ['if-range', 'if-none-match'])
      if (/^"[a-f0-9]{64}"$/.test(request.headers[name] ?? ''))
        headers[name] = request.headers[name];
    const remote = await fetch(destination, {
      method: 'GET',
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.any([aborter.signal, AbortSignal.timeout(30000)]),
    });
    if (remote.status === 404) {
      await remote.body?.cancel();
      fail(404);
      return;
    }
    if (remote.status === 429) {
      await remote.body?.cancel();
      response.setHeader('Retry-After', '2');
      fail(429);
      return;
    }
    const tag = remote.headers.get('etag') ?? '',
      size = Number(remote.headers.get('content-length')),
      type = remote.headers.get('content-type'),
      range = remote.headers.get('content-range') ?? '';
    if (
      remote.headers.has('set-cookie') ||
      remote.headers.has('content-encoding') ||
      /(?:^|,)\s*(?:cookie|authorization)\s*(?:,|$)/i.test(remote.headers.get('vary') ?? '') ||
      remote.headers.get('x-shop-public-resource') !== 'catalog-video-v1' ||
      !/^"[a-f0-9]{64}"$/.test(tag) ||
      !/\bpublic\b/i.test(remote.headers.get('cache-control') ?? '') ||
      /private|no-store/i.test(remote.headers.get('cache-control') ?? '')
    )
      throw Error('Invalid public video headers');
    if (remote.status === 304) {
      if (headers['if-none-match'] !== tag) throw Error('Unexpected304');
      response.writeHead(304, {
        ETag: tag,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      response.end();
      return;
    }
    if (remote.status === 416) {
      if (
        !/^bytes \*\/[1-9]\d{0,8}$/.test(range) ||
        Number(range.split('/')[1]) > maximum ||
        !headers.Range
      )
        throw Error('Invalid unsatisfied range');
      await remote.body?.cancel();
      response.writeHead(416, { 'Cache-Control': 'no-store', 'Content-Range': range });
      response.end();
      return;
    }
    if (
      ![200, 206].includes(remote.status) ||
      type !== headers.Accept ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > maximum ||
      !remote.body
    )
      throw Error('Invalid public video');
    if (remote.status === 206) {
      const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      if (
        !headers.Range ||
        !parsed ||
        Number(parsed[2]) - Number(parsed[1]) + 1 !== size ||
        Number(parsed[3]) > maximum ||
        Number(parsed[3]) <= Number(parsed[2]) ||
        Number(parsed[1]) > Number(parsed[2])
      )
        throw Error('Invalid range');
      const requested = /^bytes=(\d*)-(\d*)$/.exec(headers.Range),
        total = Number(parsed[3]);
      const start = requested[1] ? Number(requested[1]) : Math.max(0, total - Number(requested[2]));
      const end =
        requested[1] && requested[2] ? Math.min(total - 1, Number(requested[2])) : total - 1;
      if (
        Number(parsed[1]) !== start ||
        Number(parsed[2]) !== end ||
        (headers['if-range'] && headers['if-range'] !== tag)
      )
        throw Error('Mismatched requested range');
    } else if (range) throw Error('Unexpected content range');
    response.writeHead(remote.status, {
      'Content-Type': type,
      'Content-Length': String(size),
      ETag: tag,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      ...(remote.status === 206 ? { 'Content-Range': range } : {}),
      'X-Shop-Public-Resource': 'catalog-video-v1',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    let received = 0;
    for await (const part of remote.body) {
      received += part.length;
      if (received > size) throw Error('Oversized video');
      if (!response.write(part))
        await new Promise((resolve, reject) => {
          const done = () => {
            response.removeListener('close', closed);
            resolve();
          };
          const closed = () => {
            response.removeListener('drain', done);
            reject(Error('Disconnected'));
          };
          response.once('drain', done);
          response.once('close', closed);
        });
    }
    if (received !== size) throw Error('Incomplete video');
    response.end();
  } catch {
    fail();
  } finally {
    request.removeListener('aborted', abort);
    response.removeListener('close', abort);
    aborter.abort();
  }
}

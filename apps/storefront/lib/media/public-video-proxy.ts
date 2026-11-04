const maximum = 40 * 1024 * 1024;
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function proxyPublicVideo(request: Request, destination: string): Promise<Response> {
  const range = request.headers.get('range');
  if (range && !/^bytes=(?:\d{1,10}-\d{0,10}|-\d{1,10})$/.test(range))
    return new Response(null, { status: 416, headers: noStore });
  const headers = new Headers({
    Accept: destination.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
  });
  if (range) headers.set('Range', range);
  for (const name of ['if-range', 'if-none-match']) {
    const value = request.headers.get(name);
    if (value && /^"[a-f0-9]{64}"$/.test(value)) headers.set(name, value);
  }
  const aborter = new AbortController();
  try {
    const remote = await fetch(destination, {
      method: 'GET',
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, aborter.signal, AbortSignal.timeout(30000)]),
    });
    if (remote.status === 404) {
      await remote.body?.cancel();
      return new Response(null, { status: 404, headers: noStore });
    }
    if (remote.status === 429) {
      await remote.body?.cancel();
      return new Response(null, { status: 429, headers: { ...noStore, 'Retry-After': '2' } });
    }
    const tag = remote.headers.get('etag') ?? '',
      size = Number(remote.headers.get('content-length')),
      type = remote.headers.get('content-type'),
      contentRange = remote.headers.get('content-range') ?? '';
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
      if (headers.get('if-none-match') !== tag) throw Error('Unexpected304');
      return new Response(null, {
        status: 304,
        headers: { ETag: tag, 'Cache-Control': 'public, max-age=31536000, immutable' },
      });
    }
    if (remote.status === 416) {
      if (
        !/^bytes \*\/[1-9]\d{0,8}$/.test(contentRange) ||
        Number(contentRange.split('/')[1]) > maximum ||
        !range
      )
        throw Error('Invalid unsatisfied range');
      await remote.body?.cancel();
      return new Response(null, {
        status: 416,
        headers: { ...noStore, 'Content-Range': contentRange },
      });
    }
    if (
      ![200, 206].includes(remote.status) ||
      type !== headers.get('Accept') ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > maximum ||
      !remote.body
    )
      throw Error('Invalid public video');
    if (remote.status === 206) {
      const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
      if (
        !range ||
        !parsed ||
        Number(parsed[2]) - Number(parsed[1]) + 1 !== size ||
        Number(parsed[3]) > maximum ||
        Number(parsed[3]) <= Number(parsed[2]) ||
        Number(parsed[1]) > Number(parsed[2])
      )
        throw Error('Invalid range');
      const requested = /^bytes=(\d*)-(\d*)$/.exec(range!)!,
        total = Number(parsed[3]);
      const start = requested[1] ? Number(requested[1]) : Math.max(0, total - Number(requested[2]));
      const end =
        requested[1] && requested[2] ? Math.min(total - 1, Number(requested[2])) : total - 1;
      if (
        Number(parsed[1]) !== start ||
        Number(parsed[2]) !== end ||
        (headers.has('if-range') && headers.get('if-range') !== tag)
      )
        throw Error('Mismatched requested range');
    } else if (contentRange) throw Error('Unexpected range');
    const reader = remote.body.getReader();
    let received = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) {
            if (received !== size) throw Error('Incomplete video');
            controller.close();
            reader.releaseLock();
            return;
          }
          received += part.value.length;
          if (received > size) throw Error('Oversized video');
          controller.enqueue(part.value);
        } catch (error) {
          await reader.cancel().catch(() => {});
          aborter.abort();
          controller.error(error);
        }
      },
      async cancel(reason) {
        aborter.abort();
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: remote.status,
      headers: {
        'Content-Type': type!,
        'Content-Length': String(size),
        ETag: tag,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Accept-Ranges': 'bytes',
        ...(remote.status === 206 ? { 'Content-Range': contentRange } : {}),
        'X-Shop-Public-Resource': 'catalog-video-v1',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    aborter.abort();
    return new Response(null, { status: 503, headers: noStore });
  }
}

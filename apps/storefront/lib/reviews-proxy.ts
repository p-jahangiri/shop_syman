import {
  ownReview,
  reviewPage,
  reviewProductId,
  reviewId,
  reviewCursor,
  reviewResult,
  saveReviewInput,
  reportReviewInput,
} from './reviews-contract.ts';
import { publicOrigin } from './seo.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
class Failure extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Reviews unavailable');
    this.status = status;
  }
}
async function read(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return '';
  let size = 0;
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Failure(status);
      }
      parts.push(p.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Failure(status);
  }
}
export interface ReviewsEnvironment {
  SHOP_API_URL?: string;
  SHOP_PUBLIC_URL?: string;
  SHOP_DATA_MODE?: string;
}
export async function proxyReviews(
  request: Request,
  path: string[],
  environment: ReviewsEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const product = path[0] === 'products' && reviewProductId.safeParse(path[1]).success;
  const page = product && path.length === 2 && request.method === 'GET',
    mine = product && path.length === 3 && path[2] === 'mine' && request.method === 'GET',
    save =
      product &&
      path.length === 4 &&
      path[2] === 'commands' &&
      reviewId.safeParse(path[3]).success &&
      request.method === 'PUT',
    report =
      path.length === 3 &&
      reviewId.safeParse(path[0]).success &&
      path[1] === 'reports' &&
      reviewId.safeParse(path[2]).success &&
      request.method === 'POST';
  if (!(page || mine || save || report)) return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment);
  if (environment.SHOP_DATA_MODE !== 'api' || !environment.SHOP_API_URL || !origin)
    return Response.json({ title: 'reviews_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    const params = new URL(request.url).searchParams,
      cursor = params.get('cursor');
    if (
      params.size &&
      !(
        page &&
        params.size === 1 &&
        params.getAll('cursor').length === 1 &&
        reviewCursor.safeParse(cursor).success
      )
    )
      throw new Failure(400);
    const token = request.headers.get('Authorization');
    if ((!page && !token) || (token && !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(token)))
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    let body: string | undefined;
    if (save || report) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new Failure(400);
      if (Number(request.headers.get('Content-Length')) > 16384) throw new Failure(413);
      let value: unknown;
      try {
        value = JSON.parse(await read(request.body, 16384, 413));
      } catch (e) {
        if (e instanceof Failure) throw e;
        throw new Failure(400);
      }
      const parsed = (save ? saveReviewInput : reportReviewInput).safeParse(value);
      if (!parsed.success) throw new Failure(400);
      body = JSON.stringify(parsed.data);
    }
    const forwarded = new Headers({
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) forwarded.set('Origin', supplied);
    if (token && !page) forwarded.set('Authorization', token);
    const response = await fetcher(
      `${environment.SHOP_API_URL.replace(/\/$/, '')}/api/reviews/${path.map(encodeURIComponent).join('/')}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      {
        method: request.method,
        headers: forwarded,
        body,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
      },
    );
    const raw = await read(response.body, 524288, 503);
    if (!response.ok) {
      let title = 'reviews_unavailable';
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
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw new Failure(503);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Failure(503);
    }
    if (page) {
      const v = reviewPage.parse(value);
      if (v.items.some((r) => r.productId.toLowerCase() !== path[1].toLowerCase()))
        throw new Failure(503);
      return Response.json(v, { headers });
    }
    if (mine) {
      const v = ownReview.parse(value);
      if (v.review && v.review.productId.toLowerCase() !== path[1].toLowerCase())
        throw new Failure(503);
      return Response.json(v, { headers });
    }
    const v = reviewResult.parse(value);
    if (
      (save &&
        (!v.review || v.reported || v.review.productId.toLowerCase() !== path[1].toLowerCase())) ||
      (report && (!v.reported || v.review !== null))
    )
      throw new Failure(503);
    return Response.json(v, { headers });
  } catch (e) {
    const status = e instanceof Failure ? e.status : 503;
    return Response.json(
      {
        title:
          status === 400
            ? 'invalid_review'
            : status === 413
              ? 'review_too_large'
              : 'reviews_unavailable',
      },
      { status, headers },
    );
  }
}

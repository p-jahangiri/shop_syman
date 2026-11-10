import {
  ownReview,
  reviewPage,
  reviewProductId,
  reviewId,
  reviewCursor,
  helpfulReviewCursor,
  contributionCursor,
  contributionSchemas,
  voteState,
  voteRevisions,
  voteInput,
  voteResult,
  withdrawInput,
  withdrawResult,
  reviewResult,
  saveReviewInput,
  reviewPhotoRequestMaxBytes,
  reportReviewInput,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
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
async function readBytes(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  if (!stream) return new Uint8Array(0);
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
  return bytes;
}
async function read(stream: ReadableStream<Uint8Array> | null, max: number, status: number) {
  return decode(await readBytes(stream, max, status), status);
}
function decode(bytes: Uint8Array, status: number) {
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
  const photoTail = path.slice(5).join('/');
  const product = path[0] === 'products' && reviewProductId.safeParse(path[1]).success;
  const page = product && path.length === 2 && request.method === 'GET',
    watch = product && path.length === 3 && path[2] === 'watch' && request.method === 'GET',
    votes = product && path.length === 3 && path[2] === 'vote-state' && request.method === 'GET',
    account =
      path[0] === 'account' &&
      path.length === 2 &&
      request.method === 'GET' &&
      (path[1] === 'pending' || path[1] === 'reviews' || path[1] === 'questions')
        ? path[1]
        : null,
    vote =
      path.length === 3 &&
      path[1] === 'votes' &&
      reviewId.safeParse(path[0]).success &&
      reviewId.safeParse(path[2]).success &&
      request.method === 'PUT',
    withdraw =
      path.length === 3 &&
      path[1] === 'withdraw' &&
      reviewId.safeParse(path[0]).success &&
      reviewId.safeParse(path[2]).success &&
      request.method === 'PUT',
    mine = product && path.length === 3 && path[2] === 'mine' && request.method === 'GET',
    photo =
      product &&
      ['', 'mine', '2', '3', '2/mine', '3/mine'].includes(photoTail) &&
      path[2] === 'photos' &&
      reviewId.safeParse(path[3]).success &&
      reviewId.safeParse(path[4]).success &&
      request.method === 'GET',
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
  if (!(page || watch || mine || save || report || photo || votes || account || vote || withdraw))
    return new Response(null, { status: 404, headers });
  const anonymous = page || watch || (photo && !photoTail.endsWith('mine'));
  const origin = publicOrigin(environment);
  if (environment.SHOP_DATA_MODE !== 'api' || !environment.SHOP_API_URL || !origin)
    return Response.json({ title: 'reviews_unconfigured' }, { status: 503, headers });
  const supplied = request.headers.get('Origin');
  if ((request.method !== 'GET' || supplied) && supplied !== origin)
    return new Response(null, { status: 403, headers });
  try {
    const params = new URL(request.url).searchParams;
    const names = [...params.keys()];
    const allowed = page
      ? ['sort', 'cursor']
      : votes
        ? ['revisions']
        : account
          ? ['locale', 'cursor']
          : [];
    if (new Set(names).size !== names.length || names.some((key) => !allowed.includes(key)))
      throw new Failure(400);
    const sort = params.get('sort');
    const cursor = params.get('cursor');
    const locale = params.get('locale');
    const revisions = params.get('revisions');
    if (sort !== null && sort !== 'newest' && sort !== 'helpful') throw new Failure(400);
    if (
      cursor !== null &&
      !(
        sort === 'helpful'
          ? helpfulReviewCursor
          : account === 'questions'
            ? contributionCursor
            : reviewCursor
      ).safeParse(cursor).success
    )
      throw new Failure(400);
    if (
      account &&
      ((locale !== 'fa' && locale !== 'en') || (account === 'pending' && cursor !== null))
    )
      throw new Failure(400);
    if (votes && !voteRevisions.safeParse(revisions).success) throw new Failure(400);
    const token = request.headers.get('Authorization');
    if (!anonymous && (!token || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(token)))
      return Response.json({ title: 'invalid_credentials' }, { status: 401, headers });
    let body: string | undefined;
    if (save || report || vote || withdraw) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
        throw new Failure(400);
      const textLimit = 16_384;
      const limit = save ? reviewPhotoRequestMaxBytes : textLimit;
      if (Number(request.headers.get('Content-Length')) > limit) throw new Failure(413);
      let value: unknown;
      try {
        const bytes = await readBytes(request.body, limit, 413);
        value = JSON.parse(decode(bytes, 400));
        if (save && bytes.length > textLimit) {
          const input = value as { photo?: { action?: unknown }; photos?: unknown } | null;
          if (
            input?.photo?.action !== 'replace' &&
            !(
              Array.isArray(input?.photos) &&
              input.photos.some((photo) => photo?.action === 'replace')
            )
          )
            throw new Failure(413);
        }
      } catch (e) {
        if (e instanceof Failure) throw e;
        throw new Failure(400);
      }
      const parsed = (
        save ? saveReviewInput : vote ? voteInput : withdraw ? withdrawInput : reportReviewInput
      ).safeParse(value);
      if (!parsed.success) throw new Failure(400);
      body = JSON.stringify(parsed.data);
    }
    const forwarded = new Headers({
      'Content-Type': 'application/json',
      'X-Sayman-Client': 'storefront',
    });
    if (supplied) forwarded.set('Origin', supplied);
    if (token && !anonymous) forwarded.set('Authorization', token);
    const response = await fetcher(
      `${environment.SHOP_API_URL.replace(/\/$/, '')}/api/reviews/${path.map(encodeURIComponent).join('/')}${params.size ? '?' + params.toString() : ''}`,
      {
        method: request.method,
        headers: forwarded,
        body,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(save ? 45_000 : watch ? 35_000 : 12_000),
        ]),
      },
    );
    if (watch && response.ok) {
      if (
        !response.body ||
        response.status !== 200 ||
        !/^text\/event-stream(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')
      )
        throw new Failure(503);
      return new Response(response.body, {
        headers: { ...headers, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' },
      });
    }
    if (photo && response.ok) {
      const max = 2 * 1024 * 1024;
      if (
        response.status !== 200 ||
        response.headers.get('Content-Type') !== 'image/webp' ||
        Number(response.headers.get('Content-Length')) > max
      )
        throw new Failure(503);
      const bytes = await readBytes(response.body, max, 503);
      if (
        bytes.length < 12 ||
        String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
        String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP'
      )
        throw new Failure(503);
      return new Response(bytes.buffer, {
        headers: {
          ...headers,
          'Content-Type': 'image/webp',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      });
    }
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
    if (votes) {
      const selections = voteState.parse(value);
      if (Object.keys(selections).some((id) => !revisions?.split(',').includes(id)))
        throw new Failure(503);
      return Response.json(selections, { headers });
    }
    if (vote) return Response.json(voteResult.parse(value), { headers });
    if (withdraw) return Response.json(withdrawResult.parse(value), { headers });
    if (account) return Response.json(contributionSchemas[account].parse(value), { headers });
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

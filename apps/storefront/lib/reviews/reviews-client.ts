import { CartError, type CartFetch } from '../checkout/cart-client.ts';
import {
  ownReview,
  reviewPage,
  reviewProductId,
  reviewId,
  reviewResult,
  saveReviewInput,
  reportReviewInput,
  type SaveReviewInput,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
async function json(fetcher: CartFetch, path: string, init: RequestInit) {
  const r = await fetcher(path, init);
  if (!r.ok) {
    let code = 'reviews_unavailable';
    try {
      const p = await r.json();
      if (typeof p.title === 'string' && /^[a-z_]{1,100}$/.test(p.title)) code = p.title;
    } catch {
      /* Preserve the status-based error when the optional response body is invalid. */
    }
    throw new CartError(code, r.status);
  }
  return r.json();
}
export async function listReviews(productId: string, cursor: string | null, signal?: AbortSignal) {
  reviewProductId.parse(productId);
  const p = reviewPage.parse(
    await json(
      fetch,
      `/api/reviews/products/${encodeURIComponent(productId)}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      { cache: 'no-store', credentials: 'omit', signal },
    ),
  );
  if (p.items.some((r) => r.productId.toLowerCase() !== productId.toLowerCase()))
    throw new CartError('reviews_unavailable', 503);
  return p;
}
export async function readOwnReview(fetcher: CartFetch, productId: string, signal?: AbortSignal) {
  reviewProductId.parse(productId);
  const p = ownReview.parse(
    await json(fetcher, `/api/reviews/products/${productId}/mine`, { method: 'GET', signal }),
  );
  if (p.review && p.review.productId.toLowerCase() !== productId.toLowerCase())
    throw new CartError('reviews_unavailable', 503);
  return p.review;
}
export async function submitReview(
  fetcher: CartFetch,
  productId: string,
  commandId: string,
  input: SaveReviewInput,
  signal?: AbortSignal,
) {
  reviewProductId.parse(productId);
  reviewId.parse(commandId);
  const p = reviewResult.parse(
    await json(fetcher, `/api/reviews/products/${productId}/commands/${commandId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saveReviewInput.parse(input)),
      signal,
    }),
  );
  if (!p.review || p.reported || p.review.productId.toLowerCase() !== productId.toLowerCase())
    throw new CartError('reviews_unavailable', 503);
  return p;
}
export async function reportReview(
  fetcher: CartFetch,
  id: string,
  commandId: string,
  input: { revisionId: string; reason: 'spam' | 'abuse' | 'personal_data' | 'unrelated' },
  signal?: AbortSignal,
) {
  reviewId.parse(id);
  reviewId.parse(commandId);
  const p = reviewResult.parse(
    await json(fetcher, `/api/reviews/${id}/reports/${commandId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportReviewInput.parse(input)),
      signal,
    }),
  );
  if (!p.reported || p.review) throw new CartError('reviews_unavailable', 503);
  return p;
}

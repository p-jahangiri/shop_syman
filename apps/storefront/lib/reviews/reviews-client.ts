import { CartError, type CartFetch } from '../checkout/cart-client.ts';
import {
  ownReview,
  reviewPage,
  reviewProductId,
  reviewId,
  reviewResult,
  voteResult,
  voteState,
  voteInput,
  voteRevisions,
  withdrawInput,
  withdrawResult,
  contributionSchemas,
  type ContributionSection,
  type ContributionPage,
  type VoteValue,
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
export async function listReviews(
  productId: string,
  cursor: string | null,
  signal?: AbortSignal,
  sort: 'newest' | 'helpful' = 'newest',
) {
  reviewProductId.parse(productId);
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  if (sort === 'helpful') query.set('sort', sort);
  const p = reviewPage.parse(
    await json(
      fetch,
      `/api/reviews/products/${encodeURIComponent(productId)}${query.size ? '?' + query.toString() : ''}`,
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

export async function readVotes(
  fetcher: CartFetch,
  productId: string,
  revisions: string[],
  signal?: AbortSignal,
) {
  const id = reviewProductId.parse(productId);
  const query = new URLSearchParams({ revisions: voteRevisions.parse(revisions.join(',')) });
  return voteState.parse(
    await json(fetcher, `/api/reviews/products/${id}/vote-state?${query}`, { signal }),
  );
}

export async function voteReview(
  fetcher: CartFetch,
  id: string,
  command: string,
  revisionId: string,
  value: VoteValue,
  signal?: AbortSignal,
) {
  return voteResult.parse(
    await json(fetcher, `/api/reviews/${reviewId.parse(id)}/votes/${reviewId.parse(command)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voteInput.parse({ revisionId, value })),
      signal,
    }),
  );
}

export async function withdrawReview(
  fetcher: CartFetch,
  id: string,
  command: string,
  version: string,
  signal?: AbortSignal,
) {
  return withdrawResult.parse(
    await json(fetcher, `/api/reviews/${reviewId.parse(id)}/withdraw/${reviewId.parse(command)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withdrawInput.parse({ version })),
      signal,
    }),
  );
}

export async function listContributions<T extends ContributionSection>(
  fetcher: CartFetch,
  section: T,
  locale: 'fa' | 'en',
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ContributionPage<T>> {
  const query = new URLSearchParams({ locale });
  if (cursor) query.set('cursor', cursor);
  const schema = contributionSchemas[section];
  return schema.parse(
    await json(fetcher, `/api/reviews/account/${section}?${query}`, { signal }),
  ) as ContributionPage<T>;
}

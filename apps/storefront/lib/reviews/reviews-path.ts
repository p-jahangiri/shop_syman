import {
  contributionCursor,
  reviewCursor,
  voteRevisions,
} from '@sayman/web-shared/lib/reviews/reviews-contract.ts';

export function isCustomerReviewsPath(path: string, method: string) {
  if (method === 'GET' && path.startsWith('/api/reviews/') && path.includes('?')) {
    const url = new URL(path, 'http://localhost');
    if (url.origin !== 'http://localhost' || url.hash || url.pathname !== path.split('?')[0])
      return false;
    const params = url.searchParams;
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length) return false;
    if (/^\/api\/reviews\/products\/[A-Za-z0-9_-]{1,64}\/vote-state$/.test(url.pathname))
      return keys.length === 1 && voteRevisions.safeParse(params.get('revisions')).success;
    const section = /^\/api\/reviews\/account\/(pending|reviews|questions)$/.exec(
      url.pathname,
    )?.[1];
    if (!section || !keys.every((k) => k === 'locale' || k === 'cursor')) return false;
    const locale = params.get('locale');
    const cursor = params.get('cursor');
    return (
      (locale === 'fa' || locale === 'en') &&
      (cursor === null ||
        (section !== 'pending' &&
          (section === 'questions' ? contributionCursor : reviewCursor).safeParse(cursor).success))
    );
  }
  return (
    (method === 'GET' &&
      /^\/api\/reviews\/products\/[A-Za-z0-9_-]{1,64}(?:\/photos\/[a-f0-9]{32}\/[a-f0-9]{32}(?:\/[23])?)?\/mine$/.test(
        path,
      )) ||
    (method === 'PUT' &&
      /^\/api\/reviews\/products\/[A-Za-z0-9_-]{1,64}\/commands\/[a-f0-9]{32}$/.test(path)) ||
    (method === 'PUT' &&
      /^\/api\/reviews\/[a-f0-9]{32}\/(votes|withdraw)\/[a-f0-9]{32}$/.test(path)) ||
    (method === 'POST' && /^\/api\/reviews\/[a-f0-9]{32}\/reports\/[a-f0-9]{32}$/.test(path))
  );
}

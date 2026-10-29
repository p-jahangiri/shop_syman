import { phoneCommandId, phoneId } from './phone-discovery-contract.ts';
import { marketIdSchema } from './market-contract.ts';

// Only private interest resources belong to the authenticated session transport.
// Public discovery/search routes continue to use their anonymous boundary.
export function isPhoneInterestPath(value: string, method = 'GET') {
  if (!value.startsWith('/api/phones/interests')) return false;
  let url: URL;
  try {
    url = new URL(value, 'http://localhost');
  } catch {
    return false;
  }
  if (url.origin !== 'http://localhost' || url.hash || url.pathname !== value.split('?')[0])
    return false;
  const base = '/api/phones/interests',
    parts = url.pathname.slice(base.length).split('/').slice(1);
  if (url.pathname !== base && !url.pathname.startsWith(base + '/')) return false;
  if (url.pathname === base) {
    return (
      method === 'GET' &&
      [...url.searchParams.keys()].every((key) => key === 'cursor') &&
      url.searchParams.getAll('cursor').length <= 1 &&
      (!url.searchParams.has('cursor') || phoneId.safeParse(url.searchParams.get('cursor')).success)
    );
  }
  if (url.search) return false;
  if (method === 'GET')
    return (
      parts.length === 2 &&
      (parts[0] === 'commands'
        ? phoneCommandId.safeParse(parts[1]).success
        : marketIdSchema.safeParse(parts[0]).success && phoneId.safeParse(parts[1]).success)
    );
  return (
    method === 'PUT' &&
    parts.length === 3 &&
    marketIdSchema.safeParse(parts[0]).success &&
    parts[1] === 'commands' &&
    phoneCommandId.safeParse(parts[2]).success
  );
}

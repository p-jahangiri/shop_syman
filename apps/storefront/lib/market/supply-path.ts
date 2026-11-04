import { offerIdSchema } from '@sayman/web-shared/lib/market/offer-contract.ts';

// Match raw same-origin paths before URL resolution; no commands, mutation
// suffixes, owner filters, traversal or staff routes enter this boundary.
export function isCustomerSupplyPath(path: string, method = 'GET') {
  if (method.toUpperCase() !== 'GET') return false;
  const match = /^\/api\/sourcing\/requests\/([a-f0-9]{32})\/supply(.*)$/.exec(path);
  if (!match || !offerIdSchema.safeParse(match[1]).success) return false;
  if (
    /^(?:\?cursor=[A-Za-z0-9_-]{1,200})?$/.test(match[2]) ||
    /^\/v2(?:\?cursor=[A-Za-z0-9_-]{1,200})?$/.test(match[2])
  )
    return true;
  const v2 = /^\/v2\/([a-f0-9]{32})$/.exec(match[2]);
  if (v2) return offerIdSchema.safeParse(v2[1]).success;
  const child = /^\/([a-f0-9]{32})(.*)$/.exec(match[2]);
  return (
    !!child &&
    offerIdSchema.safeParse(child[1]).success &&
    (child[2] === '' || /^\/events(?:\?cursor=[A-Za-z0-9_-]{1,200})?$/.test(child[2]))
  );
}

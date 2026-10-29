import { offerIdSchema, offerCommandIdSchema } from './offer-contract.ts';
// Paths are matched before URL resolution, so traversal or authority text can
// never be normalized into an allowed authenticated resource.
export function isCustomerOfferPath(path: string) {
  const match = /^\/api\/sourcing\/requests\/([a-f0-9]{32})\/offers(.*)$/.exec(path);
  if (!match || !offerIdSchema.safeParse(match[1]).success) return false;
  const tail = match[2],
    paging = '(?:\\?cursor=[A-Za-z0-9_-]{1,200})?';
  if (new RegExp('^' + paging + '$').test(tail)) return true;
  const child = /^\/([a-f0-9]{32})(.*)$/.exec(tail);
  if (!child || !offerIdSchema.safeParse(child[1]).success) return false;
  if (
    child[2] === '' ||
    child[2] === '/accept' ||
    child[2] === '/decline' ||
    new RegExp('^/events' + paging + '$').test(child[2])
  )
    return true;
  const receipt = /^\/commands\/(?:accept|decline)\/([^/]+)$/.exec(child[2]);
  return !!receipt && offerCommandIdSchema.safeParse(receipt[1]).success;
}

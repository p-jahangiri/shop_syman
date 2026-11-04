import {
  offerIdSchema,
  offerCommandIdSchema,
} from '@sayman/web-shared/lib/market/offer-contract.ts';
const id = (value: string | undefined) => offerIdSchema.safeParse(value).success;
const uuid = (value: string | undefined) => offerCommandIdSchema.safeParse(value).success;
export function isCustomerCartV2Path(path: string, method = 'GET') {
  const cart = /^\/api\/cart\/(fa|en)\/v2(.*)$/.exec(path);
  if (cart) {
    if (cart[2] === '') return method === 'GET' || method === 'PUT';
    if (cart[2] === '/merge' || cart[2] === '/quote' || cart[2] === '/order-quote')
      return method === 'POST';
    const group = /^\/offers\/([a-f0-9]{32})(.*)$/.exec(cart[2]);
    if (!group || !id(group[1])) return false;
    if (group[2] === '') return method === 'DELETE';
    const receipt = /^\/commands\/remove\/([^/]+)$/.exec(group[2]);
    return method === 'GET' && !!receipt && uuid(receipt[1]);
  }
  const offer = /^\/api\/sourcing\/requests\/([a-f0-9]{32})\/offers\/([a-f0-9]{32})(.*)$/.exec(
    path,
  );
  if (!offer || !id(offer[1]) || !id(offer[2])) return false;
  if (offer[3] === '/purchase') return method === 'GET';
  if (offer[3] === '/convert') return method === 'POST';
  const receipt = /^\/commands\/convert\/([^/]+)$/.exec(offer[3]);
  return method === 'GET' && !!receipt && uuid(receipt[1]);
}

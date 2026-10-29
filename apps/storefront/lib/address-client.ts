import { CartError, type CartFetch } from './cart-client.ts';
import {
  addressBook,
  addressId,
  saveAddressInput,
  saveAddressResult,
  deleteAddressInput,
  type SaveAddressInput,
} from './address-contract.ts';
async function response(fetcher: CartFetch, path: string, init: RequestInit) {
  const value = await fetcher(path, init);
  if (!value.ok) {
    let code = 'address_unavailable';
    try {
      const problem = await value.json();
      if (typeof problem.title === 'string' && /^[a-z_]{1,100}$/.test(problem.title))
        code = problem.title;
    } catch {
      /* Preserve the status-based error when the optional response body is invalid. */
    }
    throw new CartError(code, value.status);
  }
  return value;
}
export async function readAddresses(fetcher: CartFetch, signal?: AbortSignal) {
  return addressBook.parse(
    await (await response(fetcher, '/api/addresses', { method: 'GET', signal })).json(),
  );
}
export async function saveAddress(
  fetcher: CartFetch,
  id: string,
  input: SaveAddressInput,
  signal?: AbortSignal,
) {
  addressId.parse(id);
  const value = saveAddressResult.parse(
    await (
      await response(fetcher, `/api/addresses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveAddressInput.parse(input)),
        signal,
      })
    ).json(),
  );
  if (value.address.id !== id) throw new CartError('address_unavailable', 503);
  return value;
}
export async function deleteAddress(
  fetcher: CartFetch,
  id: string,
  version: string,
  signal?: AbortSignal,
) {
  addressId.parse(id);
  const value = await response(fetcher, `/api/addresses/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deleteAddressInput.parse({ version })),
    signal,
  });
  if (value.status !== 204) throw new CartError('address_unavailable', 503);
}

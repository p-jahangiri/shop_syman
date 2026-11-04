import type { CartFetch } from '../checkout/cart-client.ts';
import {
  customerAccountProfileSchema,
  updateCustomerProfileSchema,
  changeCustomerPasswordSchema,
  type UpdateCustomerProfile,
  type ChangeCustomerPassword,
} from './customer-account-contract.ts';

export class CustomerAccountError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function bounded(response: Response) {
  if (Number(response.headers.get('Content-Length')) > 16384) {
    await response.body?.cancel();
    throw new CustomerAccountError('account_unavailable', 503);
  }
  const reader = response.body?.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new CustomerAccountError('account_unavailable', 503);
        }
        parts.push(part.value);
      }
  } finally {
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function check(response: Response) {
  const raw = await bounded(response);
  if (!response.ok) {
    let code = 'account_unavailable';
    try {
      const problem = JSON.parse(raw);
      if (typeof problem.title === 'string' && /^[a-z_]{1,100}$/.test(problem.title))
        code = problem.title;
    } catch {
      /* Status remains authoritative; no raw service response is shown. */
    }
    throw new CustomerAccountError(code, response.status);
  }
  return raw;
}

export async function readCustomerAccount(fetcher: CartFetch, owner: string, signal?: AbortSignal) {
  return profile(await fetcher('/api/account/profile', { method: 'GET', signal }), owner);
}

async function profile(response: Response, owner: string) {
  const raw = await check(response);
  if (
    response.status !== 200 ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
  )
    throw new CustomerAccountError('account_unavailable', 503);
  try {
    const value = customerAccountProfileSchema.parse(JSON.parse(raw));
    if (value.id !== owner) throw Error('Account owner changed');
    return value;
  } catch {
    throw new CustomerAccountError('account_unavailable', 503);
  }
}

export async function updateCustomerProfile(
  fetcher: CartFetch,
  owner: string,
  input: UpdateCustomerProfile,
  signal?: AbortSignal,
) {
  const parsed = updateCustomerProfileSchema.parse(input),
    value = await profile(
      await fetcher('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
        signal,
      }),
      owner,
    );
  if (value.displayName !== parsed.displayName)
    throw new CustomerAccountError('account_unavailable', 503);
  return value;
}

export async function changeCustomerPassword(
  fetcher: CartFetch,
  input: ChangeCustomerPassword,
  signal?: AbortSignal,
) {
  const response = await fetcher('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changeCustomerPasswordSchema.parse(input)),
      signal,
    }),
    raw = await check(response);
  if (response.status !== 204 || raw) throw new CustomerAccountError('account_unavailable', 503);
}

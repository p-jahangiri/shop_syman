import { CartError, type CartFetch } from './cart-client.ts';
import {
  phoneInterestInputSchema,
  phoneInterestPageSchema,
  phoneInterestResultSchema,
  phoneInterestSchema,
  phoneCommandId,
  phoneId,
  type PhoneInterest,
} from './phone-discovery-contract.ts';
import { marketIdSchema } from './market-contract.ts';
import { z } from './schema-runtime.ts';
async function call(fetcher: CartFetch, path: string, init?: RequestInit) {
  const r = await fetcher('/api/phones/interests' + path, init ?? {});
  if (!r.ok)
    throw new CartError(
      r.status === 409
        ? 'phone_conflict'
        : r.status === 401
          ? 'invalid_credentials'
          : 'phone_unavailable',
      r.status,
    );
  return r.json();
}
export async function phoneInterests(
  fetcher: CartFetch,
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  if (cursor) phoneId.parse(cursor);
  return phoneInterestPageSchema.parse(
    await call(fetcher, cursor ? '?cursor=' + cursor : '', { signal }),
  );
}
export async function phoneInterest(
  fetcher: CartFetch,
  listingId: string,
  configurationId: string,
  signal?: AbortSignal,
) {
  marketIdSchema.parse(listingId);
  phoneId.parse(configurationId);
  try {
    const value = phoneInterestSchema.parse(
      await call(fetcher, '/' + listingId + '/' + configurationId, { signal }),
    );
    if (value.listingId !== listingId || value.configuration.id !== configurationId)
      throw new CartError('phone_unavailable', 503);
    return value;
  } catch (e) {
    if (e instanceof CartError && e.status === 404) return null;
    throw e;
  }
}
// Identity owners use the session's opaque identifier, including Guid D format.
// They are not phone resource IDs and must retain exact session binding.
const sessionOwner = z.string().min(1).max(64),
  commandSchema = z
    .object({
      owner: sessionOwner,
      listingId: marketIdSchema,
      requestId: phoneCommandId,
      input: phoneInterestInputSchema,
    })
    .strict();
export type PhoneInterestCommand = z.infer<typeof commandSchema>;
const key = (owner: string) => 'sayman-phone-interest-command-v1:' + sessionOwner.parse(owner),
  memory = new Map<string, PhoneInterestCommand>();
export function pendingPhoneInterest(owner: string) {
  let value = memory.get(owner);
  try {
    const raw = sessionStorage.getItem(key(owner));
    if (raw) value = commandSchema.parse(JSON.parse(raw));
  } catch {
    /* Ignore unavailable or invalid browser storage; the owned in-memory command remains authoritative. */
  }
  return value?.owner === owner ? structuredClone(value) : null;
}
export function startPhoneInterest(command: PhoneInterestCommand) {
  const value = commandSchema.parse(command);
  if (pendingPhoneInterest(value.owner)) throw Error('phone_command_pending');
  memory.set(value.owner, structuredClone(value));
  try {
    sessionStorage.setItem(key(value.owner), JSON.stringify(value));
  } catch {
    /* Continue with in-memory state when browser storage is unavailable. */
  }
}
export function finishPhoneInterest(owner: string, id: string) {
  if (memory.get(owner)?.requestId === id) memory.delete(owner);
  try {
    const raw = sessionStorage.getItem(key(owner));
    if (raw) {
      const value = commandSchema.parse(JSON.parse(raw));
      if (value.owner === owner && value.requestId === id) sessionStorage.removeItem(key(owner));
    }
  } catch {
    /* Ignore unavailable or invalid browser storage; the owned in-memory command remains authoritative. */
  }
}
function receipt(raw: unknown, c: PhoneInterestCommand) {
  const value = phoneInterestResultSchema.parse(raw);
  if (
    value.requestId !== c.requestId ||
    value.interest.listingId !== c.listingId ||
    value.interest.configuration.id !== c.input.configurationId ||
    value.interest.state !== (c.input.active ? 'Active' : 'Cancelled')
  )
    throw new CartError('phone_unavailable', 503);
  return value;
}
export async function sendPhoneInterest(fetcher: CartFetch, command: PhoneInterestCommand) {
  const c = commandSchema.parse(command);
  return receipt(
    await call(fetcher, '/' + c.listingId + '/commands/' + c.requestId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c.input),
    }),
    c,
  );
}
export async function recoverPhoneInterest(fetcher: CartFetch, command: PhoneInterestCommand) {
  const c = commandSchema.parse(command);
  return receipt(await call(fetcher, '/commands/' + c.requestId), c);
}
export type { PhoneInterest };

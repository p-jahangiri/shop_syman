import type { CartFetch } from '../checkout/cart-client.ts';
import { listOrdersV2 } from '../orders/order-v2-client.ts';
import type { OrderPageV2 } from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import { readAddresses } from '../address/address-client.ts';
import type { AddressBook } from '../address/address-contract.ts';
import { notificationCountSchema } from '@sayman/web-shared/lib/notifications/notification-contract.ts';

export type AccountOverviewSection<T> = { status: 'ready'; data: T } | { status: 'unavailable' };

export type AccountUnread = {
  support: string;
  creditReminders: string;
  total: string;
};

export type AccountOverview = {
  orders: AccountOverviewSection<OrderPageV2>;
  addresses: AccountOverviewSection<AddressBook>;
  notifications: AccountOverviewSection<AccountUnread>;
};

export type AccountOverviewUpdate = {
  [K in keyof AccountOverview]: { kind: K } & AccountOverview[K];
}[keyof AccountOverview];

const privateFetch =
  (fetcher: CartFetch): CartFetch =>
  (path, init) =>
    fetcher(path, { ...init, cache: 'no-store' });

// This is one server page, not an all-time order count or spending total.
export function readAccountOrders(fetcher: CartFetch, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return listOrdersV2(privateFetch(fetcher), null, signal);
}

export function readAccountAddresses(fetcher: CartFetch, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return readAddresses(privateFetch(fetcher), signal);
}

async function readUnreadCount(fetcher: CartFetch, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const response = await privateFetch(fetcher)(path, { method: 'GET', signal });
  if (!response.ok || Number(response.headers.get('Content-Length')) > 1024) {
    await response.body?.cancel();
    throw Error('account_overview_unavailable');
  }
  const reader = response.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          throw Error('account_overview_unavailable');
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return notificationCountSchema.parse(
    JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)),
  ).unreadCount;
}

export async function readAccountUnread(fetcher: CartFetch, signal?: AbortSignal) {
  const [support, creditReminders] = await Promise.all([
    readUnreadCount(fetcher, '/api/notifications/unread-count', signal),
    readUnreadCount(fetcher, '/api/notifications/credit-reminders/unread-count', signal),
  ]);
  signal?.throwIfAborted();
  return {
    support,
    creditReminders,
    total: (BigInt(support) + BigInt(creditReminders)).toString(),
  } satisfies AccountUnread;
}

async function readSection<T>(
  read: () => Promise<T>,
  signal: AbortSignal | undefined,
  onDone: (value: AccountOverviewSection<T>) => void,
): Promise<AccountOverviewSection<T>> {
  signal?.throwIfAborted();
  let result: AccountOverviewSection<T>;
  try {
    result = { status: 'ready', data: await read() };
  } catch {
    result = { status: 'unavailable' };
  }
  // A cancelled or replaced account must never receive a late section update.
  signal?.throwIfAborted();
  onDone(result);
  return result;
}

// Callers bind callbacks to their current owner and request epoch. Nothing is
// cached here; each independent section can render as soon as its read finishes.
export async function loadAccountOverview(
  fetcher: CartFetch,
  signal?: AbortSignal,
  onSection?: (value: AccountOverviewUpdate) => void,
): Promise<AccountOverview> {
  const [orders, addresses, notifications] = await Promise.all([
    readSection(
      () => readAccountOrders(fetcher, signal),
      signal,
      (section) => onSection?.({ kind: 'orders', ...section }),
    ),
    readSection(
      () => readAccountAddresses(fetcher, signal),
      signal,
      (section) => onSection?.({ kind: 'addresses', ...section }),
    ),
    readSection(
      () => readAccountUnread(fetcher, signal),
      signal,
      (section) => onSection?.({ kind: 'notifications', ...section }),
    ),
  ]);
  return { orders, addresses, notifications };
}

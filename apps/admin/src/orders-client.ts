import {
  adminOrderPageV2Schema,
  adminOrderListPath,
  adminOrderDetailPath,
  adminOrderCancelPath,
  adminOrderMatches,
  type AdminOrderDetailV2,
} from './orders-contract.ts';
import { cancelOrderSchema } from '../../storefront/lib/order-contract.ts';
import { adminViewRevision } from './admin-view-authority.ts';
import { SessionChanged } from './session-access.ts';
export type AdminOrderFetch = (path: string, init?: RequestInit) => Promise<unknown>;
async function verified<T>(read: () => Promise<T>) {
  const revision = adminViewRevision();
  const value = await read();
  if (revision !== adminViewRevision()) throw new SessionChanged();
  return value;
}
export async function listAdminOrdersV2(fetcher: AdminOrderFetch, cursor: string | null) {
  return verified(async () =>
    adminOrderPageV2Schema.parse(await fetcher(adminOrderListPath(cursor))),
  );
}
export async function readAdminOrderV2(fetcher: AdminOrderFetch, ownerId: string, id: string) {
  return verified(async () =>
    adminOrderMatches(await fetcher(adminOrderDetailPath(ownerId, id)), id),
  );
}
export async function cancelAdminOrderV2(
  fetcher: AdminOrderFetch,
  ownerId: string,
  order: AdminOrderDetailV2,
) {
  const body = {
    ownerId,
    version: cancelOrderSchema.parse({ version: order.summary.version }).version,
  };
  adminOrderDetailPath(ownerId, order.summary.id);
  return verified(async () =>
    adminOrderMatches(
      await fetcher(adminOrderCancelPath(order.summary.id), {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      order.summary.id,
    ),
  );
}

import { z } from 'zod';
import {
  orderDetailV2Schema,
  orderPageV2Schema,
} from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
export { orderDetailV2Schema };
const id = z.string().regex(/^[a-f0-9]{32}$/),
  owner = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const adminOrderSummaryV2Schema = orderPageV2Schema.shape.items.element.safeExtend({
  ownerId: owner,
});
export const adminOrderPageV2Schema = orderPageV2Schema.safeExtend({
  items: z.array(adminOrderSummaryV2Schema).max(20),
});
export type AdminOrderSummaryV2 = z.infer<typeof adminOrderSummaryV2Schema>;
export type AdminOrderPageV2 = z.infer<typeof adminOrderPageV2Schema>;
export type AdminOrderDetailV2 = z.infer<typeof orderDetailV2Schema>;
export type AdminOrderState = AdminOrderSummaryV2['state'];
export type AdminOrderFilters = { state?: AdminOrderState; reference?: string };
export function adminOrderListPath(cursor: string | null, filters?: AdminOrderFilters) {
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor))
    throw new Error('صفحهٔ سفارش معتبر نیست.');
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  if (filters?.state)
    query.set('state', adminOrderSummaryV2Schema.shape.state.parse(filters.state));
  if (filters?.reference) query.set('reference', filters.reference);
  return '/admin/orders/v2' + (query.size ? '?' + query.toString() : '');
}
export function adminOrderDetailPath(ownerId: string, orderId: string) {
  return `/admin/orders/v2/${owner.parse(ownerId)}/${id.parse(orderId)}`;
}
export function adminOrderCancelPath(orderId: string) {
  return `/admin/orders/v2/${id.parse(orderId)}/cancel`;
}
export function adminOrderMatches(value: unknown, expectedId: string) {
  const order = orderDetailV2Schema.parse(value);
  if (order.summary.id !== id.parse(expectedId)) throw new Error('پاسخ سفارش معتبر نیست.');
  return order;
}

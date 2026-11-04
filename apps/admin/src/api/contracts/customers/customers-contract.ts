import { z } from 'zod';
import { staffId } from '../staff/staff-contract.ts';
import { adminOrderSummaryV2Schema } from '../orders/orders-contract.ts';
import {
  ticketSummarySchema,
  ticketMessageSchema,
} from '@sayman/web-shared/lib/support/ticket-contract.ts';
const count = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const at = z.iso.datetime({ offset: true });
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,4096}$/);
export const customerFiltersSchema = z
  .object({
    query: z
      .string()
      .trim()
      .max(120)
      .refine((value) => value.split(/\s+/).filter(Boolean).length <= 8),
    active: z.enum(['all', 'true', 'false']),
    kind: z.enum(['all', 'customer', 'staff']),
  })
  .strict();
export const emptyCustomerFilters = { query: '', active: 'all', kind: 'customer' } as const;
export type CustomerFilters = z.infer<typeof customerFiltersSchema>;
export const customerAccountSchema = z
  .object({
    id: staffId,
    userName: z.string().max(256),
    displayName: z.string().max(200),
    isActive: z.boolean(),
    isStaff: z.boolean(),
    emailVerified: z.boolean(),
    phoneVerified: z.boolean(),
    createdAt: at,
  })
  .strict();
export const customerOrdersOverviewSchema = z
  .object({
    ownerId: staffId,
    totalOrders: count,
    confirmedPurchases: count,
    awaitingPaymentOrders: count,
    demoOrders: count,
    lastOrderAt: at.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      BigInt(value.confirmedPurchases) + BigInt(value.awaitingPaymentOrders) <=
        BigInt(value.totalOrders) && BigInt(value.demoOrders) <= BigInt(value.totalOrders),
  );
export const customerSupportOverviewSchema = z
  .object({
    ownerId: staffId,
    totalTickets: count,
    openTickets: count,
    lastTicketAt: at.nullable(),
  })
  .strict()
  .refine((value) => BigInt(value.openTickets) <= BigInt(value.totalTickets));
const workspaceRow = z
  .object({
    account: customerAccountSchema,
    orders: customerOrdersOverviewSchema.nullable(),
    support: customerSupportOverviewSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.orders || value.orders.ownerId === value.account.id) &&
      (!value.support || value.support.ownerId === value.account.id),
  );
export const customerPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSize: z.literal(50),
    canReadOrders: z.boolean(),
    canReadSupport: z.boolean(),
    items: z.array(workspaceRow).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.nextCursor || value.items.length === 50) &&
      new Set(value.items.map((row) => row.account.id.toLowerCase())).size === value.items.length &&
      value.items.every(
        (row) =>
          (row.orders !== null) === value.canReadOrders &&
          (row.support !== null) === value.canReadSupport,
      ),
  );
export const customerDetailSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z
      .object({
        account: customerAccountSchema,
        email: z.string().max(256).nullable(),
        phoneNumber: z.string().max(64).nullable(),
      })
      .strict(),
    orders: customerOrdersOverviewSchema.nullable(),
    support: customerSupportOverviewSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.orders || value.orders.ownerId === value.identity.account.id) &&
      (!value.support || value.support.ownerId === value.identity.account.id),
  );
export const customerOrderPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    customerId: staffId,
    items: z.array(adminOrderSummaryV2Schema).max(20),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.nextCursor || value.items.length === 20) &&
      value.items.every((row) => row.ownerId === value.customerId) &&
      new Set(value.items.map((row) => row.id)).size === value.items.length,
  );
export const customerTicketPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    customerId: staffId,
    items: z.array(ticketSummarySchema).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.nextCursor || value.items.length === 50) &&
      new Set(value.items.map((row) => row.id)).size === value.items.length,
  );
export const customerMessagesSchema = z
  .object({
    schemaVersion: z.literal(1),
    customerId: staffId,
    ticketId: z.string().regex(/^[a-f0-9]{32}$/),
    items: z.array(ticketMessageSchema).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.nextCursor || value.items.length === 50) &&
      new Set(value.items.map((item) => item.id)).size === value.items.length &&
      value.items.every(
        (item, index) =>
          index === 0 || BigInt(value.items[index - 1].sequence) < BigInt(item.sequence),
      ),
  );
export function readCustomerContract<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new Error('اطلاعات پرونده با قرارداد معتبر تطبیق ندارد؛ دوباره دریافت کنید.');
  return result.data;
}
export function customerPath(id: string) {
  return '/admin/customers/' + encodeURIComponent(staffId.parse(id));
}
export function customerListPath(raw: CustomerFilters, page: string | null) {
  const filters = customerFiltersSchema.parse(raw);
  const query = new URLSearchParams(filters);
  if (page) query.set('cursor', cursor.parse(page));
  return '/admin/customers?' + query;
}
export function customerHistoryPath(
  id: string,
  section: 'orders' | 'tickets',
  page: string | null,
) {
  return (
    customerPath(id) +
    '/' +
    section +
    (page ? '?cursor=' + encodeURIComponent(cursor.parse(page)) : '')
  );
}
export function readCustomerPage(raw: unknown, filters: CustomerFilters) {
  const result = readCustomerContract(customerPageSchema, raw);
  if (
    result.items.some(
      ({ account }) =>
        (filters.active !== 'all' && account.isActive !== (filters.active === 'true')) ||
        (filters.kind !== 'all' && account.isStaff !== (filters.kind === 'staff')),
    )
  )
    throw new Error('فهرست مشتریان با فیلترهای انتخابی تطبیق ندارد.');
  return result;
}
export function readCustomerDetail(raw: unknown, id: string) {
  const result = readCustomerContract(customerDetailSchema, raw);
  if (result.identity.account.id !== id) throw new Error('پرونده به مشتری انتخاب‌شده تعلق ندارد.');
  return result;
}

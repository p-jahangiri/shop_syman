import { chequeReportToday } from '@sayman/web-shared/lib/credit/cheque-report-contract.ts';
import type { AdminOrderSummaryV2 } from '../../api/contracts/orders/orders-contract.ts';

const dayMs = 86_400_000;
export const orderWindow = 14;
type Page<T> = { items: readonly T[]; nextCursor: string | null };

export function shiftDashboardDay(day: string, offset: number) {
  return new Date(Date.parse(day + 'T00:00:00Z') + offset * dayMs).toISOString().slice(0, 10);
}

export async function readDashboardPages<T>(
  load: (cursor: string | null) => Promise<Page<T>>,
  key: (row: T) => string,
  signal: AbortSignal,
  olderThan?: (row: T) => boolean,
) {
  const records = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let index = 0; index < 5; index++) {
    signal.throwIfAborted();
    const page = await load(cursor);
    signal.throwIfAborted();
    for (const row of page.items) {
      if (olderThan?.(row)) return { items: [...records.values()], complete: true };
      const id = key(row);
      if (!records.has(id)) records.set(id, row);
    }
    cursor = page.nextCursor;
    if (!cursor) return { items: [...records.values()], complete: true };
    if (cursors.has(cursor) || !page.items.length) throw new Error('صفحه‌بندی گزارش معتبر نیست.');
    cursors.add(cursor);
  }
  return { items: [...records.values()], complete: false };
}

export function orderDashboardSummary(
  orders: readonly AdminOrderSummaryV2[],
  today: string,
  days: number,
) {
  const buckets = new Map(
    Array.from({ length: days }, (_, index) => [
      shiftDashboardDay(today, index + 1 - days),
      { orders: 0, ready: 0 },
    ]),
  );
  let waiting = 0;
  let ready = 0;
  let delivered = 0;
  let interrupted = 0;
  const recent: AdminOrderSummaryV2[] = [];
  const completionQueue: AdminOrderSummaryV2[] = [];
  const exceptions: AdminOrderSummaryV2[] = [];
  for (const order of orders) {
    const bucket = buckets.get(chequeReportToday(order.createdAt));
    if (!bucket) continue;
    bucket.orders++;
    if (recent.length < 5) recent.push(order);
    switch (order.state) {
      case 'AwaitingPayment':
        waiting++;
        break;
      case 'Paid':
      case 'CreditApproved':
        ready++;
        bucket.ready++;
        if (completionQueue.length < 5) completionQueue.push(order);
        break;
      case 'Fulfilled':
        delivered++;
        bucket.ready++;
        break;
      case 'Cancelled':
      case 'Expired':
        interrupted++;
        if (exceptions.length < 5) exceptions.push(order);
        break;
    }
  }
  return {
    series: [...buckets].map(([day, value]) => ({ day, ...value })),
    total: waiting + ready + delivered + interrupted,
    waiting,
    ready,
    delivered,
    interrupted,
    recent,
    completionQueue,
    exceptions,
  };
}

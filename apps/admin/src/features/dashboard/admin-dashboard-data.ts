import {
  chequeReportPath,
  chequeReportToday,
  readChequeReport,
} from '@sayman/web-shared/lib/credit/cheque-report-contract.ts';
import { readTicketPage } from '@sayman/web-shared/lib/support/ticket-contract.ts';
import { api } from '../../api/api';
import { inventoryPath, readInventoryPage } from '../../api/contracts/inventory/inventory-contract';
import { listAdminOrdersV2 } from '../../api/orders-client';

import { orderWindow, readDashboardPages, shiftDashboardDay } from './admin-dashboard-model';

const chequeWindow = 30;
const transport = (signal: AbortSignal) => (path: string) => api<unknown>(path, { signal });
const todayInTehran = () => chequeReportToday(new Date().toISOString());

export async function readDashboardOrders(signal: AbortSignal) {
  const today = todayInTehran();
  const first = shiftDashboardDay(today, 1 - orderWindow);
  const result = await readDashboardPages(
    (cursor) => listAdminOrdersV2(transport(signal), cursor),
    (row) => row.id,
    signal,
    (row) => chequeReportToday(row.createdAt) < first,
  );
  return { ...result, today };
}

export async function readDashboardStock(signal: AbortSignal) {
  const request = transport(signal);
  const filters = { query: '', active: 'true' } as const;
  const result = await readDashboardPages(
    async (cursor) => readInventoryPage(await request(inventoryPath(filters, cursor)), filters),
    (row) => row.variantId,
    signal,
  );
  return {
    complete: result.complete,
    items: result.items
      .filter((row) => row.productStatus === 'Published')
      .map(({ variantId, sku, nameFa, nameEn, available }) => ({
        variantId,
        sku,
        name: nameFa || nameEn || sku,
        available,
      }))
      .sort((left, right) => left.available - right.available),
  };
}

export async function readDashboardTickets(signal: AbortSignal) {
  const request = transport(signal);
  const fetchState = (state: 'Open' | 'WaitingCustomer') =>
    readDashboardPages(
      async (cursor) => {
        const query = new URLSearchParams({ state });
        if (cursor) query.set('cursor', cursor);
        return readTicketPage(await request('/admin/support/tickets?' + query), state, true);
      },
      (row) => row.id,
      signal,
    );
  const [open, waiting] = await Promise.all([fetchState('Open'), fetchState('WaitingCustomer')]);
  return {
    open: open.items.length,
    waiting: waiting.items.length,
    complete: open.complete && waiting.complete,
  };
}

export async function readDashboardCheques(signal: AbortSignal) {
  const request = transport(signal);
  const today = todayInTehran();
  const filter = {
    from: shiftDashboardDay(today, 1 - chequeWindow),
    through: today,
    state: 'All',
  } as const;
  let snapshot: string | undefined;
  let overdue = 0;
  let dueToday = 0;
  const result = await readDashboardPages(
    async (cursor) => {
      const page = readChequeReport(await request(chequeReportPath(filter, cursor)), filter);
      if (snapshot && snapshot !== page.registrationCutoff)
        throw new Error('نسخهٔ گزارش چک تغییر کرده است.');
      snapshot = page.registrationCutoff;
      overdue += page.pageTotals.overdueHeldCount;
      dueToday += page.pageTotals.dueTodayHeldCount;
      return page;
    },
    (row) => row.cheque.id,
    signal,
  );
  return { overdue, dueToday, complete: result.complete };
}

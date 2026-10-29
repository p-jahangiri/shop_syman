import { AdminTable } from './admin-table';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { Busy, ErrorBox } from './ui';
import { orderDetailV2Schema } from './orders-contract';
import {
  customerPath,
  customerHistoryPath,
  customerOrderPageSchema,
  customerTicketPageSchema,
  customerMessagesSchema,
  readCustomerContract,
} from './customers-contract';
import { date, money, states, CustomerPager } from './customer-ui';
export function CustomerOrders({ id, viewerId }: { id: string; viewerId: string }) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<string | null>(null);
  const page = pages.at(-1)!;
  const query = useQuery({
    queryKey: ['admin', 'customer-orders', viewerId, id, page],
    queryFn: async ({ signal }) => {
      const data = readCustomerContract(
        customerOrderPageSchema,
        await api<unknown>(customerHistoryPath(id, 'orders', page), { signal }),
      );
      if (data.customerId !== id) throw new Error('سابقهٔ سفارش متعلق به این مشتری نیست.');
      return data;
    },
    gcTime: 0,
    retry: false,
  });
  return (
    <>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.data ? (
        <>
          <div className="table-wrap" role="region" aria-label="سفارش‌های مشتری" tabIndex={0}>
            <AdminTable>
              <thead>
                <tr>
                  <th>سفارش</th>
                  <th>وضعیت</th>
                  <th>مبلغ</th>
                  <th>تاریخ</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <bdi>{order.reference}</bdi>
                    </td>
                    <td>{states[order.state] ?? order.state}</td>
                    <td data-sort-value={order.payableTotalRial}>
                      {money(order.payableTotalRial)}
                    </td>
                    <td data-sort-value={order.createdAt}>{date(order.createdAt)}</td>
                    <td>
                      <button onClick={() => setSelected(order.id)}>مشاهده</button>
                    </td>
                  </tr>
                ))}
                {!query.data.items.length && (
                  <tr>
                    <td colSpan={5}>هنوز سفارشی ثبت نشده است.</td>
                  </tr>
                )}
              </tbody>
            </AdminTable>
          </div>
          <CustomerPager
            pages={pages}
            next={query.data.nextCursor}
            busy={query.isFetching}
            onChange={setPages}
          />
        </>
      ) : (
        <button onClick={() => void query.refetch()}>دریافت دوبارهٔ سفارش‌ها</button>
      )}
      {selected && (
        <section className="customer-history-detail">
          <div className="section-heading">
            <h4>جزئیات سفارش</h4>
            <button onClick={() => setSelected(null)}>بستن جزئیات</button>
          </div>
          <CustomerOrderDetails id={id} orderId={selected} viewerId={viewerId} />
        </section>
      )}
    </>
  );
}
function CustomerOrderDetails({
  id,
  orderId,
  viewerId,
}: {
  id: string;
  orderId: string;
  viewerId: string;
}) {
  const query = useQuery({
    queryKey: ['admin', 'customer-order', viewerId, id, orderId],
    queryFn: async ({ signal }) => {
      const value = readCustomerContract(
        orderDetailV2Schema,
        await api<unknown>(customerPath(id) + '/orders/' + orderId, { signal }),
      );
      if (value.summary.id !== orderId) throw new Error('جزئیات با سفارش انتخاب‌شده تطبیق ندارد.');
      return value;
    },
    gcTime: 0,
    retry: false,
  });
  return (
    <>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.data ? (
        <>
          <p>
            <bdi>{query.data.summary.reference}</bdi> · {states[query.data.summary.state]} ·{' '}
            {money(query.data.payableTotalRial)}
          </p>
          <p>
            {query.data.contactName} · <bdi>{query.data.contactPhone}</bdi>
          </p>
          <ul className="customer-order-lines">
            {query.data.lines.map((line) => (
              <li key={line.lineId}>
                <strong>{line.name}</strong>
                <span>
                  {line.label} · {line.quantity.toLocaleString('fa-IR')} عدد ·{' '}
                  {money(line.lineTotalRial)}
                </span>
              </li>
            ))}
          </ul>
          <ol className="customer-timeline">
            {query.data.events.map((event, index) => (
              <li key={index}>
                <strong>{states[event.state] ?? event.state}</strong>
                <time dateTime={event.at}>{date(event.at)}</time>
                <span>{event.reason}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <button onClick={() => void query.refetch()}>دریافت دوبارهٔ جزئیات</button>
      )}
    </>
  );
}
export function CustomerTickets({ id, viewerId }: { id: string; viewerId: string }) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<string | null>(null);
  const page = pages.at(-1)!;
  const query = useQuery({
    queryKey: ['admin', 'customer-tickets', viewerId, id, page],
    queryFn: async ({ signal }) => {
      const data = readCustomerContract(
        customerTicketPageSchema,
        await api<unknown>(customerHistoryPath(id, 'tickets', page), { signal }),
      );
      if (data.customerId !== id) throw new Error('سابقهٔ تیکت متعلق به این مشتری نیست.');
      return data;
    },
    gcTime: 0,
    retry: false,
  });
  return (
    <>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.data ? (
        <>
          <div className="table-wrap" role="region" aria-label="تیکت‌های مشتری" tabIndex={0}>
            <AdminTable>
              <thead>
                <tr>
                  <th>موضوع</th>
                  <th>وضعیت</th>
                  <th>پیام‌ها</th>
                  <th>آخرین تغییر</th>
                  <th>گفت‌وگو</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>{ticket.subject}</td>
                    <td>{states[ticket.state]}</td>
                    <td>{ticket.messageCount.toLocaleString('fa-IR')}</td>
                    <td data-sort-value={ticket.changedAt}>{date(ticket.changedAt)}</td>
                    <td>
                      <button onClick={() => setSelected(ticket.id)}>خواندن پیام‌ها</button>
                    </td>
                  </tr>
                ))}
                {!query.data.items.length && (
                  <tr>
                    <td colSpan={5}>هنوز تیکتی ثبت نشده است.</td>
                  </tr>
                )}
              </tbody>
            </AdminTable>
          </div>
          <CustomerPager
            pages={pages}
            next={query.data.nextCursor}
            busy={query.isFetching}
            onChange={setPages}
          />
        </>
      ) : (
        <button onClick={() => void query.refetch()}>دریافت دوبارهٔ تیکت‌ها</button>
      )}
      {selected && (
        <section className="customer-history-detail">
          <div className="section-heading">
            <h4>سابقهٔ گفت‌وگو</h4>
            <button onClick={() => setSelected(null)}>بستن گفت‌وگو</button>
          </div>
          <CustomerMessages key={selected} id={id} ticketId={selected} viewerId={viewerId} />
        </section>
      )}
    </>
  );
}
function CustomerMessages({
  id,
  ticketId,
  viewerId,
}: {
  id: string;
  ticketId: string;
  viewerId: string;
}) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const page = pages.at(-1)!;
  const query = useQuery({
    queryKey: ['admin', 'customer-messages', viewerId, id, ticketId, page],
    queryFn: async ({ signal }) => {
      const value = readCustomerContract(
        customerMessagesSchema,
        await api<unknown>(
          customerPath(id) +
            '/tickets/' +
            ticketId +
            '/messages' +
            (page ? '?cursor=' + encodeURIComponent(page) : ''),
          { signal },
        ),
      );
      if (value.customerId !== id || value.ticketId !== ticketId)
        throw new Error('پیام‌ها با مشتری و تیکت انتخاب‌شده تطبیق ندارند.');
      return value;
    },
    gcTime: 0,
    retry: false,
  });
  return (
    <>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : query.data ? (
        <>
          <ol className="customer-messages">
            {query.data.items.map((message) => (
              <li key={message.id}>
                <strong>{message.author === 'support' ? 'پشتیبانی' : 'مشتری'}</strong>
                <time dateTime={message.at}>{date(message.at)}</time>
                <p dir="auto">{message.body}</p>
              </li>
            ))}
          </ol>
          <CustomerPager
            pages={pages}
            next={query.data.nextCursor}
            busy={query.isFetching}
            onChange={setPages}
          />
        </>
      ) : (
        <button onClick={() => void query.refetch()}>دریافت دوبارهٔ پیام‌ها</button>
      )}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Package, Smartphone } from 'lucide-react';
import { useCustomerSession } from '@/components/auth/auth-provider';
import { useI18n } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import { listOrdersV2, readOrderV2 } from '@/lib/orders/order-v2-client';
import type { OrderDetailV2 } from '@sayman/web-shared/lib/orders/order-v2-contract.ts';
import './shopping.css';

export function CustomerDevices({ examples }: { examples: boolean }) {
  const auth = useCustomerSession();
  const { locale } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  return (
    <section className="container shopping-hub">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{text('حساب مشتری', 'Customer account')}</span>
          <h1>{text('دستگاه‌های من', 'My devices')}</h1>
          <p>
            {text(
              'کالاهای فیزیکی تحویل‌شده، اطلاعات گارانتی ثبت‌شده هنگام خرید و مسیر پشتیبانی.',
              'Delivered physical items, warranty details recorded at purchase and support.',
            )}
          </p>
        </div>
        <Link href="/account" className="button button-outline">
          {text('حساب من', 'My account')}
        </Link>
      </div>
      {auth.status === 'member' && auth.session ? (
        <DeliveredItems key={auth.session.user.id} />
      ) : auth.status === 'restoring' ? (
        <p role="status">{text('در حال بررسی حساب…', 'Checking your account…')}</p>
      ) : (
        <Link className="button button-primary" href="/account?returnTo=/devices">
          {text('برای دیدن خریدها وارد شوید', 'Sign in to see your purchases')}
        </Link>
      )}
      {examples && (
        <section aria-labelledby="example-devices">
          <h2 id="example-devices">
            {text('دستگاه‌های نمونهٔ توسعه', 'Development sample devices')}
          </h2>
          <div className="shopping-device-list">
            <article className="card-panel">
              <Smartphone aria-hidden="true" />
              <h3>iPhone 14</h3>
              <p>{text('نمونهٔ نمایشی · مشکی، ۲۵۶ گیگابایت', 'Example only · Black, 256 GB')}</p>
            </article>
            <article className="card-panel">
              <Package aria-hidden="true" />
              <h3>Galaxy S25</h3>
              <p>
                {text('نمونهٔ نمایشی · نقره‌ای، ۱۲۸ گیگابایت', 'Example only · Silver, 128 GB')}
              </p>
            </article>
          </div>
        </section>
      )}
    </section>
  );
}

function DeliveredItems() {
  const { store, session } = useCustomerSession();
  const { locale, digits } = useI18n();
  const owner = session?.user.id;
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{ orders: OrderDetailV2[]; nextCursor: string | null }>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    const active = () => !controller.signal.aborted && store.snapshot().session?.user.id === owner;
    const signal = controller.signal;
    setBusy(true);
    setError(false);
    async function load() {
      const list = await listOrdersV2(store.fetch, cursor, signal);
      const delivered = list.items.filter((item) => item.state === 'Fulfilled');
      const orders: OrderDetailV2[] = [];
      for (let i = 0; i < delivered.length; i += 4) {
        orders.push(
          ...(await Promise.all(
            delivered.slice(i, i + 4).map((item) => readOrderV2(store.fetch, item.id, signal)),
          )),
        );
      }
      if (!active()) return;
      setResult((previous) => {
        const byId = new Map(
          (cursor ? (previous?.orders ?? []) : []).map((item) => [item.summary.id, item]),
        );
        for (const order of orders) {
          if (order.summary.state === 'Fulfilled') byId.set(order.summary.id, order);
        }
        return { orders: [...byId.values()], nextCursor: list.nextCursor };
      });
    }
    void load()
      .catch(() => {
        if (active()) setError(true);
      })
      .finally(() => {
        if (active()) setBusy(false);
      });
    return () => controller.abort();
  }, [owner, store, cursor, attempt]);
  const items = (result?.orders ?? []).flatMap((order) =>
    order.lines.filter((line) => !line.isDigital).map((line) => ({ line, order: order.summary })),
  );
  return (
    <>
      {busy && <p role="status">{text('در حال دریافت خریدها…', 'Loading purchases…')}</p>}
      {error && (
        <p role="alert">
          {text('دریافت خریدها کامل نشد.', 'Could not load all purchases.')}{' '}
          <button type="button" onClick={() => retry((x) => x + 1)}>
            {text('تلاش دوباره', 'Retry')}
          </button>
        </p>
      )}
      {!busy && !error && !items.length && (
        <p>
          {text(
            'در سفارش‌های بررسی‌شده، دستگاه تحویل‌شده‌ای پیدا نشد.',
            'No delivered devices were found in the loaded orders.',
          )}
        </p>
      )}
      <div className="shopping-device-list">
        {items.map(({ line, order }) => (
          <article className="card-panel" key={order.id + ':' + line.lineId}>
            <Smartphone aria-hidden="true" />
            <h3>{line.name}</h3>
            <p>
              {line.label} · {digits(line.quantity)} {text('عدد', 'units')}
            </p>
            <p>
              {text('گارانتی ثبت‌شده در سفارش', 'Warranty recorded on the order')} ·{' '}
              {line.warranty || text('ثبت نشده', 'Unspecified')}
            </p>
            <div className="shopping-links">
              <Link href={'/orders/' + order.id} className="button button-outline">
                {text('جزئیات سفارش', 'Order details')}
              </Link>
              <Link href="/support/tickets" className="button button-outline">
                {text('پشتیبانی', 'Get support')}
              </Link>
            </div>
          </article>
        ))}
      </div>
      {result?.nextCursor && (
        <button
          type="button"
          className="button button-outline"
          disabled={busy || error}
          onClick={() => setCursor(result.nextCursor)}
        >
          {text('بررسی خریدهای قدیمی‌تر', 'Load older purchases')}
        </button>
      )}
    </>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { Button } from '../shared/ui';
import {
  customerDigitalPath,
  readCustomerDigitalDeliveries,
  readDigitalDeliveryContent,
  type CustomerDigitalDeliveries,
  type DigitalDeliveryContent,
} from '@sayman/web-shared/lib/orders/order-digital-contract.ts';

export function CustomerDigitalDeliveriesCard({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    owner = auth.session?.user.id,
    { locale, digits } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState(''),
    [page, setPage] = useState<{
      owner: string;
      order: string;
      value: CustomerDigitalDeliveries;
    } | null>(null),
    [content, setContent] = useState<{
      owner: string;
      order: string;
      delivery: string;
      value: DigitalDeliveryContent;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [contentBusy, setContentBusy] = useState(false),
    [contentFailed, setContentFailed] = useState(false),
    [copyStatus, setCopyStatus] = useState('');
  const generation = useRef(0),
    revealGeneration = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current,
      controller = new AbortController();
    setPage(null);
    setContent(null);
    setSelected('');
    setCopyStatus('');
    setFailed(false);
    setBusy(!!owner);
    if (!owner) return;
    void (async () => {
      try {
        const response = await auth.store.fetch(customerDigitalPath(orderId), {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok || response.headers.get('X-Sayman-Fulfillment-Contract') !== 'digital-v1')
          throw Error('Digital history unavailable');
        const value = readCustomerDigitalDeliveries(await response.json(), orderId);
        if (
          ticket !== generation.current ||
          controller.signal.aborted ||
          auth.store.snapshot().session?.user.id !== owner
        )
          return;
        setPage({ owner, order: orderId, value });
      } catch {
        if (ticket === generation.current && !controller.signal.aborted) setFailed(true);
      } finally {
        if (ticket === generation.current && !controller.signal.aborted) setBusy(false);
      }
    })();
    return () => {
      advanceRequestGeneration(generation);
      controller.abort();
    };
  }, [auth.store, owner, orderId, attempt]);
  const p = page?.owner === owner && page?.order === orderId ? page.value : null;
  useEffect(() => {
    const ticket = ++revealGeneration.current,
      controller = new AbortController(),
      summary = p?.deliveries.find((d) => d.id === selected);
    setContent(null);
    setCopyStatus('');
    setContentFailed(false);
    setContentBusy(!!selected);
    if (!owner || !summary || !selected) return;
    void (async () => {
      try {
        const response = await auth.store.fetch(customerDigitalPath(orderId, selected), {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok || response.headers.get('X-Sayman-Fulfillment-Contract') !== 'digital-v1')
          throw Error('Digital content unavailable');
        const value = readDigitalDeliveryContent(await response.json(), orderId, selected, summary);
        if (
          ticket !== revealGeneration.current ||
          controller.signal.aborted ||
          auth.store.snapshot().session?.user.id !== owner
        )
          return;
        setContent({ owner, order: orderId, delivery: selected, value });
      } catch {
        if (ticket === revealGeneration.current && !controller.signal.aborted)
          setContentFailed(true);
      } finally {
        if (ticket === revealGeneration.current && !controller.signal.aborted)
          setContentBusy(false);
      }
    })();
    return () => {
      advanceRequestGeneration(revealGeneration);
      controller.abort();
    };
  }, [auth.store, owner, orderId, selected, p]);
  const d =
    content?.owner === owner && content?.order === orderId && content?.delivery === selected
      ? content.value
      : null;
  const date = (v: string) =>
    new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(v));
  function hide() {
    revealGeneration.current++;
    setSelected('');
    setContent(null);
    setCopyStatus('');
  }
  async function copy(value: string) {
    const ticket = revealGeneration.current;
    try {
      await navigator.clipboard.writeText(value);
      if (ticket === revealGeneration.current)
        setCopyStatus(text('متن انتخاب‌شده کپی شد.', 'Selected text copied.'));
    } catch {
      if (ticket === revealGeneration.current)
        setCopyStatus(
          text(
            'کپی خودکار ممکن نشد؛ متن را خودتان انتخاب و کپی کنید.',
            'Automatic copy failed. Select and copy the text manually.',
          ),
        );
    }
  }
  return (
    <section className="card-panel">
      <div className="order-action-row">
        <h2>
          <KeyRound size={20} />
          {text('دریافت کالای دیجیتال', 'Your digital deliveries')}
        </h2>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            hide();
            setAttempt((n) => n + 1);
          }}
        >
          <RefreshCw size={16} />
          {text('بررسی وضعیت تازه', 'Refresh status')}
        </Button>
      </div>
      <p>
        {text(
          'محتوای خصوصی فقط با انتخاب شما خوانده می‌شود. «قابل دریافت» زمان ثبت تحویل در حساب شماست و مشاهده‌کردن را تأیید نمی‌کند.',
          'Private content is loaded only when you choose to reveal it. “Available” records when delivery became accessible in your account, not whether you have viewed it.',
        )}
      </p>
      {busy && <p role="status">{text('در حال دریافت سابقه…', 'Loading delivery history…')}</p>}
      {failed && (
        <p role="alert" className="notice">
          {text(
            'سابقهٔ تحویل قابل تأیید نیست؛ دوباره بررسی کنید.',
            'Delivery history could not be verified. Refresh to try again.',
          )}
        </p>
      )}
      {p && !p.deliveries.length && (
        <p className="notice">
          {text(
            'هنوز محتوای دیجیتالی در این حساب قابل دریافت نشده است.',
            'No digital content is available in this account yet.',
          )}
        </p>
      )}
      {p?.deliveries.map((delivery) => (
        <div className="customer-order-item" key={delivery.id}>
          <div>
            <h3>
              {text('قابل دریافت از', 'Available since')} {date(delivery.availableAt)}
            </h3>
            <ul>
              {delivery.lines.map((l) => (
                <li key={l.lineKey}>
                  {l.name} · {l.label} · {digits(l.quantity)} {text('واحد', 'units')}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              onClick={() => (selected === delivery.id ? hide() : setSelected(delivery.id))}
              aria-expanded={selected === delivery.id}
              aria-controls={`digital-content-${delivery.id}`}
            >
              {selected === delivery.id
                ? text('پنهان‌کردن و پاک‌کردن متن', 'Hide and clear content')
                : text('نمایش محتوای خصوصی', 'Reveal private content')}
            </Button>
            {selected === delivery.id && (
              <div id={`digital-content-${delivery.id}`}>
                {contentBusy && (
                  <p role="status">
                    {text('در حال خواندن محتوای خصوصی…', 'Loading private content…')}
                  </p>
                )}
                {contentFailed && (
                  <p role="alert" className="notice">
                    {text(
                      'محتوا تأیید نشد؛ آن را ببندید و دوباره انتخاب کنید.',
                      'Content could not be verified. Hide it and choose reveal again.',
                    )}
                  </p>
                )}
                {d?.items.map((item, i) => (
                  <div key={item.id}>
                    <h4>
                      {delivery.lines.find((l) => l.lineKey === item.lineKey)?.name} ·{' '}
                      {text('واحد', 'Unit')} {digits(i + 1)}
                    </h4>
                    <pre
                      dir="auto"
                      className="preserve-lines"
                      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {item.content}
                    </pre>
                    <Button variant="outline" onClick={() => void copy(item.content)}>
                      {text('کپی همین متن', 'Copy this text')}
                    </Button>
                  </div>
                ))}
                {copyStatus && <p role="status">{copyStatus}</p>}
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

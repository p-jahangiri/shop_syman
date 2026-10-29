'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { useI18n } from './locale-provider';
import { useShop } from './shop-context';
import { useCustomerSession } from './auth-provider';
import { useSourcingCommand } from './sourcing-provider';
import { readConversionCandidate } from '@/lib/cart-v2-client';
import { conversionInput, type CartConversionCandidate } from '@/lib/cart-conversion-contract';
import { CartCommandNotice } from './cart-command-notice';
import Link from './localized-link';

export function CartConversion({ requestId, offerId }: { requestId: string; offerId: string }) {
  const auth = useCustomerSession(),
    shop = useShop(),
    journal = useSourcingCommand(),
    { locale, digits, toman } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [value, setValue] = useState<{ owner: string; data: CartConversionCandidate } | null>(null),
    [busy, setBusy] = useState(false),
    [ack, setAck] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(0);
  const [confirmed, setConfirmed] = useState<{
    owner: string;
    requestId: string;
    offerId: string;
  } | null>(null);
  const generation = useRef(0),
    mounted = useRef(true),
    read = useRef<AbortController | null>(null);
  const owner = auth.status === 'member' ? auth.session!.user.id : null,
    data = value?.owner === owner ? value.data : null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      advanceRequestGeneration(generation);
      read.current?.abort();
    };
  }, []);
  useEffect(() => {
    advanceRequestGeneration(generation);
    read.current?.abort();
    setValue(null);
    setConfirmed(null);
    setAck(false);
    setError('');
    setBusy(false);
  }, [owner, requestId, offerId, locale]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function refresh() {
    if (!owner || busy) return;
    const ticket = ++generation.current,
      controller = new AbortController();
    read.current?.abort();
    read.current = controller;
    setBusy(true);
    setAck(false);
    setError('');
    setValue(null);
    setConfirmed(null);
    try {
      const current = await readConversionCandidate(
        auth.store.fetch,
        requestId,
        offerId,
        controller.signal,
      );
      if (
        mounted.current &&
        !controller.signal.aborted &&
        ticket === generation.current &&
        auth.store.snapshot().session?.user.id === owner
      )
        setValue({ owner, data: current });
    } catch {
      if (mounted.current && !controller.signal.aborted && ticket === generation.current)
        setError(
          text(
            'شرایط افزودن به سبد دریافت نشد؛ وضعیت تازه را دوباره بررسی کنید.',
            'Conditions for adding these items could not be loaded. Refresh to try again.',
          ),
        );
    } finally {
      if (mounted.current && ticket === generation.current) setBusy(false);
    }
  }
  const current = !!data && shop.serverCart?.version === data.cartVersion,
    expired =
      !!data &&
      (Date.parse(data.purchaseUntil) <= (now || Date.now()) ||
        (!!data.allocation && Date.parse(data.allocation.expiresAt) <= (now || Date.now()))),
    locked = busy || shop.cartBusy || (!!journal.pending && !journal.pending.result);
  async function convert() {
    if (!owner || !data || !ack || !current || locked || expired || !shop.sendCartCommand) return;
    setError('');
    const ticket = generation.current;
    try {
      const body = conversionInput(data, crypto.randomUUID()),
        completed = await shop.sendCartCommand({
          kind: 'cart-convert',
          id: requestId,
          offerId,
          locale,
          body,
        });
      if (
        completed &&
        mounted.current &&
        ticket === generation.current &&
        auth.store.snapshot().status === 'member' &&
        auth.store.snapshot().session?.user.id === owner
      ) {
        setValue(null);
        setAck(false);
        setConfirmed({ owner, requestId, offerId });
      }
    } catch {
      setError(
        text(
          'شرایط یا مهلت تغییر کرده است؛ دوباره بازخوانی و بررسی کنید.',
          'The conditions or deadline changed. Refresh and review them again.',
        ),
      );
    }
  }
  if (!owner || !shop.sendCartCommand) return null;
  return (
    <section className="card-panel cart-conversion">
      <h3>{text('افزودن پیشنهاد پذیرفته‌شده به سبد', 'Add the accepted offer to your cart')}</h3>
      <p>
        {text(
          'این مرحله اقلام همین پذیرش را با قیمت ثبت‌شده وارد بخش جداگانهٔ سبد می‌کند. سفارش، پرداخت یا رزرو تازه ایجاد نمی‌شود.',
          'This adds the accepted items at their recorded prices to a separate cart section. It creates no order, payment or new stock reservation.',
        )}
      </p>
      <CartCommandNotice />
      {confirmed?.owner === owner &&
        confirmed.requestId === requestId &&
        confirmed.offerId === offerId && (
          <p className="notice" role="status">
            {text(
              'فرمان افزودن این پیشنهاد تأیید شد و سبد بازخوانی شد. اقلام جاری و مهلت‌ها را در سبد بررسی کنید.',
              'The conversion command is confirmed and the cart was refreshed. Review current entries and deadlines in your cart.',
            )}{' '}
            <Link className="text-link" href="/cart">
              {text('مشاهدهٔ سبد جاری', 'View current cart')}
            </Link>
          </p>
        )}
      <Button variant="outline" disabled={locked} onClick={() => void refresh()}>
        {busy
          ? text('در حال بررسی…', 'Checking…')
          : text('دریافت و بررسی شرایط جاری افزودن', 'Load current conditions for adding')}
      </Button>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          {data.agreement && (
            <>
              <p className="preserve-lines">
                {locale === 'fa' ? data.agreement.termsFa : data.agreement.termsEn}
              </p>
              <ul>
                {data.agreement.lines.map((line) => (
                  <li key={line.id}>
                    {locale === 'fa' ? line.sku.model.nameFa : line.sku.model.nameEn} ·{' '}
                    {locale === 'fa' ? line.sku.labelFa : line.sku.labelEn} ·{' '}
                    {digits(line.quantity)} × {toman(line.unitPriceRial)} {text('تومان', 'toman')}
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.conversion && (
            <p className="notice">
              {text(
                'تبدیل این پذیرش قبلاً ثبت شده است. رسید قبلی، حضور فعلی اقلام یا اعتبار نگه‌داری را ثابت نمی‌کند؛ سبد را بازخوانی کنید.',
                'This acceptance was converted previously. The historical result does not prove current cart entries or an active hold. Refresh your cart.',
              )}{' '}
              <button onClick={shop.retry}>{text('بازخوانی سبد', 'Refresh cart')}</button>
            </p>
          )}
          {!current && (
            <p className="notice">
              {text(
                'نسخهٔ سبد تغییر کرده است؛ ابتدا سبد و سپس همین شرایط را بازخوانی کنید.',
                'The cart version changed. Refresh the cart, then these conditions.',
              )}{' '}
              <button onClick={shop.retry}>{text('بازخوانی سبد', 'Refresh cart')}</button>
            </p>
          )}
          {(expired || data.blockers.length > 0) && (
            <p className="notice">
              {text(
                'افزودن تازه فعلاً مجاز نیست؛ اعتبار رضایت، سهم موجودی و وضعیت قبلی درخواست را پیگیری کنید.',
                'A new conversion is unavailable. Check the accepted terms, stock hold and previous request state.',
              )}
            </p>
          )}
          {data.canConvert && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={locked || !current || expired}
                  onChange={(event) => setAck(event.target.checked)}
                />
                <span>
                  {text(
                    'تمام اقلام، قیمت پذیرفته‌شده و مهلت‌ها را بررسی کردم؛ همین اقلام بدون تغییر تعداد به سبد افزوده شوند.',
                    'I reviewed all items, accepted prices and deadlines. Add these exact quantities to my cart.',
                  )}
                </span>
              </label>
              <Button
                disabled={!ack || locked || !current || expired}
                onClick={() => void convert()}
              >
                {text('افزودن کامل همین پیشنهاد به سبد', 'Add this entire offer to cart')}
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}

'use client';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import Link from '../navigation/localized-link';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n } from '../navigation/locale-provider';
import { Button } from '../shared/ui';
import { CartError } from '@/lib/checkout/cart-client';
import {
  phoneInterest,
  phoneInterests,
  pendingPhoneInterest,
  startPhoneInterest,
  finishPhoneInterest,
  sendPhoneInterest,
  recoverPhoneInterest,
  type PhoneInterest,
  type PhoneInterestCommand,
} from '@/lib/market/phone-interest-client';
export function PhoneInterestAction({
  listingId,
  configurationId,
  canNotify = true,
  onSaved,
}: {
  listingId: string;
  configurationId: string;
  canNotify?: boolean;
  onSaved?: () => void;
}) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = useCallback((fa: string, en: string) => (locale === 'fa' ? fa : en), [locale]);
  if (auth.status !== 'member')
    return (
      <Link
        className="button button-outline full"
        href={
          '/account?returnTo=' +
          encodeURIComponent('/market/' + listingId + '?configuration=' + configurationId)
        }
      >
        <Bell size={17} />
        {text('ورود برای «موجود شد خبرم کن»', 'Sign in for availability alerts')}
      </Link>
    );
  return (
    <InterestAction
      key={auth.session!.user.id + configurationId}
      owner={auth.session!.user.id}
      listingId={listingId}
      configurationId={configurationId}
      canNotify={canNotify}
      onSaved={onSaved}
    />
  );
}
function InterestAction({
  owner,
  listingId,
  configurationId,
  canNotify,
  onSaved,
}: {
  owner: string;
  listingId: string;
  configurationId: string;
  canNotify: boolean;
  onSaved?: () => void;
}) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = useCallback((fa: string, en: string) => (locale === 'fa' ? fa : en), [locale]);
  const [current, setCurrent] = useState<PhoneInterest | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<PhoneInterestCommand | null>(null),
    [receiptMissing, setReceiptMissing] = useState(false),
    [refresh, setRefresh] = useState(0),
    alive = useRef(true),
    sending = useRef(false);
  const sameOwner = useCallback(
    () =>
      alive.current &&
      auth.store.snapshot().status === 'member' &&
      auth.store.snapshot().session?.user.id === owner,
    [auth.store, owner],
  );
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    setPending(pendingPhoneInterest(owner));
    setReady(false);
    void phoneInterest(auth.store.fetch, listingId, configurationId, abort.signal)
      .then((v) => {
        if (sameOwner() && !abort.signal.aborted) {
          setCurrent(v);
          setReady(true);
        }
      })
      .catch(() => {
        if (sameOwner() && !abort.signal.aborted)
          setMessage(
            text(
              'وضعیت پیگیری دریافت نشد؛ تازه‌سازی کنید.',
              'Could not load alert state. Refresh to retry.',
            ),
          );
      });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [owner, listingId, configurationId, refresh, auth.store, sameOwner, text]);
  async function change(recover = false, resend = false) {
    if (sending.current || !sameOwner()) return;
    const frozen = pendingPhoneInterest(owner);
    if (frozen && !recover) {
      setPending(frozen);
      setMessage(
        text('ابتدا نتیجهٔ فرمان قبلی را پیگیری کنید.', 'Check the previous command result first.'),
      );
      return;
    }
    if (!frozen && !ready) return;
    let command = frozen;
    if (!command) {
      command = {
        owner,
        listingId,
        requestId: crypto.randomUUID(),
        input: {
          configurationId,
          active: current?.state !== 'Active',
          version: current?.version ?? null,
        },
      };
      try {
        startPhoneInterest(command);
      } catch {
        return;
      }
    }
    sending.current = true;
    setBusy(true);
    setMessage('');
    const original = command;
    try {
      if (recover && !resend) await recoverPhoneInterest(auth.store.fetch, original);
      else await sendPhoneInterest(auth.store.fetch, original);
      finishPhoneInterest(owner, original.requestId);
      if (sameOwner()) {
        setPending(null);
        setReceiptMissing(false);
        setRefresh((n) => n + 1);
        setMessage(text('وضعیت پیگیری ذخیره شد.', 'Alert preference saved.'));
        onSaved?.();
      }
    } catch (error) {
      if (!sameOwner()) return;
      const status = error instanceof CartError ? error.status : 0;
      if (recover && status === 404) {
        setReceiptMissing(true);
        setMessage(
          text(
            'رسید هنوز ثبت نشده است؛ می‌توانید فقط همین فرمان را دوباره ارسال کنید.',
            'No receipt is available yet. You may resend this same command.',
          ),
        );
      } else if (!frozen && [400, 404, 409, 413, 415].includes(status)) {
        finishPhoneInterest(owner, original.requestId);
        setPending(null);
        setRefresh((n) => n + 1);
        setMessage(
          text(
            'اطلاعات انتخاب تغییر کرده است؛ وضعیت را دوباره بررسی کنید.',
            'The selection changed. Review its refreshed state.',
          ),
        );
      } else {
        setPending(original);
        setMessage(
          text(
            'نتیجه مشخص نیست؛ با شناسهٔ همین فرمان پیگیری کنید.',
            'The result is uncertain. Check this command’s receipt.',
          ),
        );
      }
    } finally {
      sending.current = false;
      if (sameOwner()) setBusy(false);
    }
  }
  const active = current?.state === 'Active';
  return (
    <div className="phone-interest-action">
      {pending ? (
        <div className="notice">
          <p>
            {text(
              'یک فرمان پیگیری هنوز نتیجهٔ قطعی ندارد.',
              'An alert command is awaiting confirmation.',
            )}
          </p>
          <code dir="ltr">{pending.requestId}</code>
          <Button variant="outline" disabled={busy} onClick={() => void change(true)}>
            {text('پیگیری نتیجه', 'Check result')}
          </Button>
          {receiptMissing && (
            <Button variant="outline" disabled={busy} onClick={() => void change(true, true)}>
              {text('ارسال دوبارهٔ همین فرمان', 'Resend same command')}
            </Button>
          )}
        </div>
      ) : (
        <Button
          className="full"
          variant="outline"
          disabled={!ready || busy || (!active && !canNotify)}
          onClick={() => void change()}
        >
          {active ? <BellOff size={17} /> : <Bell size={17} />}{' '}
          {busy
            ? text('در حال ذخیره…', 'Saving…')
            : active
              ? text('لغو خبر شدن از موجودی', 'Cancel availability alert')
              : text('موجود شد خبرم کن', 'Notify me when available')}
        </Button>
      )}
      {!ready && !busy && (
        <button className="text-link" onClick={() => setRefresh((n) => n + 1)}>
          {text('بازخوانی وضعیت', 'Refresh state')}
        </button>
      )}
      {message && (
        <p className="small-note" role="status">
          {message}
        </p>
      )}
      <small>
        {text(
          'اعلان داخل حساب، برای همین رنگ و حافظه؛ بدون رزرو کالا.',
          'An in-account alert for this colour and memory. It does not reserve stock.',
        )}
      </small>
    </div>
  );
}
export function CustomerPhoneInterests() {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = useCallback((fa: string, en: string) => (locale === 'fa' ? fa : en), [locale]);
  return (
    <main className="container phone-interest-page">
      <Link href="/account">{text('حساب کاربری', 'My account')}</Link>
      <h1>{text('گوشی‌های در انتظار موجودی', 'Phones I am waiting for')}</h1>
      {auth.status === 'member' ? (
        <InterestList key={auth.session!.user.id} owner={auth.session!.user.id} />
      ) : (
        <Link href="/account?returnTo=/phone-interests">{text('ورود به حساب', 'Sign in')}</Link>
      )}
    </main>
  );
}
function InterestList({ owner }: { owner: string }) {
  const auth = useCustomerSession(),
    { locale, digits } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    [items, setItems] = useState<PhoneInterest[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current,
      abort = new AbortController();
    setBusy(true);
    setError(false);
    void phoneInterests(auth.store.fetch, null, abort.signal)
      .then((page) => {
        if (ticket === generation.current && !abort.signal.aborted) {
          setItems(page.items);
          setCursor(page.nextCursor);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => {
      advanceRequestGeneration(generation);
      abort.abort();
    };
  }, [owner, attempt, auth.store]);
  async function more() {
    if (!cursor || busy) return;
    const ticket = generation.current;
    setBusy(true);
    try {
      const page = await phoneInterests(auth.store.fetch, cursor);
      if (ticket === generation.current) {
        setItems((old) => [...old, ...page.items.filter((v) => !old.some((i) => i.id === v.id))]);
        setCursor(page.nextCursor);
      }
    } catch {
      if (ticket === generation.current) setError(true);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <p>
        {text(
          'انتخاب‌های شما برای اطلاع از موجودی واقعی فروشگاه. پیشنهاد قیمت درخواست‌های تأمین در بخش درخواست‌ها قرار می‌گیرد.',
          'Your selections for real store availability. Supply quotes are listed under your supply requests.',
        )}
      </p>
      <div className="order-action-row">
        <Link href="/market">{text('کشف گوشی‌ها', 'Explore phones')}</Link>
        <Link href="/sourcing">
          {text('درخواست‌ها و پیشنهادهای قیمت', 'My requests and quotes')}
        </Link>
        <Link href="/notifications">{text('اعلان‌های حساب', 'Account notifications')}</Link>
        <button onClick={() => setAttempt((n) => n + 1)} disabled={busy}>
          {text('تازه‌سازی', 'Refresh')}
        </button>
      </div>
      {error && (
        <p role="alert">
          {text('فهرست دریافت نشد؛ دوباره تلاش کنید.', 'Could not load your list. Retry.')}
        </p>
      )}
      {busy && !items.length && <p role="status">{text('در حال دریافت…', 'Loading…')}</p>}
      {!busy && !items.length && (
        <p>
          {text(
            'هنوز گوشی‌ای برای خبر شدن انتخاب نکرده‌اید.',
            'You have not selected any availability alerts.',
          )}
        </p>
      )}
      {items.map((i) => (
        <article className="card-panel phone-interest-row" key={i.id}>
          <Link href={'/market/' + i.listingId + '?configuration=' + i.configuration.id}>
            <b>{locale === 'fa' ? i.modelNameFa : i.modelNameEn}</b>
            <br />
            {locale === 'fa' ? i.configuration.colorNameFa : i.configuration.colorNameEn} ·{' '}
            {text('رم', 'RAM')} {digits(i.configuration.ramGb)} GB ·{' '}
            {digits(i.configuration.storageGb)} GB
          </Link>
          <p>
            {i.state === 'Active'
              ? text('در انتظار موجودی', 'Waiting for stock')
              : i.state === 'Notified'
                ? text('اعلان موجودی ثبت شده', 'Availability notification recorded')
                : text('پیگیری لغو شده', 'Alert cancelled')}
          </p>
          <PhoneInterestAction
            listingId={i.listingId}
            configurationId={i.configuration.id}
            onSaved={() => setAttempt((n) => n + 1)}
          />
        </article>
      ))}
      {cursor && (
        <Button variant="outline" disabled={busy} onClick={() => void more()}>
          {text('نمایش بیشتر', 'Load more')}
        </Button>
      )}
    </>
  );
}

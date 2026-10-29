'use client';
import { useEffect, useState } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import Link from './localized-link';
import { Button } from './ui';
import { readAddresses } from '@/lib/address-client';
import type { CartFetch } from '@/lib/cart-client';
import type { AddressBook, SavedAddress } from '@/lib/address-contract';
export function SavedAddressPicker({
  disabled,
  onUse,
}: {
  disabled: boolean;
  onUse: (address: SavedAddress) => void;
}) {
  const auth = useCustomerSession();
  const { locale } = useI18n();
  if (auth.status !== 'member' || !auth.session) return null;
  return (
    <AddressPickerPanel
      key={auth.session.user.id}
      locale={locale}
      fetcher={auth.store.fetch}
      disabled={disabled}
      onUse={onUse}
    />
  );
}
export function AddressPickerPanel({
  locale,
  fetcher,
  disabled,
  onUse,
}: {
  locale: 'fa' | 'en';
  fetcher: CartFetch;
  disabled: boolean;
  onUse: (address: SavedAddress) => void;
}) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [book, setBook] = useState<AddressBook | null>(null),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setBook(null);
    setSelected('');
    setError(false);
    const abort = new AbortController();
    void readAddresses(fetcher, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setBook(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [fetcher, attempt]);
  return (
    <div className="saved-address-picker">
      <h3>{text('استفاده از نشانی ذخیره‌شده', 'Use a saved address')}</h3>
      {error ? (
        <>
          <p role="status">
            {text(
              'نشانی‌ها دریافت نشدند؛ می‌توانید نشانی را دستی وارد کنید.',
              'Saved addresses could not be loaded. You can enter an address manually.',
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => setAttempt((v) => v + 1)}
          >
            {text('تلاش دوباره', 'Retry')}
          </Button>
        </>
      ) : !book ? (
        <p role="status">{text('در حال دریافت نشانی‌ها…', 'Loading addresses…')}</p>
      ) : book.items.length ? (
        <>
          <label className="sr-only" htmlFor="saved-delivery">
            {text('انتخاب نشانی', 'Select an address')}
          </label>
          <select
            id="saved-delivery"
            value={selected}
            disabled={disabled}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">{text('یک نشانی را انتخاب کنید', 'Choose an address')}</option>
            {book.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.delivery.city}
                {a.isDefault ? text(' (پیش‌فرض)', ' (default)') : ''}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !selected}
            onClick={() => {
              const a = book.items.find((v) => v.id === selected);
              if (a && !disabled) onUse(a);
            }}
          >
            {text('کپی در فرم سفارش', 'Copy into order form')}
          </Button>
          <p className="small-note">
            {text(
              'انتخاب و کپی، فیلدهای گیرنده و تحویل را جایگزین می‌کند؛ قبل از ثبت بررسی کنید.',
              'Copy replaces the recipient and delivery fields. Review them before creating the order.',
            )}
          </p>
        </>
      ) : (
        <p>
          {text(
            'نشانی ذخیره‌شده ندارید؛ فرم را دستی کامل کنید.',
            'You have no saved addresses. Complete the form manually.',
          )}
        </p>
      )}
      <Link href="/addresses" className="text-link">
        {text('مدیریت نشانی‌ها', 'Manage addresses')}
      </Link>
    </div>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Plus, RefreshCw, Pencil, Trash2, UserRound, Phone, Check } from 'lucide-react';
import { useCustomerSession } from '../auth/auth-provider';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import { Button } from '../shared/ui';
import { AddressEditor } from './address-editor';
import { findCounty } from '@/lib/address/address-geography';
import { CartError, type CartFetch } from '@/lib/checkout/cart-client';
import { readAddresses, saveAddress, deleteAddress } from '@/lib/address/address-client';
import {
  type AddressBook,
  type SavedAddress,
  type SaveAddressInput,
} from '@/lib/address/address-contract';

export function CustomerAddresses() {
  const auth = useCustomerSession();
  const { locale } = useI18n();
  const source = useStorefront().dataSource;
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  if (source !== 'api')
    return (
      <div className="container page-empty empty-state">
        <MapPin />
        <h1>{text('نشانی‌های من', 'My addresses')}</h1>
        <p>
          {text(
            'مدیریت نشانی به حساب و سرویس فروش متصل نیاز دارد.',
            'Address management requires a connected account and sales service.',
          )}
        </p>
      </div>
    );
  if (auth.status !== 'member' || !auth.session)
    return (
      <div className="container page-empty empty-state">
        <MapPin />
        <h1>{text('نشانی‌های من', 'My addresses')}</h1>
        <p role="status">
          {auth.status === 'restoring'
            ? text('در حال بررسی نشست…', 'Checking your session…')
            : text(
                'برای دیدن نشانی‌های خود وارد حساب شوید.',
                'Sign in to view your saved addresses.',
              )}
        </p>
        {auth.status !== 'restoring' && (
          <Link href="/account?returnTo=/addresses" className="text-link">
            {text('ورود و ادامه', 'Sign in and continue')}
          </Link>
        )}
      </div>
    );
  return (
    <AddressBookPanel
      key={`${locale}:${auth.session.user.id}`}
      locale={locale}
      fetcher={auth.store.fetch}
    />
  );
}
type Operation =
  | { kind: 'save'; id: string; input: SaveAddressInput }
  | { kind: 'delete'; id: string; version: string };
export function AddressBookPanel({ locale, fetcher }: { locale: 'fa' | 'en'; fetcher: CartFetch }) {
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const digits = (v: number) =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(v);
  const [book, setBook] = useState<AddressBook | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [editor, setEditor] = useState<SavedAddress | 'new' | null>(null),
    [confirm, setConfirm] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [uncertain, setUncertain] = useState(false);
  const controller = useRef<AbortController | null>(null),
    mounted = useRef(true),
    pending = useRef<Operation | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setBook(null);
    setEditor(null);
    setConfirm(null);
    pending.current = null;
    setUncertain(false);
    setRevision((v) => v + 1);
    try {
      const result = await readAddresses(fetcher, abort.signal);
      if (!abort.signal.aborted && mounted.current) setBook(result);
    } catch {
      if (!abort.signal.aborted && mounted.current) setError('read');
    } finally {
      if (!abort.signal.aborted && mounted.current) setBusy(false);
    }
  }, [fetcher]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      controller.current?.abort();
      pending.current = null;
    };
  }, [load]); // Each account mounts a new panel.

  async function run(operation: Operation) {
    if (busy) return;
    pending.current = operation;
    setBusy(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (operation.kind === 'save')
        await saveAddress(fetcher, operation.id, operation.input, abort.signal);
      else
        try {
          await deleteAddress(fetcher, operation.id, operation.version, abort.signal);
        } catch (e) {
          if (!(e instanceof CartError && e.status === 404)) throw e;
        }
      if (mounted.current && !abort.signal.aborted) {
        pending.current = null;
        setUncertain(false);
        await load();
      }
    } catch (e) {
      if (!mounted.current || abort.signal.aborted) return;
      const status = e instanceof CartError ? e.status : 0;
      if (status >= 400 && status < 500) {
        pending.current = null;
        setUncertain(false);
        setError(
          status === 409
            ? 'conflict'
            : status === 404
              ? 'missing'
              : status === 429
                ? 'limited'
                : status === 401 || status === 403
                  ? 'signin'
                  : e instanceof CartError && e.code === 'address_limit'
                    ? 'limit'
                    : 'invalid',
        );
      } else {
        setUncertain(true);
        setError('uncertain');
      }
    } finally {
      if (mounted.current && !abort.signal.aborted) setBusy(false);
    }
  }
  const stale = ['conflict', 'missing', 'signin', 'read'].includes(error);
  const message =
    error === 'uncertain'
      ? text(
          'نتیجهٔ تغییر دریافت نشد. تلاش دوباره همان درخواست را می‌فرستد. دریافت فهرست تازه، فرم و درخواست حافظه‌ای را کنار می‌گذارد؛ نتیجه را در فهرست بررسی کنید.',
          'The change result was not received. Retry sends the same request. Loading the current list discards this form and in-memory request; check the result in the list.',
        )
      : error === 'conflict'
        ? text(
            'این نشانی تغییر کرده است. فهرست تازه را بگیرید و سپس ویرایش کنید.',
            'This address changed. Load the current list before editing.',
          )
        : error === 'missing'
          ? text(
              'این نشانی دیگر در حساب شما نیست. فهرست را تازه کنید.',
              'This address is no longer in your account. Reload the list.',
            )
          : error === 'limit'
            ? text(
                'دفتر نشانی پر است؛ یک نشانی را ویرایش یا حذف کنید.',
                'The address book is full. Edit or remove an existing address.',
              )
            : error === 'limited'
              ? text(
                  'درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.',
                  'Too many requests. Try again shortly.',
                )
              : error === 'signin'
                ? text(
                    'برای ادامه، نشست حساب را دوباره بررسی کنید.',
                    'Check your account session again before continuing.',
                  )
                : error === 'invalid'
                  ? text(
                      'اطلاعات معتبر نیست؛ فیلدها را بررسی کنید.',
                      'The details are invalid. Check the fields.',
                    )
                  : text(
                      'نشانی‌ها دریافت نشدند. برای ادامه دوباره تلاش کنید.',
                      'Addresses could not be loaded. Retry before continuing.',
                    );
  return (
    <div className="container address-page">
      <div className="page-top address-page-heading">
        <div>
          <span className="eyebrow">{text('حساب کاربری', 'Account')}</span>
          <h1>{text('نشانی‌های من', 'My addresses')}</h1>
          <p>
            {text(
              'تحویل راحت‌تر، از یک نشانی دقیق شروع می‌شود.',
              'An easier delivery starts with a clear address.',
            )}
          </p>
        </div>
        <Link href="/account" className="text-link">
          {text('بازگشت به حساب', 'Back to account')}
        </Link>
      </div>
      <p className="small-note address-privacy-note">
        {text(
          'شمارهٔ گیرنده برای تحویل است و شمارهٔ ورود شما را تأیید یا تغییر نمی‌دهد. تغییر نشانی، سفارش‌های ثبت‌شده را عوض نمی‌کند.',
          'The recipient phone is for delivery and does not verify or change your sign-in number. Editing an address does not change existing orders.',
        )}
      </p>
      {error && (
        <div className="notice address-alert" role="alert">
          <p>{message}</p>
          <div className="order-action-row">
            {uncertain && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (pending.current) void run(pending.current);
                }}
              >
                {text('تلاش دوباره با همان درخواست', 'Retry the same request')}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={16} />
              {text('دریافت فهرست تازه', 'Load current list')}
            </Button>
          </div>
        </div>
      )}
      {busy && !book && (
        <p role="status">{text('در حال دریافت نشانی‌ها…', 'Loading addresses…')}</p>
      )}
      {book && (
        <>
          <div className="address-toolbar">
            <p>
              {digits(book.items.length)} / {digits(book.capacity)} {text('نشانی', 'addresses')}
            </p>
            <Button
              type="button"
              disabled={busy || uncertain || stale || book.items.length >= book.capacity}
              onClick={() => {
                setEditor('new');
                setConfirm(null);
                setError('');
                setRevision((v) => v + 1);
              }}
            >
              <Plus size={16} />
              {text('افزودن نشانی', 'Add address')}
            </Button>
          </div>
          <div className={`address-layout${editor ? ' is-editing' : ''}`}>
            <section
              className="address-list"
              aria-label={text('نشانی‌های ذخیره‌شده', 'Saved addresses')}
            >
              {book.items.length === 0 ? (
                <div className="address-empty empty-state">
                  <MapPin />
                  <h2>{text('هنوز نشانی ذخیره نکرده‌اید', 'No saved addresses yet')}</h2>
                  <p>
                    {text(
                      'می‌توانید هنگام خرید هم نشانی را دستی وارد کنید.',
                      'You can also enter a delivery address manually at checkout.',
                    )}
                  </p>
                </div>
              ) : (
                book.items.map((a) => (
                  <article className={`address-card${a.isDefault ? ' is-default' : ''}`} key={a.id}>
                    <div className="address-card-heading">
                      <div className="address-card-title">
                        <span className="address-card-icon">
                          <MapPin size={21} />
                        </span>
                        <h2>{a.label}</h2>
                      </div>
                      {a.isDefault && (
                        <span className="address-default-badge">
                          <Check size={13} />
                          {text('پیش‌فرض', 'Default')}
                        </span>
                      )}
                    </div>
                    <p className="address-card-region">
                      {a.delivery.province}، {a.details ? findCounty(a.details.countyId)?.name : ''}
                      {a.details ? '، ' : ''}
                      {a.delivery.city}
                    </p>
                    <p className="preserve-lines address-card-street">{a.delivery.address}</p>
                    {a.details && (
                      <p className="address-building">
                        {text('پلاک', 'Plaque')} {a.details.plaque}
                        {a.details.unit && ` · ${text('واحد', 'Unit')} ${a.details.unit}`}
                      </p>
                    )}
                    <p className="address-card-postal">
                      {text('کد پستی', 'Postal code')}: <bdi>{a.delivery.postalCode}</bdi>
                      {a.details?.latitude != null && (
                        <span>
                          <MapPin size={13} />
                          {text('نقطهٔ نقشه ثبت شده', 'Map point saved')}
                        </span>
                      )}
                    </p>
                    <div className="address-card-contact">
                      <span>
                        <UserRound size={15} />
                        {a.contactName}
                      </span>
                      <span>
                        <Phone size={15} />
                        <bdi>{a.contactPhone}</bdi>
                      </span>
                    </div>
                    <div className="order-action-row">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || uncertain || stale}
                        onClick={() => {
                          setEditor(a);
                          setConfirm(null);
                          setError('');
                          setRevision((v) => v + 1);
                        }}
                      >
                        <Pencil size={15} />
                        {text('ویرایش', 'Edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy || uncertain || stale}
                        onClick={() => {
                          setConfirm(a.id);
                          setEditor(null);
                          setError('');
                        }}
                      >
                        <Trash2 size={15} />
                        {text('حذف', 'Remove')}
                      </Button>
                    </div>
                    {confirm === a.id && (
                      <div className="notice">
                        <p>
                          {text(
                            'نشانی حذف شود؟ سفارش‌های قبلی تغییر نمی‌کنند.',
                            'Remove this address? Existing orders stay as recorded.',
                          )}
                        </p>
                        <div className="order-action-row">
                          <Button
                            type="button"
                            disabled={busy || uncertain || stale}
                            onClick={() =>
                              void run({ kind: 'delete', id: a.id, version: a.version })
                            }
                          >
                            {text('تأیید حذف', 'Confirm removal')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy || uncertain}
                            onClick={() => setConfirm(null)}
                          >
                            {text('انصراف', 'Cancel')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </article>
                ))
              )}
            </section>
            {editor && (
              <AddressEditor
                key={`${typeof editor === 'string' ? 'new' : editor.id}:${revision}`}
                locale={locale}
                value={editor === 'new' ? null : editor}
                disabled={busy || uncertain || stale}
                onCancel={() => {
                  setEditor(null);
                  setError('');
                }}
                onSave={(input) =>
                  void run({
                    kind: 'save',
                    id:
                      typeof editor === 'string'
                        ? crypto.randomUUID().replaceAll('-', '')
                        : editor.id,
                    input,
                  })
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

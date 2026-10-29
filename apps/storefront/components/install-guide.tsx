'use client';
import { useState } from 'react';
import { Download, WifiOff, ShieldCheck, RefreshCw, Trash2, Check, Smartphone } from 'lucide-react';
import Link from './localized-link';
import { useI18n, useStorefront } from './locale-provider';
import { usePwa } from './pwa-provider';
import { Button } from './ui';
export function InstallGuide() {
  const { locale } = useI18n();
  const { site } = useStorefront();
  const pwa = usePwa();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const status = {
    checking: text('در حال آماده‌سازی…', 'Getting ready…'),
    ready: text('مرور آفلاین آماده است', 'Offline browsing is ready'),
    unsupported: text(
      'مرور آفلاین در این مرورگر در دسترس نیست',
      'Offline browsing is unavailable in this browser',
    ),
    unavailable: text(
      'آماده‌سازی انجام نشد؛ صفحه را دوباره باز کنید',
      'Setup did not complete. Please reload the page.',
    ),
    disabled: text('مرور آفلاین فعال نیست', 'Offline browsing is disabled'),
  };
  async function clear() {
    setBusy(true);
    setMessage('');
    try {
      await pwa.clearCatalog();
      setMessage(
        text('فهرست ذخیره‌شدهٔ کالاها پاک شد.', 'The saved product list has been cleared.'),
      );
    } catch {
      setMessage(
        text(
          'پاک‌کردن فهرست انجام نشد؛ دوباره تلاش کنید.',
          'The saved list could not be cleared. Please try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container install-page">
      <div className="page-top">
        <span className="eyebrow">{site.latinName}</span>
        <h1>{text(`همراهِ ${site.name}، روی دستگاه شما`, `${site.name}, on your device`)}</h1>
        <p>
          {text(
            'دسترسی مستقیم از صفحهٔ اصلی دستگاه و مرور سبک کالاها در زمان قطع اتصال.',
            'Open the store from your home screen and browse a lightweight catalogue when the connection is unavailable.',
          )}
        </p>
      </div>
      <div className="install-grid">
        <section className="card-panel install-card">
          <div className="install-symbol">
            <Smartphone size={30} />
          </div>
          <h2>
            {pwa.installed
              ? text('برنامه روی دستگاه شماست', 'The app is on your device')
              : text('افزودن به صفحهٔ اصلی', 'Add to your home screen')}
          </h2>
          <p>
            {pwa.installed
              ? text(
                  'می‌توانید فروشگاه را از آیکن دستگاه باز کنید.',
                  'You can open the store using its home screen icon.',
                )
              : pwa.ios
                ? text(
                    'در Safari، دکمهٔ اشتراک‌گذاری را بزنید و «Add to Home Screen» را انتخاب کنید.',
                    'In Safari, tap Share, then choose Add to Home Screen.',
                  )
                : text(
                    'از گزینهٔ نصب برنامه یا افزودن به صفحهٔ اصلی در منوی مرورگر استفاده کنید.',
                    'Use Install app or Add to Home Screen in your browser menu.',
                  )}
          </p>
          {pwa.canInstall && !pwa.installed && (
            <Button onClick={() => void pwa.install()}>
              <Download size={17} />
              {text('نصب فروشگاه', 'Install the store')}
            </Button>
          )}
          <div className={`pwa-status ${pwa.phase === 'ready' ? 'is-ready' : ''}`} role="status">
            {pwa.phase === 'ready' ? <Check size={17} /> : <WifiOff size={17} />}
            <span>{status[pwa.phase]}</span>
          </div>
          {pwa.updateAvailable && (
            <div className="notice">
              <p>
                {text(
                  'نسخهٔ تازه‌ای آماده است. به‌روزرسانی این صفحه را دوباره باز می‌کند.',
                  'An update is ready. Updating will reload this page.',
                )}
              </p>
              <Button variant="outline" onClick={pwa.update}>
                <RefreshCw size={16} />
                {text('به‌روزرسانی برنامه', 'Update app')}
              </Button>
              {pwa.updateBlocked && (
                <p role="status">
                  {text(
                    'به‌روزرسانی فعلاً انجام نشد. بخش‌های حساب و خرید را ببندید و دوباره تلاش کنید.',
                    'The update could not run yet. Close account and purchasing pages, then try again.',
                  )}
                </p>
              )}
            </div>
          )}
        </section>
        <section className="card-panel install-card">
          <div className="install-symbol">
            <ShieldCheck size={30} />
          </div>
          <h2>{text('اطلاعاتی که همراه شما می‌ماند', 'What stays available')}</h2>
          <p>
            {text(
              'نام، تصویرهای محلی و توضیح عمومی کالاها در نسخهٔ سبک قابل مرور است. برای دیدن قیمت و موجودی روز، ورود به حساب و خرید به اتصال اینترنت نیاز دارید.',
              'The lightweight view includes product names, local illustrations and public descriptions. Current prices, stock, sign-in and purchasing require an internet connection.',
            )}
          </p>
          <p className="small-note">
            {text(
              'اطلاعات حساب، نشانی، سبد و پرداخت در کش آفلاین ذخیره نمی‌شوند. فهرست عمومی پس از هفت روز بدون تازه‌سازی منقضی می‌شود.',
              'Account, address, bag and payment responses are never stored in offline cache. The public list expires after seven days without a refresh.',
            )}
          </p>
          <a className="button button-outline" href={`/pwa/offline-${locale}.html`}>
            <WifiOff size={16} />
            {text('مشاهدهٔ نسخهٔ سبک', 'Open the lightweight view')}
          </a>
          <button
            className="text-button install-clear"
            disabled={busy || pwa.phase !== 'ready'}
            onClick={() => void clear()}
          >
            <Trash2 size={14} />
            {busy
              ? text('در حال پاک‌کردن…', 'Clearing…')
              : text('پاک‌کردن فهرست آفلاین', 'Clear the saved list')}
          </button>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
        </section>
      </div>
      <Link className="text-link" href="/catalog">
        {text('بازگشت به محصولات', 'Back to products')}
      </Link>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import Link from '../navigation/localized-link';
import { ArrowLeft, ChevronLeft, Heart, X } from 'lucide-react';
import { useShop } from '../providers/shop-provider';
import { ProductGrid } from './product-card';
import { Button, Modal } from '../shared/ui';
export function Wishlist() {
  const { t, digits, locale } = useI18n(),
    { products } = useStorefront(),
    { wishlist, preferencesReady: ready, wishlistStatus: status, toggleWish } = useShop();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const items = products.filter((p) => wishlist.includes(p.id)),
    missing = wishlist.filter((id) => !products.some((p) => p.id === id));
  const [selected, setSelected] = useState<string[]>([]),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (!status?.account) {
      setOpen(false);
      setSelected([]);
    }
  }, [status?.account]);
  function review() {
    setSelected([]);
    setOpen(true);
  }
  async function apply() {
    if (await status?.importGuest(selected)) {
      setOpen(false);
      setSelected([]);
    }
  }
  return (
    <div className="container collection-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <span>{t('علاقه‌مندی‌ها')}</span>
        </div>
        <div className="page-title-row">
          <div>
            <span className="eyebrow">{t('برای وقتی که دوباره برمی‌گردی')}</span>
            <h1>{t('انتخاب‌های دوست‌داشتنی تو')}</h1>
            <p>
              {status?.account
                ? text('این فهرست در حساب شما ذخیره می‌شود.', 'This list is saved to your account.')
                : text(
                    'انتخاب‌های مهمان در همین مرورگر نگه داشته می‌شوند.',
                    'Guest selections are kept in this browser.',
                  )}
            </p>
          </div>
          <span>
            {digits(wishlist.length)}{' '}
            {text('محصول', wishlist.length === 1 ? 'product' : 'products')}
          </span>
        </div>
      </div>
      {status?.failed && (
        <div className="shop-load-error" role="alert">
          <span>
            {text(
              'علاقه‌مندی‌ها کامل دریافت نشد؛ اطلاعات ذخیره‌شده محفوظ‌اند.',
              'Favourites could not be fully loaded. Saved selections are preserved.',
            )}
          </span>
          <button onClick={status.retry} disabled={status.busy}>
            {t('تلاش دوباره')}
          </button>
        </div>
      )}
      {status?.issue && (
        <p role="status">
          {text(
            'ذخیرهٔ قبلی قطعی نشد؛ فهرست جاری را بررسی و در صورت نیاز دوباره انتخاب کنید.',
            'The earlier save was not confirmed. Review the current list and select again if needed.',
          )}
        </p>
      )}
      {!!status?.guestWishlist.length && (
        <div className="card-panel" style={{ padding: '1rem', marginBlockEnd: '1rem' }}>
          <p>
            {text(
              'انتخاب‌های قبل از ورود خودکار به حساب اضافه نشده‌اند.',
              'Your guest selections have not been added to the account automatically.',
            )}
          </p>
          <Button onClick={review} disabled={!ready || status.busy}>
            {text('بررسی و انتقال انتخاب‌های مهمان', 'Review and import guest selections')} (
            {digits(status.guestWishlist.length)})
          </Button>
        </div>
      )}
      {!ready ? (
        <div
          className="skeleton skeleton-card"
          aria-label={text('در حال دریافت علاقه‌مندی‌ها', 'Loading favourites')}
        />
      ) : items.length || missing.length ? (
        <>
          <ProductGrid items={items} />
          {!!missing.length && (
            <section className="card-panel" style={{ padding: '1rem', marginBlockStart: '1rem' }}>
              <h2>{text('جزئیات فعلی در دسترس نیست', 'Current details unavailable')}</h2>
              <p>
                {text(
                  'این کالاها از فهرست شما حذف نشده‌اند.',
                  'These products have been kept in your list.',
                )}
              </p>
              <ul>
                {missing.map((id) => (
                  <li key={id}>
                    <bdi>{id}</bdi>{' '}
                    <button
                      disabled={status?.busy}
                      onClick={() => toggleWish(id)}
                      aria-label={
                        text('حذف کالای در دسترس‌نبودن ', 'Remove unavailable product ') + id
                      }
                    >
                      <X size={16} />
                      {t('حذف')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <div className="empty-state card-panel">
          <Heart size={48} />
          <h2>{t('هنوز انتخابی اینجا ذخیره نشده')}</h2>
          <p>
            {text(
              'روی قلب کنار هر محصول بزن تا بعداً راحت‌تر پیدایش کنی.',
              'Tap the heart beside a product to find it here later.',
            )}
          </p>
          <Button asChild>
            <Link href="/catalog">
              {t('کشف محصولات')}
              <ArrowLeft size={17} />
            </Link>
          </Button>
        </div>
      )}
      <Modal
        open={open && !!status?.account}
        onOpenChange={(value) => {
          if (status?.busy) return;
          setOpen(value);
          if (!value) setSelected([]);
        }}
        title={text('انتخاب برای انتقال به حساب', 'Select products to import')}
      >
        <p>
          {text(
            'فقط کالاهای انتخاب‌شده اضافه می‌شوند؛ بقیه در فهرست مهمان می‌مانند.',
            'Only selected products will be added; the others stay in the guest list.',
          )}
        </p>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {status?.guestWishlist.map((id) => {
            const product = products.find((p) => p.id === id);
            return (
              <li key={id} style={{ paddingBlock: '.5rem', overflowWrap: 'anywhere' }}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!product || status.busy}
                    checked={selected.includes(id)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked ? [...old, id] : old.filter((x) => x !== id),
                      )
                    }
                  />
                  {product?.name ?? text('کالای در دسترس‌نبودن: ', 'Unavailable product: ') + id}
                </label>
              </li>
            );
          })}
        </ul>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <Button
            disabled={
              !selected.length || status?.busy || new Set([...wishlist, ...selected]).size > 200
            }
            onClick={() => void apply()}
          >
            {text('افزودن انتخاب‌ها به حساب', 'Add selections to account')} (
            {digits(selected.length)})
          </Button>
          <Button
            variant="outline"
            disabled={status?.busy}
            onClick={() => {
              setOpen(false);
              setSelected([]);
            }}
          >
            {t('انصراف')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
export { Compare } from './comparison';

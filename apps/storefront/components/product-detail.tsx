'use client';
import { UsedConditionReport } from './used-condition';
import { ProductReviews } from './product-reviews';
import { publicImageVariant } from '@/lib/media-paths';
import { useI18n, useStorefront } from '@/components/locale-provider';
import Link from '@/components/localized-link';
import Image from '@/components/content-image';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpLeft,
  ChevronLeft,
  Heart,
  GitCompareArrows,
  Share2,
  ShieldCheck,
  PackageCheck,
  CreditCard,
  Check,
  Plus,
  Minus,
  Expand,
  Bell,
  MessageCircle,
  Info,
} from 'lucide-react';
import { availablePurchaseMethods, eligibleChequePlans } from '@/lib/purchasing';
import type { Product } from '@/lib/types';
import { chequeQuote, discount } from '@/lib/commerce';
import { useShop } from './shop-provider';
import { ProductGrid } from './product-card';
import { Button, Modal, groupNavigation } from './ui';
export function ProductDetail({
  product,
  initialVariantId,
  relatedProducts = [],
}: {
  product: Product;
  initialVariantId?: string;
  relatedProducts?: Product[];
}) {
  const { t, digits, toman, locale } = useI18n();
  const { categories, chequePlans, attributeLabels, purchaseMethods, attributeDefinitions } =
    useStorefront();
  const [variantId, setVariantId] = useState(
      product.variants.find((v) => v.id === initialVariantId)?.id ??
        product.variants.find((v) => v.stock > 0)?.id ??
        product.variants[0].id,
    ),
    [count, setCount] = useState(1),
    [tab, setTab] = useState('specs'),
    [zoom, setZoom] = useState(false),
    [view, setView] = useState(0);
  const { add, wishlist, toggleWish, compare, toggleCompare, notify, cartBusy, loadError, ready } =
    useShop();
  const variant = product.variants.find((v) => v.id === variantId)!;
  const category = categories.find((c) => c.key === product.category)!;
  const off = discount(variant.priceRial, variant.compareAtRial);
  const methods = availablePurchaseMethods(product, variant, purchaseMethods);
  const plans = eligibleChequePlans(chequePlans, BigInt(variant.priceRial), [product]);
  const chequeMethod = methods.some((m) => m.kind === 'cheque');
  const quote =
    chequeMethod && plans[0] ? chequeQuote(BigInt(variant.priceRial), plans[0]) : undefined;
  const specs = Object.entries({ ...product.attributes, ...variant.attributes }).filter(
    ([key]) =>
      category.attributeRules?.find((a) => a.key === key)?.showInSpecs ??
      attributeDefinitions.find((a) => a.key === key)?.showInSpecs !== false,
  );
  const images = product.images?.length ? product.images : [product.image];
  const selectedImage = images[view] ?? images[0];
  const related = relatedProducts;
  function selectVariant(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', id);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    setVariantId(id);
    setCount(1);
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify(t('لینک محصول کپی شد'));
    } catch {
      notify(t('برای اشتراک‌گذاری، نشانی صفحه را از مرورگر کپی کنید'));
    }
  }
  return (
    <div className="container product-page">
      <div className="page-top">
        <div className="breadcrumbs">
          <Link href="/">{t('سایمان')}</Link>
          <ChevronLeft />
          <Link href={`/catalog?category=${category.key}`}>{t(category.name)}</Link>
          <ChevronLeft />
          <span>{t(product.name)}</span>
        </div>
      </div>
      <section className="product-detail-grid">
        <div className="product-gallery">
          <div className="gallery-tools">
            <button
              className={`icon-button ${wishlist.includes(product.id) ? 'is-active' : ''}`}
              aria-label={t('ذخیره در علاقه‌مندی‌ها')}
              aria-pressed={wishlist.includes(product.id)}
              onClick={() => toggleWish(product.id, product)}
            >
              <Heart size={20} fill={wishlist.includes(product.id) ? 'currentColor' : 'none'} />
            </button>
            <button
              className={`icon-button ${compare.includes(product.id) ? 'is-active' : ''}`}
              aria-label={t('افزودن به مقایسه')}
              aria-pressed={compare.includes(product.id)}
              onClick={() => toggleCompare(product.id, product)}
            >
              <GitCompareArrows size={20} />
            </button>
            <button className="icon-button" onClick={share} aria-label={t('کپی لینک محصول')}>
              <Share2 size={18} />
            </button>
          </div>
          <button
            className="gallery-main"
            aria-label={t('بزرگنمایی تصویر محصول')}
            onClick={() => setZoom(true)}
          >
            <Image
              src={selectedImage}
              alt={product.name}
              width={700}
              height={560}
              sizes="(max-width: 767px) calc(100vw - 48px), (max-width: 1100px) 45vw, 540px"
              loading="eager"
              fetchPriority="high"
            />
            <span className="gallery-expand">
              <Expand size={17} />
            </span>
          </button>
          <div className="gallery-thumbnails">
            {images.map((url, index) => (
              <button
                key={url}
                onClick={() => setView(index)}
                className={view === index ? 'active' : ''}
                aria-label={t('تصویر {0} از {1}', [digits(index + 1), digits(images.length)])}
                aria-pressed={view === index}
              >
                <Image src={publicImageVariant(url, 'thumb')} alt="" width={78} height={62} />
              </button>
            ))}
          </div>
          {selectedImage.startsWith('/products/') && (
            <span className="gallery-note">{t('تصویر مفهومی برای پیش‌نمایش طراحی')}</span>
          )}
        </div>
        <div className="product-detail-info">
          <div className="product-detail-kicker">
            <Link href={`/catalog?category=${category.key}`}>{t(category.name)}</Link>
            <span>/</span>
            <Link href={`/catalog?q=${product.brand}`}>{t(product.brand)}</Link>
          </div>
          <h1>{t(product.name)}</h1>
          <p className="english-name">{t(product.englishName)}</p>
          <div className="detail-tags">
            {t(product.badge && <span className="sample-label">{t(product.badge)}</span>)}
            <span className="detail-stock">
              <i className="live-dot" />
              {t(variant.stock ? t('موجود در پیش‌نمایش') : t('این تنوع ناموجود است'))}
            </span>
          </div>
          <div className="detail-divider" />
          <div className="variant-section">
            <p>
              {t('انتخاب رنگ و حافظه:')}
              <strong>
                {t(variant.colorName)} · {t(variant.label)}
              </strong>
            </p>
            <div
              className="variant-options"
              role="radiogroup"
              tabIndex={-1}
              aria-label={t('انتخاب تنوع محصول')}
              onKeyDown={groupNavigation}
            >
              {t(
                product.variants.map((v) => (
                  <button
                    role="radio"
                    tabIndex={variantId === v.id ? 0 : -1}
                    aria-checked={variantId === v.id}
                    key={v.id}
                    className={variantId === v.id ? 'variant-option active' : 'variant-option'}
                    onClick={() => selectVariant(v.id)}
                  >
                    <span className="variant-dot" style={{ background: v.color }} />
                    <span>
                      {t(v.colorName)}
                      <small>
                        {t(v.label)}
                        {t(!v.stock ? t(' \u00B7 ناموجود') : '')}
                      </small>
                    </span>
                    {t(variantId === v.id && <Check size={15} />)}
                  </button>
                )),
              )}
            </div>
          </div>
          <div className="detail-features">
            <h2>{t('نگاهی به ویژگی‌ها')}</h2>
            <div>
              {t(
                specs.slice(0, 4).map(([key, value]) => (
                  <div key={key}>
                    <span>{t(attributeLabels[key] ?? key)}</span>
                    <strong>{t(value)}</strong>
                  </div>
                )),
              )}
            </div>
            <a href="#product-tabs" onClick={() => setTab('specs')} className="text-link">
              {t('همهٔ مشخصات')}
              <ArrowLeft size={14} />
            </a>
          </div>
          <Link href="/support" className="detail-help">
            <MessageCircle size={16} />
            {t('برای انتخابت راهنمایی می‌خوای؟')}
            <ArrowUpLeft size={15} />
          </Link>
        </div>
        <aside className="purchase-panel">
          <div className="purchase-heading">
            <span className="brand-mini">{t('سایمان')}</span>
            <span>{t('فروشندهٔ این کالا')}</span>
          </div>
          <UsedConditionReport condition={variant.usedCondition} locale={locale} />
          <div className="purchase-detail">
            <ShieldCheck size={18} />
            <span>{t(variant.warranty)}</span>
          </div>
          <div className="purchase-detail">
            <PackageCheck size={18} />
            <span>
              {t(
                variant.stock
                  ? t('{0} عدد موجودی نمونه', [digits(variant.stock)])
                  : t('در انتظار موجود شدن'),
              )}
            </span>
          </div>
          <div className="detail-divider" />
          <div className="purchase-price">
            <span>{t('قیمت نمونهٔ نقدی')}</span>
            {t(
              off > 0 && (
                <div className="old-price">
                  <del>
                    {t(toman(variant.compareAtRial!))}
                    {t('تومان')}
                  </del>
                  <span className="discount">
                    {t(digits(off))}
                    {t('٪')}
                  </span>
                </div>
              ),
            )}
            <strong>
              {t(toman(variant.priceRial))} <small>{t('تومان')}</small>
            </strong>
          </div>
          {t(
            variant.stock > 0 ? (
              <>
                <div className="purchase-quantity">
                  <span>{t('تعداد')}</span>
                  <div className="quantity-control">
                    <button
                      onClick={() => setCount((n) => n + 1)}
                      disabled={count >= variant.stock}
                      aria-label={t('افزایش تعداد')}
                    >
                      <Plus size={15} />
                    </button>
                    <span>{t(digits(count))}</span>
                    <button
                      onClick={() => setCount((n) => n - 1)}
                      disabled={count <= 1}
                      aria-label={t('کاهش تعداد')}
                    >
                      <Minus size={15} />
                    </button>
                  </div>
                </div>
                <Button
                  className="full"
                  disabled={!methods.length || cartBusy || loadError || !ready}
                  onClick={() => add(variant.id, count, product)}
                >
                  {t('افزودن به سبد خرید')}
                  <Plus size={18} />
                </Button>
              </>
            ) : (
              <Button
                className="full"
                variant="outline"
                onClick={() =>
                  notify(t('اعلان موجودی پس از اتصال حساب و سرویس اطلاع‌رسانی فعال می‌شود'))
                }
              >
                {t('در صورت موجود شدن خبرم کن')}
                <Bell size={17} />
              </Button>
            ),
          )}
          <div className="purchase-method-list">
            <strong>{t('روش‌های خرید این کالا')}</strong>
            {methods.map((m) => (
              <span key={m.id}>
                <Check size={13} />
                {t(m.name)}
              </span>
            ))}
            {!methods.length && <span>{t('روش خرید فعالی برای این کالا تعریف نشده است.')}</span>}
          </div>
          {quote && (
            <div className="purchase-installment">
              <CreditCard size={19} />
              <div>
                <strong>{t('به خرید چکی فکر می‌کنی؟')}</strong>
                <p>
                  {t('طرح {0} ماهه از {1} تومان', [
                    digits(plans[0].months),
                    toman(quote.installments[0]),
                  ])}
                </p>
                <Link href={`/installments?product=${product.slug}&variant=${variant.id}`}>
                  {t('دیدن محاسبه و شرایط')}
                  <ArrowLeft size={13} />
                </Link>
              </div>
            </div>
          )}
          <p className="purchase-disclaimer">
            <Info size={13} />
            {t('قیمت، موجودی و گارانتی فعلاً نمونه‌اند.')}
          </p>
        </aside>
      </section>
      <section className="product-tabs-section" id="product-tabs">
        <div
          className="product-tabs"
          role="tablist"
          tabIndex={-1}
          aria-label={t('جزئیات محصول')}
          onKeyDown={groupNavigation}
        >
          {t(
            [
              ['specs', t('مشخصات فنی')],
              ['description', t('دربارهٔ این محصول')],
              ['reviews', t('دیدگاه‌ها')],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                id={`product-tab-${key}`}
                aria-controls="product-tab-panel"
                tabIndex={tab === key ? 0 : -1}
                aria-selected={tab === key}
                className={tab === key ? 'active' : ''}
                onClick={() => setTab(key)}
              >
                {t(label)}
              </button>
            )),
          )}
        </div>
        <div
          className="product-tab-panel"
          id="product-tab-panel"
          role="tabpanel"
          aria-labelledby={`product-tab-${tab}`}
        >
          {t(
            tab === 'specs' ? (
              <>
                <h2>{t('جزئیاتی برای انتخاب دقیق‌تر')}</h2>
                <div className="spec-table">
                  {t(
                    specs.map(([key, value]) => (
                      <div key={key}>
                        <span>{t(attributeLabels[key] ?? key)}</span>
                        <strong>{t(value)}</strong>
                      </div>
                    )),
                  )}
                </div>
                <p className="small-note">
                  {t(
                    'مشخصات این نسخه نمونه‌اند و پیش از انتشار نهایی با اطلاعات تأمین‌کننده تطبیق داده می‌شوند.',
                  )}
                </p>
              </>
            ) : tab === 'description' ? (
              <>
                <h2>
                  {t(product.name)}
                  {t('؛ همراه روزهای تو')}
                </h2>
                <p className="description-text">{t(product.description)}</p>
                <p className="small-note">
                  {t(
                    'برای بررسی گارانتی، سازگاری و شرایط تحویل نسخهٔ نهایی کالا، از راهنمای خرید کمک بگیرید.',
                  )}
                </p>
                <Link className="text-link" href="/support">
                  {t('راهنمای خرید')}
                  <ArrowLeft size={16} />
                </Link>
              </>
            ) : (
              <ProductReviews productId={product.id} />
            ),
          )}
        </div>
      </section>
      {t(
        related.length > 0 && (
          <section className="related-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t('نگاهی به انتخاب‌های دیگر')}</span>
                <h2>{t('کنار این انتخاب ببین')}</h2>
              </div>
              <Link className="text-link" href={`/catalog?category=${category.key}`}>
                {t('همهٔ محصولات')}
                <ArrowLeft size={17} />
              </Link>
            </div>
            <ProductGrid items={related} />
          </section>
        ),
      )}
      <div className="mobile-purchase">
        <div>
          <strong>{t(toman(variant.priceRial))}</strong>
          <small>{t('تومان \u00B7 قیمت نمونه')}</small>
        </div>
        <Button
          disabled={!variant.stock || !methods.length || cartBusy || loadError || !ready}
          onClick={() => add(variant.id, count, product)}
        >
          {t(variant.stock ? t('افزودن به سبد') : t('فعلاً ناموجود'))}
          <Plus size={17} />
        </Button>
      </div>
      <Modal open={zoom} onOpenChange={setZoom} title={product.name}>
        <Image
          src={publicImageVariant(selectedImage, 'zoom')}
          alt={product.name}
          width={700}
          height={560}
        />
        {selectedImage.startsWith('/products/') && (
          <p className="small-note">{t('تصویر مفهومی محصول در پیش‌نمایش')}</p>
        )}
      </Modal>
    </div>
  );
}

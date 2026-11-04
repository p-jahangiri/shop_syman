'use client';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import { ProductReviews } from './product-reviews';
import { publicImageVariant } from '@sayman/web-shared/lib/media/media-paths.ts';
import {
  inspectionGalleryKey,
  productInspectionImages,
} from '@/lib/catalog/used-inspection-photos';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import Image from '@/components/media/content-image';
import { useEffect, useRef, useState } from 'react';
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
  MessageCircle,
  Info,
  CirclePlay,
  Images,
  ChevronDown,
} from 'lucide-react';
import { availablePurchaseMethods, eligibleChequePlans } from '@/lib/catalog/purchasing';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
import { chequeQuote, discount } from '@sayman/web-shared/lib/shared/commerce.ts';
import { useShop } from '../providers/shop-provider';
import { ProductGrid } from './product-card';
import { Button, Modal, groupNavigation } from '../shared/ui';

function revealFirstVideo(gallery: HTMLElement | null) {
  const video = gallery?.querySelector<HTMLDetailsElement>('.product-video');
  if (video) video.open = true;
}

function ProductVideoItem({
  url,
  label,
  productName,
  fa,
}: {
  url: string;
  label: string;
  productName: string;
  fa: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <details
      className="product-video"
      onToggle={(event) => {
        const panel = event.currentTarget;
        if (!panel.open) panel.querySelector('video')?.pause();
      }}
    >
      <summary>
        <CirclePlay size={20} aria-hidden="true" />
        <strong>{label}</strong>
        <ChevronDown className="product-video-chevron" size={17} aria-hidden="true" />
      </summary>
      <div className="product-video-player">
        <video
          controls
          playsInline
          preload="none"
          src={url}
          aria-label={fa ? 'ویدیوی ' + productName : 'Video of ' + productName}
          onError={() => setFailed(true)}
          onPlaying={() => setFailed(false)}
        >
          <track kind="captions" />
        </video>
        {failed && (
          <p role="status">
            {fa ? 'ویدیو در این پخش‌کننده باز نشد.' : 'This player could not open the video.'}{' '}
            <a href={url} target="_blank" rel="noreferrer">
              {fa ? 'بازکردن فایل ویدیو' : 'Open video file'}
            </a>
          </p>
        )}
      </div>
    </details>
  );
}
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
  const fa = locale === 'fa';
  const {
    categories,
    chequePlans,
    attributeLabels,
    purchaseMethods,
    attributeDefinitions,
    isPreview,
    dataSource,
  } = useStorefront();
  const fixturePreview = isPreview && dataSource !== 'api';
  const [variantId, setVariantId] = useState(
      product.variants.find((v) => v.id === initialVariantId)?.id ??
        product.variants.find((v) => v.stock > 0)?.id ??
        product.variants[0].id,
    ),
    [count, setCount] = useState(1),
    [tab, setTab] = useState('specs'),
    [gallery, setGallery] = useState({ key: '', view: 0, zoom: false });
  const { add, wishlist, toggleWish, compare, toggleCompare, notify, cartBusy, loadError, ready } =
    useShop();
  const variant = product.variants.find((v) => v.id === variantId)!;
  const videos = product.videos ?? [];
  const selectedVideos = videos.filter(
    (video) => !video.variantId || video.variantId === variant.id,
  );
  const otherVideoVariants = product.variants.filter(
    (item) => item.id !== variant.id && videos.some((video) => video.variantId === item.id),
  );
  const hasVideos = selectedVideos.length > 0 || otherVideoVariants.length > 0;
  const videoGallery = useRef<HTMLElement>(null);
  useEffect(() => {
    if (videoGallery.current && window.location.hash === '#product-videos')
      revealFirstVideo(videoGallery.current);
  }, [variant.id, hasVideos]);
  const hasDifferentPrices = product.variants.some((item) => item.priceRial !== variant.priceRial);
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
  const galleryKey = inspectionGalleryKey(variant),
    images = productInspectionImages(product, variant.usedCondition, locale),
    view = gallery.key === galleryKey ? gallery.view : 0,
    zoom = gallery.key === galleryKey && gallery.zoom,
    selectedPhoto = images[view] ?? images[0],
    selectedImage = selectedPhoto.url;
  const setZoom = (open: boolean) =>
    setGallery((old) => ({
      key: galleryKey,
      view: old.key === galleryKey ? old.view : 0,
      zoom: open,
    }));
  const related = relatedProducts;
  const isIllustration = selectedImage.startsWith('/products/') && selectedImage.endsWith('.svg');
  const stockLabel = variant.stock
    ? fixturePreview
      ? t('موجود در پیش‌نمایش')
      : fa
        ? 'موجود'
        : 'In stock'
    : t('این تنوع ناموجود است');
  function selectVariant(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', id);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    setVariantId(id);
    setCount(1);
    setGallery({ key: '', view: 0, zoom: false });
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
              onClick={() => toggleCompare(product.id, product, variant.id)}
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
              alt={selectedPhoto.alt}
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
          <div className="product-gallery-caption">
            <span>
              <Images size={17} aria-hidden="true" />
              {fa ? 'تصاویر کالا' : 'Product photos'}
              <small>
                {digits(view + 1)} / {digits(images.length)}
              </small>
            </span>
            {hasVideos && (
              <a href="#product-videos" onClick={() => revealFirstVideo(videoGallery.current)}>
                <CirclePlay size={17} aria-hidden="true" />
                {fa ? 'تماشای ویدیو' : 'Watch video'}
              </a>
            )}
          </div>
          {images.length > 1 && (
            <div className="gallery-thumbnails">
              {images.map((photo, index) => (
                <button
                  key={photo.url}
                  onClick={() => setGallery({ key: galleryKey, view: index, zoom: false })}
                  className={view === index ? 'active' : ''}
                  aria-label={t('تصویر {0} از {1}', [digits(index + 1), digits(images.length)])}
                  aria-pressed={view === index}
                >
                  <Image
                    src={publicImageVariant(photo.url, 'thumb')}
                    alt=""
                    width={78}
                    height={62}
                  />
                </button>
              ))}
            </div>
          )}
          {hasVideos && (
            <section
              className="product-video-gallery"
              id="product-videos"
              ref={videoGallery}
              tabIndex={-1}
              aria-label={locale === 'fa' ? 'ویدیوهای کالا' : 'Product videos'}
            >
              {selectedVideos.map((video, index) => (
                <ProductVideoItem
                  key={video.url + '|' + video.variantId}
                  url={video.url}
                  productName={product.name}
                  fa={locale === 'fa'}
                  label={
                    (locale === 'fa' ? 'ویدیوی کالا' : 'Product video') +
                    (selectedVideos.length > 1 ? ' ' + digits(index + 1) : '')
                  }
                />
              ))}
              {otherVideoVariants.length > 0 && (
                <div className="product-video-variants">
                  <span>
                    {locale === 'fa' ? 'ویدیوی تنوع‌های دیگر' : 'Videos for other variants'}
                  </span>
                  {otherVideoVariants.map((item) => (
                    <button type="button" key={item.id} onClick={() => selectVariant(item.id)}>
                      <CirclePlay size={15} aria-hidden="true" />
                      {item.label || item.colorName || item.sku}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {variant.usedCondition && (
            <p className="gallery-note">
              {selectedPhoto.source === 'inspection'
                ? locale === 'fa'
                  ? 'تصاویر همین دستگاه · نسخهٔ ثبت‌شدهٔ گزارش سلامت'
                  : 'This unit’s photos · Recorded inspection revision'
                : locale === 'fa'
                  ? 'تصاویر عمومی مدل؛ عکس اختصاصی این دستگاه ثبت نشده است.'
                  : 'General model images. No unit-specific photos have been recorded.'}
            </p>
          )}
          {isIllustration && !variant.usedCondition && (
            <span className="gallery-note">{fa ? 'تصویر شماتیک مدل' : 'Model illustration'}</span>
          )}
        </div>
        <div className="product-detail-info">
          <div className="product-detail-kicker">
            <Link href={`/catalog?category=${category.key}`}>{t(category.name)}</Link>
            <span>/</span>
            <Link href={`/catalog?q=${encodeURIComponent(product.brand)}`}>{t(product.brand)}</Link>
          </div>
          <h1>{t(product.name)}</h1>
          {product.englishName.trim() && product.englishName !== product.name && (
            <p className="english-name" dir="auto">
              {t(product.englishName)}
            </p>
          )}
          <div className="detail-tags">
            {t(product.badge && <span className="sample-label">{t(product.badge)}</span>)}
            <span className="detail-stock" data-in-stock={variant.stock > 0} aria-live="polite">
              <i aria-hidden="true" />
              {stockLabel}
            </span>
          </div>
          <div className="detail-divider" />
          <div className="variant-section">
            <h2>
              {product.variants.length > 1
                ? t('انتخاب تنوع محصول')
                : fa
                  ? 'تنوع کالا'
                  : 'Product variant'}
            </h2>
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
                    {v.colorName && (
                      <span
                        className="variant-dot"
                        style={{ background: v.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      {t(v.label || v.colorName || v.sku)}
                      {(v.colorName && v.label && v.colorName !== v.label) ||
                      !v.stock ||
                      hasDifferentPrices ? (
                        <small>
                          {[
                            v.colorName && v.label && v.colorName !== v.label ? t(v.colorName) : '',
                            v.stock
                              ? hasDifferentPrices
                                ? `${toman(v.priceRial)} ${t('تومان')}`
                                : ''
                              : t('فعلاً ناموجود'),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      ) : null}
                    </span>
                    {t(variantId === v.id && <Check size={15} />)}
                  </button>
                )),
              )}
            </div>
          </div>
          {specs.length > 0 && (
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
          )}
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
                  ? fixturePreview
                    ? t('{0} عدد موجودی نمونه', [digits(variant.stock)])
                    : locale === 'fa'
                      ? `${digits(variant.stock)} عدد موجود`
                      : `${digits(variant.stock)} in stock`
                  : t('در انتظار موجود شدن'),
              )}
            </span>
          </div>
          <div className="detail-divider" />
          <div className="purchase-price">
            <span>{locale === 'fa' ? 'قیمت کالا' : 'Product price'}</span>
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
            ) : null,
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
          {fixturePreview && (
            <p className="purchase-disclaimer">
              <Info size={13} />
              {t('قیمت، موجودی و گارانتی فعلاً نمونه‌اند.')}
            </p>
          )}
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
                {specs.length > 0 ? (
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
                ) : (
                  <p className="small-note">
                    {fa
                      ? 'مشخصات فنی برای این تنوع ثبت نشده است.'
                      : 'No specifications are listed for this variant.'}
                  </p>
                )}
                {fixturePreview && (
                  <p className="small-note">
                    {t(
                      'مشخصات این نسخه نمونه‌اند و پیش از انتشار نهایی با اطلاعات تأمین‌کننده تطبیق داده می‌شوند.',
                    )}
                  </p>
                )}
              </>
            ) : tab === 'description' ? (
              <>
                <h2>{t(product.name)}</h2>
                <p className="description-text">{t(product.description)}</p>
                <p className="small-note">
                  {fa
                    ? 'برای پرسش دربارهٔ گارانتی، سازگاری و تحویل کالا با پشتیبانی در ارتباط باشید.'
                    : 'Contact support with questions about warranty, compatibility, or delivery.'}
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
          <small>
            {fixturePreview ? t('تومان \u00B7 قیمت نمونه') : locale === 'fa' ? 'تومان' : 'toman'}
          </small>
        </div>
        <Button
          disabled={!variant.stock || !methods.length || cartBusy || loadError || !ready}
          onClick={() => add(variant.id, count, product)}
        >
          {variant.stock === 0
            ? t('فعلاً ناموجود')
            : methods.length
              ? t('افزودن به سبد')
              : fa
                ? 'خرید این تنوع فعال نیست'
                : 'Purchasing is unavailable'}
          <Plus size={17} />
        </Button>
      </div>
      <Modal open={zoom} onOpenChange={setZoom} title={product.name}>
        <Image
          src={publicImageVariant(selectedImage, 'zoom')}
          alt={selectedPhoto.alt}
          width={700}
          height={560}
        />
        {isIllustration && (
          <p className="small-note">{fa ? 'تصویر شماتیک مدل' : 'Model illustration'}</p>
        )}
      </Modal>
    </div>
  );
}

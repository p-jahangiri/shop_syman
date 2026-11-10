'use client';
import { UsedConditionReport } from '@sayman/web-shared/components/catalog/used-condition';
import { ProductReviews } from './product-reviews';
import { PhoneColorOptions, PhoneConfigurationOptions } from './phone-variant-picker';
import { publicImageVariant } from '@sayman/web-shared/lib/media/media-paths.ts';
import {
  inspectionGalleryKey,
  productInspectionImages,
} from '@/lib/catalog/used-inspection-photos';
import { useI18n, useStorefront } from '@/components/navigation/locale-provider';
import Link from '@/components/navigation/localized-link';
import Image from '@/components/media/content-image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUpLeft,
  ChevronLeft,
  Heart,
  GitCompareArrows,
  Share2,
  ShieldCheck,
  CreditCard,
  CalendarDays,
  WalletCards,
  Check,
  Plus,
  Minus,
  Expand,
  MessageCircle,
  Info,
  CirclePlay,
  Images,
  ChevronDown,
  Smartphone,
  HardDrive,
  MemoryStick,
  Cpu,
  Camera,
  Battery,
  RotateCcw,
} from 'lucide-react';
import { availablePurchaseMethods, eligibleChequePlans } from '@/lib/catalog/purchasing';
import { phoneConfigurations } from '@/lib/catalog/phone-configurations';
import type { Product } from '@sayman/web-shared/lib/shared/types.ts';
import { chequeQuote, discount } from '@sayman/web-shared/lib/shared/commerce.ts';
import { useShop } from '../providers/shop-provider';
import { RecentlyViewed } from './recently-viewed';
import { Button, Modal, groupNavigation } from '../shared/ui';
import './product-detail-presentation.css';

const phoneFeatureIcons = {
  display: Smartphone,
  storage: HardDrive,
  ram: MemoryStick,
  processor: Cpu,
  camera: Camera,
  battery: Battery,
};
const phoneFeatureOrder = [...Object.keys(phoneFeatureIcons), 'os', 'weight'];

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
  initialTab,
  composeReview,
  initialReviewRating,
  relatedProducts,
  questions,
}: {
  product: Product;
  initialVariantId?: string;
  initialTab?: 'reviews' | 'questions';
  composeReview?: boolean;
  initialReviewRating?: number;
  relatedProducts?: ReactNode;
  questions?: ReactNode;
}) {
  const { t, digits, toman, locale } = useI18n();
  const fa = locale === 'fa';
  const {
    site,
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
    [tab, setTab] = useState<string>(initialTab ?? 'specs'),
    [gallery, setGallery] = useState({ key: '', view: 0, zoom: false });
  const { add, wishlist, toggleWish, compare, toggleCompare, notify, cartBusy, loadError, ready } =
    useShop();
  const variant = product.variants.find((v) => v.id === variantId)!;
  const phone = phoneConfigurations(product);
  const phoneGroup = phone?.groups.find((group) => group.variants.includes(variant));
  const variantOptions = phoneGroup?.variants ?? product.variants;
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
  const hasDifferentPrices = variantOptions.some((item) => item.priceRial !== variant.priceRial);
  const category = categories.find((c) => c.key === product.category)!;
  const off = discount(variant.priceRial, variant.compareAtRial);
  const originalPrice =
    variant.compareAtRial && BigInt(variant.compareAtRial) > BigInt(variant.priceRial)
      ? variant.compareAtRial
      : undefined;
  const example = product.badge === 'نمونهٔ آموزشی' || product.badge === 'Development demo';
  const exampleSuffix = / · (?:نمونهٔ آموزشی|Demo)$/u;
  const name = example ? product.name.replace(exampleSuffix, '') : product.name;
  const englishName = example
    ? product.englishName.replace(exampleSuffix, '')
    : product.englishName;
  const description =
    example &&
    /^(?:نمونهٔ Development برای آزمون|Development catalogue example\.)/u.test(product.description)
      ? ''
      : product.description;
  const warranty = variant.warranty.trim();
  const hasWarranty =
    warranty &&
    !/^گارانتی نمونه[ٔ‌ی]* [۰-۹0-9]+ ماهه$/u.test(warranty) &&
    ![
      'نمونهٔ آموزشی؛ قرارداد گارانتی واقعی نیست.',
      'Development example; no real warranty contract.',
    ].includes(warranty);
  const returnGuidance = site.categoryReturnGuidance?.find(
    (item) => item.categoryId === product.category,
  )?.text;
  const methods = availablePurchaseMethods(product, variant, purchaseMethods);
  const availableAlternative =
    variant.stock <= 0
      ? [
          ...variantOptions,
          ...product.variants.filter((item) => !variantOptions.includes(item)),
        ].find(
          (item) =>
            item.stock > 0 &&
            Boolean(item.usedCondition) === Boolean(variant.usedCondition) &&
            availablePurchaseMethods(product, item, purchaseMethods).length > 0,
        )
      : undefined;
  const selectedQuantity = Math.min(count, Math.max(1, variant.stock));
  const plans = eligibleChequePlans(chequePlans, BigInt(variant.priceRial), [product]);
  const chequeMethod = methods.some((m) => m.kind === 'cheque');
  const quote =
    chequeMethod && plans[0] ? chequeQuote(BigInt(variant.priceRial), plans[0]) : undefined;
  const specs = Object.entries(
    phoneGroup?.specs ?? { ...product.attributes, ...variant.attributes },
  ).filter(
    ([key]) =>
      category.attributeRules?.find((a) => a.key === key)?.showInSpecs ??
      attributeDefinitions.find((a) => a.key === key)?.showInSpecs !== false,
  );
  const featureOrder =
    product.category === 'phones'
      ? phoneFeatureOrder
      : (category.attributeRules ?? []).map((rule) => rule.key);
  const rank = (key: string) => {
    const index = featureOrder.indexOf(key);
    return index === -1 ? featureOrder.length : index;
  };
  const highlights = specs
    .filter(([, value]) => value.trim())
    .sort(([left], [right]) => rank(left) - rank(right))
    .slice(0, product.category === 'phones' ? 6 : 4);
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
  const [shareUrl, setShareUrl] = useState('');
  const shareButton = useRef<HTMLButtonElement>(null);
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
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('variant', variant.id);
    try {
      await navigator.clipboard.writeText(url.href);
      notify(fa ? 'لینک این تنوع کپی شد' : 'Variant link copied');
    } catch {
      setShareUrl(url.href);
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
          <span dir="auto">{t(name)}</span>
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
            <button
              className="icon-button"
              ref={shareButton}
              onClick={share}
              aria-label={fa ? 'کپی لینک این تنوع' : 'Copy variant link'}
            >
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
                  productName={name}
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
          <h1 dir="auto">{t(name)}</h1>
          {englishName.trim() && englishName !== name && (
            <p className="english-name" dir="auto">
              {t(englishName)}
            </p>
          )}
          <div className="detail-tags">
            {!example && product.badge && <span className="sample-label">{t(product.badge)}</span>}
            <span className="detail-stock" data-in-stock={variant.stock > 0} aria-live="polite">
              <i aria-hidden="true" />
              {stockLabel}
            </span>
          </div>
          <div className="detail-divider" />
          {phoneGroup?.colorOnly && (
            <PhoneColorOptions
              variants={variantOptions}
              selected={variant}
              onSelect={selectVariant}
            />
          )}
          {phone && (
            <PhoneConfigurationOptions
              configurations={phone}
              selected={variant}
              attributeLabels={attributeLabels}
              onSelect={selectVariant}
            />
          )}
          {!phoneGroup?.colorOnly &&
            (product.category !== 'phones' || variantOptions.length > 1) && (
              <div className="variant-section">
                <h2>
                  {variantOptions.length > 1
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
                    variantOptions.map((v) => (
                      <button
                        id={`product-variant-${v.id}`}
                        type="button"
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
                          phoneGroup ||
                          hasDifferentPrices ? (
                            <small>
                              {[
                                v.colorName && v.label && v.colorName !== v.label
                                  ? t(v.colorName)
                                  : '',
                                phoneGroup ? t(v.warranty) : '',
                                phoneGroup ? v.sku : '',
                                hasDifferentPrices ? `${toman(v.priceRial)} ${t('تومان')}` : '',
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
            )}
          {highlights.length > 0 && (
            <div className="detail-features">
              <h2>{fa ? 'ویژگی‌های مهم' : 'Key specifications'}</h2>
              <dl className="product-feature-summary">
                {highlights.map(([key, value]) => {
                  const Icon =
                    product.category === 'phones' && Object.hasOwn(phoneFeatureIcons, key)
                      ? phoneFeatureIcons[key as keyof typeof phoneFeatureIcons]
                      : undefined;
                  return (
                    <div key={key}>
                      <dt>
                        {Icon && <Icon size={15} aria-hidden="true" />}
                        {t(attributeLabels[key] ?? key)}
                      </dt>
                      <dd dir="auto">{t(value)}</dd>
                    </div>
                  );
                })}
              </dl>
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
          {hasWarranty && (
            <div className="purchase-detail product-warranty">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                <strong>{fa ? 'گارانتی' : 'Warranty'}</strong>
                <span dir="auto">{t(warranty)}</span>
              </span>
            </div>
          )}

          <div className="detail-divider" />
          <div
            className="purchase-price"
            aria-live={phone ? 'polite' : undefined}
            aria-atomic={phone ? true : undefined}
          >
            <span>{locale === 'fa' ? 'قیمت کالا' : 'Product price'}</span>
            {t(
              originalPrice && (
                <div className="old-price">
                  {off > 0 && (
                    <span className="discount">
                      {t(digits(off))}
                      {t('٪')}
                    </span>
                  )}
                  <del>
                    <bdi>{toman(originalPrice)}</bdi> {t('تومان')}
                  </del>
                </div>
              ),
            )}
            <strong>
              <bdi>{toman(variant.priceRial)}</bdi> <small>{t('تومان')}</small>
            </strong>
          </div>
          {t(
            variant.stock > 0 ? (
              <>
                <div className="purchase-quantity">
                  <strong id="product-quantity-label">{t('تعداد')}</strong>
                  {variant.stock === 1 ? (
                    <span className="purchase-single-quantity">{fa ? '۱ عدد' : '1 item'}</span>
                  ) : (
                    <div
                      className="purchase-stepper"
                      role="group"
                      aria-labelledby="product-quantity-label"
                    >
                      <button
                        type="button"
                        onClick={() => setCount(selectedQuantity + 1)}
                        disabled={selectedQuantity >= variant.stock}
                        aria-label={t('افزایش تعداد')}
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                      <output>{digits(selectedQuantity)}</output>
                      <button
                        type="button"
                        onClick={() => setCount(selectedQuantity - 1)}
                        disabled={selectedQuantity <= 1}
                        aria-label={t('کاهش تعداد')}
                      >
                        <Minus size={18} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
                <Button
                  className="full"
                  disabled={!methods.length || cartBusy || loadError || !ready}
                  onClick={() => add(variant.id, selectedQuantity, product)}
                >
                  {t('افزودن به سبد خرید')}
                  <Plus size={18} />
                </Button>
              </>
            ) : (
              <Button className="full" disabled>
                {stockLabel}
              </Button>
            ),
          )}
          {availableAlternative && (
            <div className="product-stock-alternative">
              <strong>{fa ? 'تنوع دیگری موجود است' : 'Another variant is available'}</strong>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  selectVariant(availableAlternative.id);
                  const alternativeGroup = phone?.groups.find((group) =>
                    group.variants.includes(availableAlternative),
                  );
                  const focusId =
                    alternativeGroup && alternativeGroup !== phoneGroup
                      ? `phone-configuration-${alternativeGroup.id}`
                      : `product-variant-${availableAlternative.id}`;
                  document.getElementById(focusId)?.focus();
                }}
              >
                {fa ? 'انتخاب' : 'Choose'}{' '}
                {phone
                  ? [
                      ...new Set(
                        [availableAlternative.colorName, availableAlternative.label].filter(
                          Boolean,
                        ),
                      ),
                    ].join(' · ') || availableAlternative.sku
                  : availableAlternative.label ||
                    availableAlternative.colorName ||
                    availableAlternative.sku}
              </Button>
            </div>
          )}
          {variant.stock === 0 && (
            <Link
              className="text-link"
              href={
                '/purchase-requests?product=' +
                encodeURIComponent(product.slug) +
                '&variant=' +
                encodeURIComponent(variant.id)
              }
            >
              {locale === 'fa' ? 'درخواست تهیهٔ این مدل' : 'Request this model'}
            </Link>
          )}
          <section className="purchase-method-list" aria-labelledby="purchase-methods-title">
            <h2 id="purchase-methods-title">{t('روش‌های خرید این کالا')}</h2>
            {methods.length ? (
              <ul>
                {methods.map((method) => {
                  const Icon =
                    method.kind === 'cheque'
                      ? CalendarDays
                      : method.kind === 'installment'
                        ? WalletCards
                        : CreditCard;
                  return (
                    <li key={method.id} data-kind={method.kind}>
                      <Icon size={18} aria-hidden="true" />
                      <span dir="auto">{t(method.name)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>{t('روش خرید فعالی برای این کالا تعریف نشده است.')}</p>
            )}
          </section>
          {returnGuidance && (
            <details className="purchase-return-guidance">
              <summary>
                <RotateCcw size={16} aria-hidden="true" />
                {fa ? 'شرایط مرجوعی' : 'Return conditions'}
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <p dir="auto">{returnGuidance}</p>
            </details>
          )}
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
              ...(description ? [['description', t('دربارهٔ این محصول')]] : []),
              ['reviews', t('دیدگاه‌ها')],
              ...(questions ? [['questions', fa ? 'پرسش‌وپاسخ' : 'Questions & answers']] : []),
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
                <h2>{t(name)}</h2>
                <p className="description-text">{t(description)}</p>
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
            ) : tab === 'questions' ? (
              questions
            ) : (
              <ProductReviews
                productId={product.id}
                productName={t(name)}
                slug={product.slug}
                compose={composeReview}
                initialRating={initialReviewRating}
              />
            ),
          )}
        </div>
      </section>
      <RecentlyViewed currentProductId={product.id} currentVariantId={variant.id} />
      {relatedProducts}
      <Modal
        open={!!shareUrl}
        onOpenChange={(open) => {
          if (!open) setShareUrl('');
        }}
        title={fa ? 'لینک این تنوع' : 'Variant link'}
        restoreFocusRef={shareButton}
      >
        <input
          className="product-share-url"
          aria-label={fa ? 'نشانی قابل کپی' : 'Link to copy'}
          dir="ltr"
          value={shareUrl}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      </Modal>
      <div className="mobile-purchase">
        <div className="mobile-phone-price">
          {originalPrice && (
            <span className="mobile-phone-discount">
              {off > 0 && (
                <span className="discount">
                  {digits(off)}
                  {t('٪')}
                </span>
              )}
              <del>
                <bdi>{toman(originalPrice)}</bdi>
              </del>
            </span>
          )}
          <strong>
            <bdi>{toman(variant.priceRial)}</bdi>
          </strong>
          <small>
            {fixturePreview ? t('تومان \u00B7 قیمت نمونه') : locale === 'fa' ? 'تومان' : 'toman'}
          </small>
        </div>
        <Button
          disabled={!variant.stock || !methods.length || cartBusy || loadError || !ready}
          onClick={() => add(variant.id, selectedQuantity, product)}
        >
          {variant.stock === 0
            ? stockLabel
            : methods.length
              ? t('افزودن به سبد')
              : fa
                ? 'خرید این تنوع فعال نیست'
                : 'Purchasing is unavailable'}
          <Plus size={17} />
        </Button>
      </div>
      <Modal open={zoom} onOpenChange={setZoom} title={name}>
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

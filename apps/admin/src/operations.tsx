import { CmsBlogPosts } from './cms-blog-posts';
import { CmsRedirects } from './cms-redirects';
import { CmsPages } from './cms-pages';
import { ImageEditor } from './media';
import { useCmsImageUploads } from './cms-image-uploads';
import { SupportContentPreview } from './support-content-preview';
import { SupportContentEditor } from './support-content-editor';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, RotateCcw, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';

import { api, save } from './api';
import { Check, ErrorBox, Field, Modal } from './ui';
import { DataTable } from './ui-table';
import { ProductPicker } from './product-picker';
import { Area, Text } from './forms';
import {
  nameOf,
  type Catalog,
  type Content,
  type ContentDocument,
  type PurchaseMethod,
} from './types';
import { CmsMenuEditor, type CmsMenuItem } from './cms-menu-editor';
import { CmsAppearanceEditor } from './cms-appearance-editor';
import { CmsPurchaseDependencyField } from './cms-purchase-dependency-field';
import type { SiteAppearance } from '../../storefront/lib/types';
interface Promo {
  purchaseMethodKind?: PurchaseMethod['kind'];
  eyebrow: string;
  title: string;
  action: string;
  href: string;
  image: string;
  watermark?: string;
}
interface HomeBlock {
  purchaseMethodKind?: PurchaseMethod['kind'];
  id: string;
  kind: 'categories' | 'collection' | 'promotions' | 'products' | 'spotlight' | 'brands' | 'cheque';
  enabled: boolean;
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: string;
  href?: string;
  categoryId?: string;
  limit?: number;
  productIds?: string[];
  items?: Promo[];
  startsAt?: string;
  endsAt?: string;
}
interface SiteData {
  seo?: { title?: string; description?: string; shareImage?: string; allowIndexing?: boolean };
  name: string;
  latinName: string;
  tagline: string;
  announcement: string;
  about: string;
  chequeDisclaimer: string;
  hero: {
    purchaseMethodKind?: PurchaseMethod['kind'];
    eyebrow: string;
    title: string;
    description: string;
    action: string;
    secondary: string;
    image?: string;
    actionHref?: string;
    secondaryHref?: string;
    visualTitle?: string;
    floatingTitle?: string;
    floatingDescription?: string;
    footnote?: string;
  };
  nav: CmsMenuItem[];
  homeBlocks?: HomeBlock[];
  logoUrl?: string;
  font?: 'vazirmatn' | 'system';
  palette?: { primaryLight?: string; primaryDark?: string; heroLight?: string; heroDark?: string };
  appearance?: SiteAppearance;
  contact?: { phone?: string; email?: string; address?: string; hours?: string };
}
export function ContentPage({
  data,
  writable,
  catalog,
  viewerId,
}: {
  data: Content;
  writable: boolean;
  catalog?: Catalog;
  viewerId: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<{
    document: ContentDocument;
    restoreRevisionId?: string;
  } | null>(null);
  const [error, setError] = useState<unknown>();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const document = data.documents.find((d) => `${d.key}/${d.locale}` === selected);
  async function publish(doc: ContentDocument, restoreRevisionId?: string) {
    setBusy(true);
    setError(null);
    try {
      await save(`/admin/content/${doc.key}/${doc.locale}/publish`, {
        version: doc.version,
        restoreRevisionId: restoreRevisionId ?? null,
      });
      await client.invalidateQueries({ queryKey: ['admin'] });
      setReview(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function askPublish(doc: ContentDocument, restoreRevisionId?: string) {
    setError(undefined);
    if (doc.key === 'support') setReview({ document: structuredClone(doc), restoreRevisionId });
    else void publish(doc, restoreRevisionId);
  }
  return (
    <>
      <CmsBlogPosts viewerId={viewerId} writable={writable} />
      <CmsRedirects viewerId={viewerId} writable={writable} />
      <CmsPages viewerId={viewerId} writable={writable} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>محتوای قابل انتشار</h2>
            <p>ذخیره، پیش‌نویس را تغییر می‌دهد. انتشار، نسخهٔ عمومی را به‌روزرسانی می‌کند.</p>
          </div>
        </div>
        <div className="row-buttons">
          {(['fa', 'en'] as const).map((locale) => (
            <button
              type="button"
              key={locale}
              disabled={!writable}
              onClick={() => setSelected('support/' + locale)}
            >
              {locale === 'fa' ? 'ویرایش پشتیبانی فارسی' : 'Edit English support'}
            </button>
          ))}
        </div>
        <ErrorBox error={error} />
        <DataTable
          data={data.documents}
          columns={[
            {
              id: 'key',
              header: 'سند',
              accessorFn: (d) =>
                d.key === 'site'
                  ? 'برند، منو و محتوای سایت'
                  : d.key === 'support'
                    ? 'راهنما و پرسش‌های پشتیبانی'
                    : 'روش‌های ورود مشتری',
            },
            {
              id: 'locale',
              header: 'زبان',
              accessorFn: (d) => (d.locale === 'fa' ? 'فارسی' : 'English'),
            },
            { accessorKey: 'revision', header: 'نسخهٔ منتشرشده' },
            {
              id: 'draft',
              header: 'پیش‌نویس',
              accessorFn: (d) =>
                d.draftJson === d.publishedJson ? 'مطابق انتشار' : 'تغییر منتشرنشده',
            },
            {
              id: 'edit',
              header: 'عملیات',
              cell: ({ row }) => (
                <div className="row-buttons">
                  <button
                    disabled={!writable}
                    className="row-action"
                    onClick={() => setSelected(`${row.original.key}/${row.original.locale}`)}
                  >
                    <Pencil size={15} />
                    ویرایش
                  </button>
                  <button
                    disabled={
                      !writable || busy || row.original.draftJson === row.original.publishedJson
                    }
                    onClick={() => askPublish(row.original)}
                  >
                    انتشار
                  </button>
                </div>
              ),
            },
          ]}
        />
      </section>
      <section className="panel">
        <h2>نسخه‌های انتشار و بازگردانی</h2>
        <DataTable
          data={data.revisions}
          columns={[
            { accessorKey: 'key', header: 'سند' },
            { accessorKey: 'locale', header: 'زبان' },
            { accessorKey: 'revision', header: 'نسخه' },
            {
              id: 'at',
              header: 'زمان انتشار',
              accessorFn: (r) =>
                new Intl.DateTimeFormat('fa-IR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Asia/Tehran',
                }).format(new Date(r.publishedAt)),
            },
            {
              id: 'restore',
              header: 'عملیات',
              cell: ({ row }) => {
                const doc = data.documents.find(
                  (d) => d.key === row.original.key && d.locale === row.original.locale,
                );
                return (
                  <button
                    className="row-action"
                    disabled={!writable || busy || !doc || doc.revision === row.original.revision}
                    onClick={() => doc && askPublish(doc, row.original.id)}
                  >
                    <RotateCcw size={15} />
                    بازگردانی و انتشار
                  </button>
                );
              },
            },
          ]}
        />
      </section>
      <div className="notice">
        در نسخهٔ فعلی، پیامک و تأیید ایمیل پیکربندی نشده‌اند؛ OTP، ثبت‌نام و بازیابی رمز در API
        عمومی غیرفعال می‌مانند، حتی اگر در پیش‌نویس فعال باشند.
      </div>
      {review && (
        <Modal title="بازبینی انتشار پشتیبانی" preventClose={busy} onClose={() => setReview(null)}>
          <SupportContentPreview
            document={review.document}
            restoreRevisionId={review.restoreRevisionId}
            busy={busy}
            error={error}
            onConfirm={() => void publish(review.document, review.restoreRevisionId)}
            onClose={() => setReview(null)}
          />
        </Modal>
      )}
      {selected?.startsWith('support/') ? (
        <Modal
          title={selected === 'support/fa' ? 'محتوای پشتیبانی فارسی' : 'English support content'}
          onClose={() => setSelected(null)}
        >
          <SupportContentEditor
            key={selected}
            document={document}
            locale={selected === 'support/en' ? 'en' : 'fa'}
            onClose={() => setSelected(null)}
          />
        </Modal>
      ) : (
        document && (
          <Modal
            title={`ویرایش ${document.key} · ${document.locale}`}
            onClose={() => setSelected(null)}
          >
            <ContentForm document={document} onClose={() => setSelected(null)} catalog={catalog} />
          </Modal>
        )
      )}
    </>
  );
}

const blockLabels: Record<HomeBlock['kind'], string> = {
  categories: 'دسته‌بندی‌ها',
  collection: 'محصولات منتخب و تب‌ها',
  promotions: 'بنرهای تبلیغاتی',
  products: 'فهرست محصولات',
  spotlight: 'لحظهٔ سایمان · انتخاب‌های ویژه',
  brands: 'برندها',
  cheque: 'معرفی خرید چکی',
};
function localTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function HomeBlocksEditor({
  value,
  onChange,
  catalog,
  disabled,
  onUploadBusy,
}: {
  value: HomeBlock[];
  onChange: (v: HomeBlock[] | ((current: HomeBlock[]) => HomeBlock[])) => void;
  catalog?: Catalog;
  disabled: boolean;
  onUploadBusy: (field: string, busy: boolean) => void;
}) {
  const [kind, setKind] = useState<HomeBlock['kind']>('products');
  const update = (id: string, patch: Partial<HomeBlock>) =>
    onChange(value.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (index: number, direction: number) => {
    const items = [...value];
    [items[index], items[index + direction]] = [items[index + direction], items[index]];
    onChange(items);
  };
  return (
    <fieldset className="home-block-editor" disabled={disabled}>
      <legend>بلوک‌های صفحهٔ خانه</legend>
      <p className="muted">
        ترتیب، متن، مقصد و زمان نمایش هر بخش را تنظیم کنید. تاریخ‌ها در دیتابیس به UTC ذخیره
        می‌شوند.
      </p>
      {value.map((block, index) => (
        <details key={block.id} className="block-editor">
          <summary>
            <strong>
              {(index + 1).toLocaleString('fa-IR')}. {blockLabels[block.kind]}
            </strong>
            <small>
              {block.title || 'بدون عنوان'} · {block.enabled ? 'فعال' : 'غیرفعال'}
            </small>
          </summary>
          <div>
            <div className="block-tools">
              <Check
                label="نمایش بلوک"
                checked={block.enabled}
                onChange={(e) => update(block.id, { enabled: e.target.checked })}
              />
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label="بالا بردن بلوک"
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
                aria-label="پایین بردن بلوک"
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => onChange(value.filter((b) => b.id !== block.id))}
              >
                <Trash2 size={15} />
                حذف بلوک
              </button>
            </div>
            <CmsPurchaseDependencyField
              label="وابستگی نمایش کل بلوک به نوع خرید"
              value={block.purchaseMethodKind}
              onChange={(purchaseMethodKind) => update(block.id, { purchaseMethodKind })}
            />
            <div className="form-grid">
              {(
                [
                  ['eyebrow', 'متن بالای عنوان'],
                  ['title', 'عنوان'],
                  ['action', 'متن دکمه'],
                  ['href', 'مقصد دکمه'],
                ] as const
              ).map(([key, label]) => (
                <Text
                  key={key}
                  label={label}
                  value={block[key] ?? ''}
                  onChange={(text) => update(block.id, { [key]: text || undefined })}
                />
              ))}
            </div>
            <Area
              label="توضیحات"
              value={block.description ?? ''}
              onChange={(description) =>
                update(block.id, { description: description || undefined })
              }
            />
            <div className="form-grid">
              <Text
                type="datetime-local"
                dir="ltr"
                label="شروع نمایش (اختیاری، زمان محلی شما)"
                value={localTime(block.startsAt)}
                onChange={(date) =>
                  update(block.id, { startsAt: date ? new Date(date).toISOString() : undefined })
                }
              />
              <Text
                type="datetime-local"
                dir="ltr"
                label="پایان نمایش (اختیاری)"
                value={localTime(block.endsAt)}
                onChange={(date) =>
                  update(block.id, { endsAt: date ? new Date(date).toISOString() : undefined })
                }
              />
            </div>
            {['collection', 'products', 'spotlight'].includes(block.kind) && (
              <fieldset>
                <legend>
                  {block.kind === 'spotlight'
                    ? 'کالاهای این مجموعه (تا ۲۴ کالا)'
                    : 'انتخاب دستی محصولات (اختیاری، تا ۲۴ کالا)'}
                </legend>
                <small>
                  {block.kind === 'spotlight'
                    ? 'برای فعال‌کردن این بخش، عنوان و دست‌کم یک کالا انتخاب کنید. عضویت در این فهرست، قیمت یا شرایط خرید را تغییر نمی‌دهد.'
                    : 'بدون انتخاب دستی، از محصولات منتخب یا دسته استفاده می‌شود.'}{' '}
                  ترتیب انتخاب، ترتیب نمایش است.
                </small>
                <ProductPicker
                  value={block.productIds ?? []}
                  onChange={(productIds) => update(block.id, { productIds })}
                />
              </fieldset>
            )}
            {(block.kind === 'products' || block.kind === 'spotlight') && (
              <div className="form-grid">
                <Field label="دستهٔ محصولات">
                  <select
                    value={block.categoryId ?? ''}
                    onChange={(e) => update(block.id, { categoryId: e.target.value || undefined })}
                  >
                    <option value="">همهٔ دسته‌ها</option>
                    {catalog?.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {nameOf(c)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Text
                  label="تعداد نمایش (۱ تا ۲۴)"
                  type="number"
                  value={block.limit ?? 4}
                  onChange={(v) => update(block.id, { limit: Number(v) })}
                />
              </div>
            )}
            {block.kind === 'promotions' && (
              <fieldset>
                <legend>بنرها</legend>
                {block.items?.map((promo, i) => (
                  <fieldset key={i}>
                    <legend>بنر {(i + 1).toLocaleString('fa-IR')}</legend>
                    <CmsPurchaseDependencyField
                      label={`وابستگی نمایش بنر ${(i + 1).toLocaleString('fa-IR')} به نوع خرید`}
                      value={promo.purchaseMethodKind}
                      onChange={(purchaseMethodKind) =>
                        update(block.id, {
                          items: block.items?.map((item, position) =>
                            position === i ? { ...item, purchaseMethodKind } : item,
                          ),
                        })
                      }
                    />
                    <div className="form-grid">
                      {(
                        [
                          ['eyebrow', 'متن بالا'],
                          ['title', 'عنوان'],
                          ['action', 'متن دکمه'],
                          ['href', 'مقصد داخلی'],
                          ['watermark', 'متن تزئینی'],
                        ] as const
                      ).map(([key, label]) => (
                        <Text
                          key={key}
                          label={label}
                          value={promo[key] ?? ''}
                          onChange={(text) =>
                            update(block.id, {
                              items: block.items?.map((p, n) =>
                                n === i ? { ...p, [key]: text } : p,
                              ),
                            })
                          }
                          required={key !== 'watermark'}
                        />
                      ))}
                    </div>
                    <ImageEditor
                      label={`تصویر بنر ${(i + 1).toLocaleString('fa-IR')}`}
                      max={1}
                      allowExternal={false}
                      disabled={disabled}
                      value={promo.image ? [promo.image] : []}
                      onBusy={(busy) => onUploadBusy(block.id + ':' + i, busy)}
                      onChange={(urls) =>
                        onChange((current) =>
                          current.map((entry) =>
                            entry.id === block.id
                              ? {
                                  ...entry,
                                  items: entry.items?.map((item, position) =>
                                    position === i ? { ...item, image: urls[0] ?? '' } : item,
                                  ),
                                }
                              : entry,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        update(block.id, { items: block.items?.filter((_, n) => n !== i) })
                      }
                    >
                      حذف بنر
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={(block.items?.length ?? 0) >= 6}
                  onClick={() =>
                    update(block.id, {
                      items: [
                        ...(block.items ?? []),
                        { eyebrow: '', title: '', action: '', href: '/catalog', image: '' },
                      ],
                    })
                  }
                >
                  <Plus size={15} />
                  بنر جدید
                </button>
              </fieldset>
            )}
          </div>
        </details>
      ))}
      <div className="block-add">
        <select
          aria-label="نوع بلوک جدید"
          value={kind}
          onChange={(e) => setKind(e.target.value as HomeBlock['kind'])}
        >
          {Object.entries(blockLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={value.length >= 20}
          onClick={() =>
            onChange([
              ...value,
              {
                id: crypto.randomUUID(),
                kind,
                enabled: false,
                limit: kind === 'products' || kind === 'spotlight' ? 4 : undefined,
                ...(kind === 'spotlight'
                  ? { title: '', href: '/moments', action: 'دیدن همهٔ انتخاب‌ها', productIds: [] }
                  : {}),
              },
            ])
          }
        >
          <Plus size={16} />
          افزودن بلوک
        </button>
      </div>
    </fieldset>
  );
}
function ContentForm({
  document,
  onClose,
  catalog,
}: {
  document: ContentDocument;
  onClose: () => void;
  catalog?: Catalog;
}) {
  const [value, set] = useState<SiteData | Record<string, boolean>>(() =>
    JSON.parse(document.draftJson),
  );
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api(`/admin/content/${document.key}/${document.locale}`, {
        method: 'PUT',
        body: JSON.stringify({ content: value, version: document.version }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
  });
  const site = value as SiteData;
  const uploads = useCmsImageUploads();
  return (
    <form
      dir={document.locale === 'en' ? 'ltr' : 'rtl'}
      onSubmit={(e) => {
        e.preventDefault();
        if (!uploads.isBusy() && !mutation.isPending) mutation.mutate();
      }}
    >
      <ErrorBox error={mutation.error} />
      {uploads.busy && (
        <p role="status">آماده‌سازی تصویر در جریان است؛ پس از پایان، پیش‌نویس را ذخیره کنید.</p>
      )}
      <fieldset disabled={mutation.isPending || uploads.busy}>
        {document.key === 'auth' ? (
          <div className="auth-settings">
            {Object.entries({
              mobileOtp: 'ورود با پیامک',
              emailPassword: 'ورود با ایمیل و رمز',
              usernamePassword: 'ورود با نام کاربری و رمز',
              registration: 'ثبت‌نام',
              passwordReset: 'بازیابی رمز',
            }).map(([key, label]) => (
              <Check
                key={key}
                label={label}
                checked={(value as Record<string, boolean>)[key]}
                onChange={(e) => set({ ...value, [key]: e.target.checked })}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="form-grid">
              {(
                [
                  ['name', 'نام فروشگاه'],
                  ['latinName', 'نام لاتین'],
                  ['tagline', 'شعار'],
                  ['announcement', 'نوار اطلاع‌رسانی'],
                ] as const
              ).map(([key, label]) => (
                <Text
                  key={key}
                  label={label}
                  value={site[key]}
                  onChange={(text) => set({ ...site, [key]: text })}
                  required
                />
              ))}
            </div>
            <fieldset>
              <legend>هویت بصری و تماس</legend>
              <div className="form-grid">
                <ImageEditor
                  label="لوگوی فروشگاه — اختیاری"
                  max={1}
                  allowExternal={false}
                  disabled={mutation.isPending}
                  value={site.logoUrl ? [site.logoUrl] : []}
                  onBusy={(busy) => uploads.setBusy('logo', busy)}
                  onChange={(urls) =>
                    set((previous) => {
                      const current = previous as SiteData;
                      return { ...current, logoUrl: urls[0] || undefined };
                    })
                  }
                />
                <Field label="فونت">
                  <select
                    value={site.font ?? 'vazirmatn'}
                    onChange={(e) =>
                      set({ ...site, font: e.target.value as 'vazirmatn' | 'system' })
                    }
                  >
                    <option value="vazirmatn">Vazirmatn</option>
                    <option value="system">System</option>
                  </select>
                </Field>
                {(
                  [
                    ['primaryLight', 'رنگ اصلی روشن', '#425b36'],
                    ['primaryDark', 'رنگ اصلی تاریک', '#b9cf9e'],
                    ['heroLight', 'پس‌زمینهٔ بنر روشن', '#e5ead8'],
                    ['heroDark', 'پس‌زمینهٔ بنر تاریک', '#293b24'],
                  ] as const
                ).map(([key, label, fallback]) => (
                  <Text
                    key={key}
                    label={label}
                    type="color"
                    value={site.palette?.[key] ?? fallback}
                    onChange={(color) =>
                      set({ ...site, palette: { ...site.palette, [key]: color } })
                    }
                  />
                ))}
                {(
                  [
                    ['phone', 'تلفن (ارقام انگلیسی)'],
                    ['email', 'ایمیل تماس'],
                    ['address', 'نشانی'],
                    ['hours', 'ساعت پاسخ‌گویی'],
                  ] as const
                ).map(([key, label]) => (
                  <Text
                    key={key}
                    label={label}
                    value={site.contact?.[key] ?? ''}
                    onChange={(text) =>
                      set({ ...site, contact: { ...site.contact, [key]: text || undefined } })
                    }
                  />
                ))}
              </div>
              <button type="button" onClick={() => set({ ...site, palette: undefined })}>
                بازگشت به رنگ‌های پیش‌فرض
              </button>
            </fieldset>
            <CmsAppearanceEditor
              value={site.appearance}
              name={site.name}
              onChange={(appearance) => set({ ...site, appearance })}
            />
            <Area
              label="دربارهٔ فروشگاه"
              value={site.about}
              onChange={(about) => set({ ...site, about })}
            />
            <Area
              label="توضیح شرایط چک"
              value={site.chequeDisclaimer}
              onChange={(chequeDisclaimer) => set({ ...site, chequeDisclaimer })}
            />
            <fieldset>
              <legend>محتوای ابتدای صفحه</legend>
              <CmsPurchaseDependencyField
                label="وابستگی نمایش کل محتوای ابتدای صفحه به نوع خرید"
                value={site.hero.purchaseMethodKind}
                onChange={(purchaseMethodKind) =>
                  set({ ...site, hero: { ...site.hero, purchaseMethodKind } })
                }
              />
              {(
                [
                  ['eyebrow', 'متن بالای عنوان'],
                  ['title', 'عنوان اصلی'],
                  ['description', 'توضیحات'],
                  ['action', 'متن دکمهٔ اصلی'],
                  ['secondary', 'متن دکمهٔ دوم'],
                ] as const
              ).map(([key, label]) => (
                <Text
                  key={key}
                  label={label}
                  value={site.hero[key]}
                  onChange={(text) => set({ ...site, hero: { ...site.hero, [key]: text } })}
                />
              ))}
            </fieldset>
            <fieldset>
              <legend>تصویر و مسیرهای ابتدای صفحه</legend>
              <ImageEditor
                label="تصویر ابتدای صفحه"
                max={1}
                allowExternal={false}
                disabled={mutation.isPending}
                value={site.hero.image ? [site.hero.image] : []}
                onBusy={(busy) => uploads.setBusy('hero', busy)}
                onChange={(urls) =>
                  set((previous) => {
                    const current = previous as SiteData;
                    return { ...current, hero: { ...current.hero, image: urls[0] || undefined } };
                  })
                }
              />
              <div className="form-grid">
                {(
                  [
                    ['actionHref', 'مقصد دکمه اصلی'],
                    ['secondaryHref', 'مقصد دکمه دوم'],
                    ['visualTitle', 'متن تزئینی'],
                    ['floatingTitle', 'عنوان کارت روی تصویر'],
                    ['floatingDescription', 'متن کارت روی تصویر'],
                    ['footnote', 'متن پایین عنوان'],
                  ] as const
                ).map(([key, label]) => (
                  <Text
                    key={key}
                    label={label}
                    value={site.hero[key] ?? ''}
                    onChange={(text) =>
                      set({ ...site, hero: { ...site.hero, [key]: text || undefined } })
                    }
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>نمایش در جست‌وجو و شبکه‌های اجتماعی</legend>
              <Text
                label="عنوان صفحهٔ اصلی (اختیاری)"
                value={site.seo?.title ?? ''}
                onChange={(title) =>
                  set({ ...site, seo: { ...site.seo, title: title || undefined } })
                }
              />
              <Area
                label="توضیح صفحهٔ اصلی (حداکثر ۴۰۰ حرف)"
                value={site.seo?.description ?? ''}
                onChange={(description) =>
                  set({ ...site, seo: { ...site.seo, description: description || undefined } })
                }
              />
              <ImageEditor
                label="تصویر اشتراک عمومی — اختیاری"
                max={1}
                allowExternal={false}
                disabled={mutation.isPending}
                value={site.seo?.shareImage ? [site.seo.shareImage] : []}
                onBusy={(busy) => uploads.setBusy('share', busy)}
                onChange={(urls) =>
                  set((previous) => {
                    const current = previous as SiteData;
                    return {
                      ...current,
                      seo: { ...current.seo, shareImage: urls[0] || undefined },
                    };
                  })
                }
              />
              <Check
                label="اجازهٔ نمایه‌سازی این زبان پس از افتتاح"
                checked={site.seo?.allowIndexing ?? false}
                onChange={(e) =>
                  set({ ...site, seo: { ...site.seo, allowIndexing: e.target.checked } })
                }
              />
              <small>
                فعال‌شدن عمومی علاوه بر انتشار این تنظیم به دامنهٔ HTTPS، مجوز محیط و خروج API از
                حالت نمونه نیاز دارد.
              </small>
            </fieldset>
            <HomeBlocksEditor
              value={site.homeBlocks ?? []}
              onChange={(homeBlocks) =>
                set((previous) => {
                  const current = previous as SiteData;
                  return {
                    ...current,
                    homeBlocks:
                      typeof homeBlocks === 'function'
                        ? homeBlocks(current.homeBlocks ?? [])
                        : homeBlocks,
                  };
                })
              }
              catalog={catalog}
              disabled={mutation.isPending || uploads.busy}
              onUploadBusy={(field, busy) => uploads.setBusy('banner:' + field, busy)}
            />
            <fieldset>
              <legend>منوی سایت</legend>
              <CmsMenuEditor
                value={site.nav}
                locale={document.locale}
                categories={catalog?.categories}
                onChange={(nav) => set({ ...site, nav })}
              />
            </fieldset>
          </>
        )}
      </fieldset>
      <div className="form-actions">
        <button className="primary" disabled={mutation.isPending || uploads.busy} type="submit">
          {uploads.busy
            ? 'در حال آماده‌سازی تصویر…'
            : mutation.isPending
              ? 'در حال ذخیره…'
              : 'ذخیره تغییرات'}
        </button>
        <button onClick={onClose} type="button" disabled={mutation.isPending || uploads.busy}>
          انصراف
        </button>
        <small>پس از ذخیره از جدول، انتشار را انتخاب کنید.</small>
      </div>
    </form>
  );
}

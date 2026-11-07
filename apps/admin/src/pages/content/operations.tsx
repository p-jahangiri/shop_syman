import { CmsBlogPosts } from '../../features/content/cms-blog-posts';
import { CmsRedirects } from '../../features/content/cms-redirects';
import { CmsPages } from '../../features/content/cms-pages';
import {
  SiteTranslationFields,
  translatedBlocks,
  translatedMenu,
} from '../../features/content/site-translation-fields';
import { HomeSearchPreview } from '../../features/content/home-search-preview';
import { ImageEditor } from '../../features/media/media';
import { useCmsImageUploads } from '../../features/content/cms-image-uploads';
import { SupportContentPreview } from '../../features/content/support-content-preview';
import { SupportContentEditor } from '../../features/content/support-content-editor';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, RotateCcw, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';

import { api, save } from '../../api/api';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { DataTable } from '../../components/tables/ui-table';
import { ProductPicker } from '../../features/catalog/product-picker';
import { Area, Text } from '../../components/forms/forms';
import {
  nameOf,
  type Catalog,
  type Content,
  type ContentDocument,
  type PurchaseMethod,
} from '../../types/types';
import { CmsMenuEditor, type CmsMenuItem } from '../../features/content/cms-menu-editor';
import { filterRetiredSourcingMenu } from '@sayman/web-shared/lib/market/retired-sourcing.ts';
import { CmsAppearanceEditor } from '../../features/content/cms-appearance-editor';
import { CmsPaletteEditor } from '../../features/content/cms-palette-editor';
import {
  readPublishedIdentity,
  socialPublicationChanges,
  StoreIdentityEditor,
} from '../../features/content/store-identity-editor';
import {
  socialLabels,
  storeIdentitySchema,
  type StoreIdentity,
} from '@sayman/web-shared/lib/content/store-identity.ts';
import { CmsPurchaseDependencyField } from '../../features/content/cms-purchase-dependency-field';
import { CustomerAuthSettingsEditor } from '../../features/content/customer-auth-settings-editor';
import { hasSupportedCustomerLogin } from '../../features/content/customer-auth-settings';
import type {
  HomeBlock,
  SiteAppearance,
  SiteContent,
} from '@sayman/web-shared/lib/shared/types.ts';
import {
  cmsWorkspaceSections,
  type CmsWorkspaceSection,
} from '../../features/content/cms-workspace-sections';
import '../../styles/content/cms-workspace.css';
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
  font?: SiteContent['font'];
  palette?: SiteContent['palette'];
  appearance?: SiteAppearance;
  contact?: { phone?: string; email?: string; address?: string; hours?: string };
  storeIdentity?: StoreIdentity;
}
export function ContentPage({
  data,
  dataLoading,
  dataError,
  onRetry,
  settingsReadable,
  writable,
  draftWritable,
  activeSection,
  onSectionChange,
  catalog,
  viewerId,
}: {
  data?: Content;
  dataLoading: boolean;
  dataError: unknown;
  onRetry: () => void;
  settingsReadable: boolean;
  writable: boolean;
  draftWritable: boolean;
  activeSection: CmsWorkspaceSection;
  onSectionChange: (section: CmsWorkspaceSection) => void;
  catalog?: Catalog;
  viewerId: string;
}) {
  const sections = (Object.keys(cmsWorkspaceSections) as CmsWorkspaceSection[]).filter(
    (section) => settingsReadable || section === 'articles' || section === 'pages',
  );
  const visible = sections.includes(activeSection) ? activeSection : 'articles';
  return (
    <div className="cms-workspace">
      <section className="panel cms-workspace-nav">
        <div className="section-heading">
          <div>
            <h2>میز کار محتوا</h2>
            <p>{cmsWorkspaceSections[visible].description}</p>
          </div>
          <span className="tag">
            {writable ? 'ویرایش و انتشار' : draftWritable ? 'آماده‌سازی پیش‌نویس' : 'مشاهده'}
          </span>
        </div>
        <nav className="row-buttons" aria-label="بخش‌های مدیریت محتوا">
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              className={visible === id ? 'primary' : undefined}
              aria-current={visible === id ? 'true' : undefined}
              onClick={() => onSectionChange(id)}
            >
              {cmsWorkspaceSections[id].label}
            </button>
          ))}
        </nav>
      </section>
      <div hidden={visible !== 'articles'}>
        <CmsBlogPosts viewerId={viewerId} writable={draftWritable} publishable={writable} />
      </div>
      <div hidden={visible !== 'pages'}>
        <CmsPages viewerId={viewerId} writable={draftWritable} publishable={writable} />
      </div>
      {settingsReadable && (
        <div hidden={visible !== 'redirects'}>
          <CmsRedirects viewerId={viewerId} writable={writable} />
        </div>
      )}
      {settingsReadable && (
        <div hidden={visible !== 'settings' && visible !== 'history'}>
          {data ? (
            <ContentSettings
              data={data}
              writable={writable}
              catalog={catalog}
              showHistory={visible === 'history'}
            />
          ) : dataLoading ? (
            <Busy />
          ) : (
            <>
              <ErrorBox error={dataError} />
              <button type="button" onClick={onRetry}>
                تلاش دوباره
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const documentLabels = {
  site: 'تنظیمات مشترک فروشگاه',
  support: 'راهنما و پرسش‌های پشتیبانی',
  auth: 'روش‌های ورود مشتری',
} as const;

function settingsLabel(document: Pick<ContentDocument, 'key' | 'locale'>) {
  return document.key === 'site' && document.locale === 'en'
    ? 'ترجمهٔ انگلیسی سایت'
    : documentLabels[document.key];
}

function settingsScope(document: Pick<ContentDocument, 'key' | 'locale'>) {
  if (document.key === 'auth' || (document.key === 'site' && document.locale === 'fa'))
    return 'مشترک';
  return document.locale === 'fa' ? 'فارسی' : 'English';
}

function ContentSettings({
  data,
  writable,
  catalog,
  showHistory,
}: {
  data: Content;
  writable: boolean;
  catalog?: Catalog;
  showHistory: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [review, setReview] = useState<{
    document: ContentDocument;
    restoreRevisionId?: string;
    section?: 'socialLinks';
  } | null>(null);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState('');
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const document = data.documents.find((d) => `${d.key}/${d.locale}` === selected);
  const sharedSite = data.documents.find((d) => d.key === 'site' && d.locale === 'fa');
  const missingSupport = (['fa', 'en'] as const).filter(
    (locale) => !data.documents.some((item) => item.key === 'support' && item.locale === locale),
  );
  async function publish({
    document: doc,
    restoreRevisionId,
    section,
  }: NonNullable<typeof review>) {
    if (!writable || busy) return;
    setBusy(true);
    setError(null);
    try {
      await save(`/admin/content/${doc.key}/${doc.locale}/publish`, {
        version: doc.version,
        restoreRevisionId: restoreRevisionId ?? null,
        ...(section && { section }),
      });
      await client.invalidateQueries({ queryKey: ['admin'] });
      setSuccess(
        section ? 'شبکه‌های اجتماعی هر دو زبان فروشگاه به‌روز شد.' : 'نسخهٔ عمومی سند به‌روز شد.',
      );
      setReview(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function askPublish(
    doc: ContentDocument,
    options: Omit<NonNullable<typeof review>, 'document'> = {},
  ) {
    setError(undefined);
    setSuccess('');
    setReview({ document: structuredClone(doc), ...options });
  }
  const socialChanges =
    review?.section === 'socialLinks'
      ? socialPublicationChanges(review.document.draftJson, review.document.publishedJson)
      : [];
  return (
    <>
      <section className="panel" hidden={showHistory}>
        <div className="section-heading">
          <div>
            <h2>تنظیمات و ترجمه‌های فروشگاه</h2>
            <p>
              ظاهر، منو، راه‌های ارتباطی و چیدمان خانه یک تنظیم مشترک دارند. متن انگلیسی جدا ویرایش
              می‌شود.
            </p>
          </div>
        </div>
        {!review && <ErrorBox error={error} />}
        {success && <p role="status">{success}</p>}
        <DataTable
          data={data.documents}
          columns={[
            {
              id: 'key',
              header: 'سند',
              accessorFn: settingsLabel,
            },
            {
              id: 'social-links',
              header: 'شبکه‌های اجتماعی',
              cell: ({ row: { original } }) => {
                if (original.key !== 'site' || original.locale !== 'fa') return '—';
                const active = readPublishedIdentity(original.publishedJson).socialLinks ?? [];
                const changes = socialPublicationChanges(
                  original.draftJson,
                  original.publishedJson,
                );
                return (
                  <div className="cms-contact-status">
                    <span>
                      {active.length
                        ? active.map((link) => socialLabels[link.platform].fa).join('، ')
                        : 'بدون لینک عمومی'}
                    </span>
                    {changes.length > 0 && <small>تغییر در انتظار انتشار</small>}
                  </div>
                );
              },
            },
            {
              id: 'locale',
              header: 'دامنه',
              accessorFn: settingsScope,
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
                    {row.original.key === 'site' && row.original.locale === 'fa'
                      ? 'انتشار مشترک'
                      : 'انتشار'}
                  </button>
                  {row.original.key === 'site' &&
                    row.original.locale === 'fa' &&
                    row.original.publishedJson &&
                    socialPublicationChanges(row.original.draftJson, row.original.publishedJson)
                      .length > 0 && (
                      <button
                        type="button"
                        disabled={!writable || busy}
                        onClick={() => askPublish(row.original, { section: 'socialLinks' })}
                      >
                        انتشار شبکه‌های اجتماعی
                      </button>
                    )}
                </div>
              ),
            },
          ]}
        />
        {writable && missingSupport.length > 0 && (
          <div className="row-buttons">
            {missingSupport.map((locale) => (
              <button type="button" key={locale} onClick={() => setSelected('support/' + locale)}>
                {locale === 'fa' ? 'ساخت محتوای پشتیبانی فارسی' : 'ساخت محتوای پشتیبانی انگلیسی'}
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="panel" hidden={!showHistory}>
        <div className="section-heading">
          <div>
            <h2>نسخه‌های انتشار و بازگردانی</h2>
            <p>بازگردانی یک نسخهٔ قبلی را به‌عنوان نسخهٔ عمومی تازه منتشر می‌کند.</p>
          </div>
          <Field label="محدودهٔ تاریخچه">
            <select value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)}>
              <option value="all">همهٔ سندها و زبان‌ها</option>
              {Object.entries(documentLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!review && <ErrorBox error={error} />}
        <DataTable
          data={data.revisions.filter(
            (item) => historyFilter === 'all' || item.key === historyFilter,
          )}
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
                    onClick={() => doc && askPublish(doc, { restoreRevisionId: row.original.id })}
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
      <div className="notice" hidden={showHistory}>
        روش‌های ورود از سند فارسی مدیریت و پس از انتشار اعمال می‌شوند. ارسال پیامک به تنظیم سرویس،
        کلید و قالب در «پیامک و کد ورود» نیاز دارد؛ ثبت‌نام تنها پس از تأیید واقعی شماره انجام
        می‌شود. بازیابی رمز همچنان غیرفعال است.
      </div>
      {review && (
        <Modal
          title={
            review.section === 'socialLinks'
              ? 'بازبینی انتشار شبکه‌های اجتماعی'
              : review.restoreRevisionId
                ? 'تأیید بازگردانی تنظیمات'
                : 'بازبینی انتشار تنظیمات'
          }
          preventClose={busy}
          onClose={() => setReview(null)}
        >
          {review.restoreRevisionId &&
            review.document.draftJson !== review.document.publishedJson && (
              <p className="notice" role="alert">
                این سند پیش‌نویس منتشرنشده دارد. بازگردانی، نسخهٔ عمومی و پیش‌نویس همین سند را با
                نسخهٔ انتخابی جایگزین می‌کند.
              </p>
            )}
          {review.document.key === 'support' ? (
            <SupportContentPreview
              document={review.document}
              restoreRevisionId={review.restoreRevisionId}
              busy={busy}
              error={error}
              onConfirm={() => void publish(review)}
              onClose={() => setReview(null)}
            />
          ) : (
            <>
              <p>
                {settingsLabel(review.document)} · {settingsScope(review.document)}
              </p>
              {review.section === 'socialLinks' ? (
                <>
                  <p>
                    لینک‌های زیر در پانوشت و صفحهٔ پشتیبانی هر دو زبان به‌روز می‌شوند. بقیهٔ تغییرات
                    برای بازبینی در پیش‌نویس می‌مانند.
                  </p>
                  <ul className="cms-contact-review">
                    {socialChanges.map(({ platform, current, previous }) => (
                      <li key={platform}>
                        <strong>{socialLabels[platform].fa}</strong>
                        {previous && <del dir="ltr">{previous}</del>}
                        {current ? <bdi>{current}</bdi> : <span>از فروشگاه برداشته می‌شود</span>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>
                  {review.restoreRevisionId
                    ? 'نسخهٔ انتخابی دوباره در فروشگاه منتشر می‌شود.'
                    : 'با تأیید، پیش‌نویس ذخیره‌شدهٔ همین سند در فروشگاه اعمال می‌شود.'}
                </p>
              )}
              <ErrorBox error={error} />
              <div className="row-buttons">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void publish(review)}
                >
                  {review.restoreRevisionId ? 'بازگردانی و انتشار' : 'تأیید انتشار'}
                </button>
                <button type="button" disabled={busy} onClick={() => setReview(null)}>
                  بازگشت
                </button>
              </div>
            </>
          )}
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
          <Modal title={settingsLabel(document)} onClose={() => setSelected(null)}>
            <ContentForm
              document={document}
              sharedSite={sharedSite}
              onClose={() => setSelected(null)}
              catalog={catalog}
            />
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
  if (!Number.isFinite(d.getTime())) return 'invalid-date';
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
                  update(block.id, {
                    startsAt: date
                      ? Number.isFinite(new Date(date).getTime())
                        ? new Date(date).toISOString()
                        : 'invalid-date'
                      : undefined,
                  })
                }
              />
              <Text
                type="datetime-local"
                dir="ltr"
                label="پایان نمایش (اختیاری)"
                value={localTime(block.endsAt)}
                onChange={(date) =>
                  update(block.id, {
                    endsAt: date
                      ? Number.isFinite(new Date(date).getTime())
                        ? new Date(date).toISOString()
                        : 'invalid-date'
                      : undefined,
                  })
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
  sharedSite,
  onClose,
  catalog,
}: {
  document: ContentDocument;
  sharedSite?: ContentDocument;
  onClose: () => void;
  catalog?: Catalog;
}) {
  const translationOnly = document.key === 'site' && document.locale === 'en';
  const common = useMemo<SiteData | undefined>(
    () => (translationOnly && sharedSite ? JSON.parse(sharedSite.draftJson) : undefined),
    [translationOnly, sharedSite],
  );
  const [value, set] = useState<SiteData | Record<string, boolean>>(() => {
    const draft = JSON.parse(document.draftJson);
    if (common) {
      draft.nav = translatedMenu(common.nav, draft.nav);
      draft.homeBlocks = translatedBlocks(common.homeBlocks, draft.homeBlocks);
    }
    return document.key === 'site' && Array.isArray(draft.nav)
      ? { ...draft, nav: filterRetiredSourcingMenu(draft.nav) }
      : draft;
  });
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
  const authUsable =
    document.key !== 'auth' || hasSupportedCustomerLogin(value as Record<string, boolean>);
  const identityUsable =
    document.key !== 'site' || storeIdentitySchema.safeParse(site.storeIdentity ?? {}).success;
  const titleLength = site.seo?.title?.length ?? 0;
  const descriptionLength = site.seo?.description?.length ?? 0;
  const seoUsable = titleLength <= 150 && descriptionLength <= 400;
  const uploads = useCmsImageUploads();
  return (
    <form
      dir={document.locale === 'en' ? 'ltr' : 'rtl'}
      onSubmit={(e) => {
        e.preventDefault();
        if (!uploads.isBusy() && !mutation.isPending && authUsable && identityUsable && seoUsable)
          mutation.mutate();
      }}
    >
      <ErrorBox error={mutation.error} />
      {uploads.busy && (
        <p role="status">آماده‌سازی تصویر در جریان است؛ پس از پایان، پیش‌نویس را ذخیره کنید.</p>
      )}
      <fieldset disabled={mutation.isPending || uploads.busy}>
        {document.key === 'auth' ? (
          <CustomerAuthSettingsEditor value={value as Record<string, boolean>} onChange={set} />
        ) : (
          <>
            {translationOnly ? (
              <p dir="rtl" className="notice">
                این فرم برای متن انگلیسی است. برای تغییر ظاهر، مقصد و ترتیب منو یا چیدمان خانه،
                تنظیمات مشترک را باز کنید.
              </p>
            ) : (
              <nav className="row-buttons cms-form-sections" aria-label="بخش‌های سند فروشگاه">
                <a href="#cms-site-brand">هویت بصری</a>
                <a href="#cms-site-palette">رنگ فروشگاه</a>
                <a href="#cms-site-contact">راه‌های ارتباطی و مجوزها</a>
                <a href="#cms-site-home">صفحهٔ اصلی</a>
                <a href="#cms-site-seo">جست‌وجو و اشتراک</a>
                <a href="#cms-site-nav">منو</a>
              </nav>
            )}
            <div className="form-grid">
              {(
                [
                  ['name', 'نام فروشگاه'],
                  ['latinName', 'نام لاتین'],
                  ['tagline', 'شعار'],
                  ['announcement', 'نوار اطلاع‌رسانی'],
                ] as const
              )
                .filter(([key]) => !translationOnly || key !== 'latinName')
                .map(([key, label]) => (
                  <Text
                    key={key}
                    label={label}
                    value={site[key]}
                    onChange={(text) => set({ ...site, [key]: text })}
                    required
                  />
                ))}
            </div>
            {!translationOnly && (
              <>
                <fieldset id="cms-site-brand">
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
                    <Field label="فونت فروشگاه" hint="وزیرمتن و Noto از خود سایت بارگیری می‌شوند.">
                      <select
                        value={site.font ?? 'vazirmatn'}
                        onChange={(e) =>
                          set({ ...site, font: e.target.value as SiteContent['font'] })
                        }
                      >
                        <option value="vazirmatn">وزیرمتن</option>
                        <option value="noto-arabic">Noto Sans Arabic</option>
                        <option value="system">فونت دستگاه</option>
                      </select>
                    </Field>
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
                </fieldset>
                <CmsPaletteEditor
                  value={site.palette}
                  onChange={(palette) => set({ ...site, palette })}
                  disabled={mutation.isPending || uploads.busy}
                />
                <CmsAppearanceEditor
                  value={site.appearance}
                  font={site.font}
                  name={site.name}
                  onChange={(appearance) => set({ ...site, appearance })}
                />
                <div id="cms-site-contact">
                  <StoreIdentityEditor
                    value={site.storeIdentity}
                    published={readPublishedIdentity(document.publishedJson)}
                    locale={document.locale}
                    disabled={mutation.isPending || uploads.busy}
                    onBusy={uploads.setBusy}
                    onChange={(storeIdentity) =>
                      set((previous) => ({ ...previous, storeIdentity }) as SiteData)
                    }
                    onBadgeImageChange={(id, imageUrl) =>
                      set((previous) => {
                        const current = previous as SiteData;
                        return {
                          ...current,
                          storeIdentity: {
                            ...current.storeIdentity,
                            badges: current.storeIdentity?.badges?.map((badge) =>
                              badge.id === id ? { ...badge, imageUrl } : badge,
                            ),
                          },
                        };
                      })
                    }
                  />
                </div>
              </>
            )}
            {translationOnly && (
              <div className="form-grid">
                {(['address', 'hours'] as const).map((key) => (
                  <Text
                    key={key}
                    label={key === 'address' ? 'Address' : 'Hours'}
                    value={site.contact?.[key] ?? ''}
                    onChange={(text) =>
                      set({ ...site, contact: { ...site.contact, [key]: text || undefined } })
                    }
                  />
                ))}
              </div>
            )}
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
            <fieldset id="cms-site-home">
              <legend>محتوای ابتدای صفحه</legend>
              {!translationOnly && (
                <CmsPurchaseDependencyField
                  label="وابستگی نمایش کل محتوای ابتدای صفحه به نوع خرید"
                  value={site.hero.purchaseMethodKind}
                  onChange={(purchaseMethodKind) =>
                    set({ ...site, hero: { ...site.hero, purchaseMethodKind } })
                  }
                />
              )}
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
              <legend>
                {translationOnly ? 'متن‌های تکمیلی ابتدای صفحه' : 'تصویر و مسیرهای ابتدای صفحه'}
              </legend>
              {!translationOnly && (
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
              )}
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
                )
                  .filter(([key]) => !translationOnly || !key.endsWith('Href'))
                  .map(([key, label]) => (
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
            <fieldset id="cms-site-seo">
              <legend>نمایش در جست‌وجو و شبکه‌های اجتماعی</legend>
              <HomeSearchPreview
                draft={
                  translationOnly
                    ? { ...site, seo: { ...site.seo, allowIndexing: common?.seo?.allowIndexing } }
                    : site
                }
                publishedJson={document.publishedJson}
                sharedPublishedJson={translationOnly ? sharedSite?.publishedJson : undefined}
                locale={document.locale}
              />
              <Field
                label="عنوان صفحهٔ اصلی (اختیاری)"
                hint={`${titleLength.toLocaleString('fa-IR')} از ۱۵۰ حرف`}
                error={titleLength > 150 ? 'عنوان را به ۱۵۰ حرف یا کمتر برسانید.' : undefined}
              >
                <input
                  value={site.seo?.title ?? ''}
                  onChange={(e) =>
                    set({ ...site, seo: { ...site.seo, title: e.target.value || undefined } })
                  }
                />
              </Field>
              <Field
                label="توضیح صفحهٔ اصلی (اختیاری)"
                hint={`${descriptionLength.toLocaleString('fa-IR')} از ۴۰۰ حرف`}
                error={descriptionLength > 400 ? 'توضیح را به ۴۰۰ حرف یا کمتر برسانید.' : undefined}
              >
                <textarea
                  value={site.seo?.description ?? ''}
                  onChange={(e) =>
                    set({ ...site, seo: { ...site.seo, description: e.target.value || undefined } })
                  }
                  rows={3}
                />
              </Field>
              {!translationOnly && (
                <>
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
                    label="اجازهٔ نمایه‌سازی هر دو زبان پس از افتتاح"
                    checked={site.seo?.allowIndexing ?? false}
                    onChange={(e) =>
                      set({ ...site, seo: { ...site.seo, allowIndexing: e.target.checked } })
                    }
                  />
                  <small>
                    فعال‌شدن عمومی علاوه بر انتشار این تنظیم به دامنهٔ HTTPS، مجوز محیط و خروج API
                    از حالت نمونه نیاز دارد.
                  </small>
                </>
              )}
            </fieldset>
            {translationOnly ? (
              <SiteTranslationFields
                nav={site.nav}
                blocks={site.homeBlocks ?? []}
                onNavChange={(nav) => set({ ...site, nav })}
                onBlocksChange={(homeBlocks) => set({ ...site, homeBlocks })}
              />
            ) : (
              <>
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
                <fieldset id="cms-site-nav">
                  <legend>منوی سایت</legend>
                  <CmsMenuEditor
                    value={filterRetiredSourcingMenu(site.nav)}
                    locale={document.locale}
                    categories={catalog?.categories}
                    onChange={(nav) => set({ ...site, nav })}
                  />
                </fieldset>
              </>
            )}
          </>
        )}
      </fieldset>
      <div className="form-actions">
        <button
          className="primary"
          disabled={
            mutation.isPending || uploads.busy || !authUsable || !identityUsable || !seoUsable
          }
          type="submit"
        >
          {uploads.busy
            ? 'در حال آماده‌سازی تصویر…'
            : mutation.isPending
              ? 'در حال ذخیره…'
              : 'ذخیرهٔ پیش‌نویس'}
        </button>
        <button onClick={onClose} type="button" disabled={mutation.isPending || uploads.busy}>
          انصراف
        </button>
        <small>پس از ذخیره از جدول، انتشار را انتخاب کنید.</small>
      </div>
    </form>
  );
}

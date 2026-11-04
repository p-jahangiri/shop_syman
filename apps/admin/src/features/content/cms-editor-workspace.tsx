import { useEffect, useRef, useState } from 'react';
import { AdminTable } from '../../components/tables/admin-table';
import { cmsLanguageReady, cmsPublicationStatus } from './cms-editor-model';
import { Busy, Modal } from '../../components/ui';
import type { CmsPageContent } from '@sayman/web-shared/lib/content/cms-page-contract.ts';
import '../../styles/content/cms-editor-workspace.css';

const date = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tehran',
});
const locales = ['fa', 'en'] as const;
const localeLabels = { fa: 'فارسی', en: 'انگلیسی' };
export const formatCmsWorkspaceDate = (value: string) => date.format(new Date(value));

type ContentRecord = {
  id: string;
  slug: string;
  isDemo: boolean;
  publication: number;
  publishedRevisionId: string | null;
  updatedAt: string;
};

export function CmsContentList({
  rows,
  loading,
  kind,
  selected,
  blocked,
  onSelect,
}: {
  rows?: ContentRecord[];
  loading: boolean;
  kind: 'صفحه' | 'مقاله';
  selected: string | null;
  blocked: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading) return <Busy />;
  if (!rows) return null;
  return (
    <AdminTable aria-label={`فهرست ${kind}‌ها`}>
      <thead>
        <tr>
          <th>نشانی ثابت</th>
          <th>وضعیت انتشار</th>
          <th>نوع محتوا</th>
          <th>آخرین تغییر</th>
          <th>عملیات</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <bdi>{row.slug}</bdi>
            </td>
            <td>
              <span className={row.publishedRevisionId ? 'badge good' : 'badge'}>
                {cmsPublicationStatus(row.publication, row.publishedRevisionId)}
              </span>
            </td>
            <td>{row.isDemo ? 'نمونهٔ توسعه' : 'محتوای فروشگاه'}</td>
            <td data-sort-value={Date.parse(row.updatedAt)}>
              <time dateTime={row.updatedAt}>{formatCmsWorkspaceDate(row.updatedAt)}</time>
            </td>
            <td>
              <button
                type="button"
                disabled={blocked || selected === row.id}
                aria-label={`باز کردن ${kind} ${row.slug}`}
                aria-pressed={selected === row.id}
                onClick={() => onSelect(row.id)}
              >
                {selected === row.id ? 'در حال بررسی' : 'باز کردن'}
              </button>
            </td>
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <td colSpan={5}>هنوز {kind}‌ای ساخته نشده است.</td>
          </tr>
        )}
      </tbody>
    </AdminTable>
  );
}

export function CmsPublicationSummary({
  draft,
  authorReady,
  dirty,
  publishable,
  publication,
  publishedRevisionId,
  publishedLinks,
}: {
  draft: CmsPageContent;
  authorReady?: boolean;
  dirty: boolean;
  publishable: boolean;
  publication: number;
  publishedRevisionId: string | null;
  publishedLinks: Record<'fa' | 'en', string>;
}) {
  return (
    <div className="cms-publication-summary">
      <div className="section-heading">
        <div>
          <h3>وضعیت پیش‌نویس و انتشار</h3>
          <p>
            {cmsPublicationStatus(publication, publishedRevisionId)}
            {publication > 0 && ` · نسخهٔ ${publication.toLocaleString('fa-IR')}`}
          </p>
        </div>
        {publishedRevisionId && (
          <div className="row-buttons">
            {locales.map((locale) => (
              <a key={locale} href={publishedLinks[locale]} target="_blank" rel="noreferrer">
                دیدن نسخهٔ عمومی {localeLabels[locale]}
              </a>
            ))}
          </div>
        )}
      </div>
      <ul className="cms-language-readiness" aria-label="آمادگی پیش‌نویس ذخیره‌شده">
        {locales.map((locale) => (
          <li key={locale}>
            <strong>{localeLabels[locale]}</strong>
            {draft[locale].title.trim() && <bdi dir="auto">{draft[locale].title}</bdi>}
            <span>
              {cmsLanguageReady(draft[locale]) ? 'آماده' : 'عنوان و حداقل یک بلوک لازم است'}
            </span>
          </li>
        ))}
        {authorReady !== undefined && (
          <li>
            <strong>نویسندهٔ عمومی</strong>
            <span>{authorReady ? 'آماده' : 'نوع نویسنده و نام در هر دو زبان لازم است'}</span>
          </li>
        )}
      </ul>
      {dirty && (
        <p role="status">
          تغییرهای فرم را ذخیره کنید تا بتوانید انتشار یا بازگردانی را بازبینی کنید.
        </p>
      )}
      {!publishable && <p>انتشار، لغو انتشار و بازگردانی به دسترسی ناشر محتوا نیاز دارد.</p>}
    </div>
  );
}

export function useCmsEditorNavigation() {
  const [dirty, setDirty] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [nextAction, setNextAction] = useState<(() => void) | null>(null);
  function navigate(action: () => void) {
    if (dirty) setNextAction(() => action);
    else action();
  }
  function discard() {
    if (!nextAction) return;
    setDirty(false);
    setEpoch((value) => value + 1);
    setNextAction(null);
    nextAction();
  }
  return {
    dirty,
    setDirty,
    epoch,
    navigate,
    discard,
    nextAction,
    cancel: () => setNextAction(null),
  };
}

export function CmsEditorHeading({
  label,
  blocked,
  onClose,
}: {
  label: string;
  blocked: boolean;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="section-heading cms-editor-actions">
      <h3 ref={heading} tabIndex={-1}>
        {label}
      </h3>
      <button type="button" disabled={blocked} onClick={onClose}>
        بستن ویرایشگر
      </button>
    </div>
  );
}

export function CmsDiscardDialog({ cancel, discard }: { cancel: () => void; discard: () => void }) {
  return (
    <Modal title="تغییرهای ذخیره‌نشده" onClose={cancel}>
      <p>اگر ادامه دهید، تغییرهای ذخیره‌نشدهٔ این فرم کنار گذاشته می‌شوند.</p>
      <div className="row-buttons">
        <button type="button" className="primary" onClick={cancel}>
          ادامهٔ ویرایش
        </button>
        <button type="button" onClick={discard}>
          کنار گذاشتن تغییرها
        </button>
      </div>
    </Modal>
  );
}

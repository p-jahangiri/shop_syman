import { useEffect, useState } from 'react';
import { api } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, ErrorBox } from '../../components/ui';
import type { ContentDocument } from '../../types/types';
import { purchaseDependencyNames } from './cms-purchase-dependency-field';
import {
  supportContentDraftSchema,
  readSupportContentRevision,
  type SupportContentDraft,
} from '@sayman/web-shared/lib/content/support-content-contract.ts';
export function SupportContentPreview({
  document,
  restoreRevisionId,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  document: ContentDocument;
  restoreRevisionId?: string;
  busy: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<SupportContentDraft | null>(null),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState<unknown>();
  useEffect(() => {
    const abort = new AbortController(),
      revision = adminViewRevision();
    let active = true;
    setValue(null);
    setLoading(true);
    setFailure(undefined);
    void (async () => {
      try {
        const content = restoreRevisionId
          ? readSupportContentRevision(
              await api<unknown>(
                `/admin/content/support/${document.locale}/revisions/${restoreRevisionId}`,
                { signal: abort.signal },
              ),
              document.locale,
              restoreRevisionId,
            ).content
          : supportContentDraftSchema.parse(JSON.parse(document.draftJson));
        if (active && !abort.signal.aborted && revision === adminViewRevision()) setValue(content);
      } catch (error) {
        if (active && !abort.signal.aborted) setFailure(error);
      } finally {
        if (active && !abort.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      active = false;
      abort.abort();
    };
  }, [document.locale, document.draftJson, restoreRevisionId]);
  return (
    <div className="support-content-preview" dir={document.locale === 'fa' ? 'rtl' : 'ltr'}>
      <p>
        {restoreRevisionId
          ? 'نسخهٔ تاریخی زیر در همین زبان بازگردانی و به‌عنوان انتشار تازه ثبت می‌شود.'
          : 'پیش‌نویس زیر در همین زبان منتشر می‌شود. پس از بازبینی، انتشار را تأیید کنید.'}
      </p>
      <ErrorBox error={error ?? failure} />
      {loading ? (
        <Busy />
      ) : (
        value && (
          <>
            <p className="notice">
              {value.isDemo
                ? 'محتوای نمونهٔ توسعه؛ در محیط واقعی نمایش داده نمی‌شود.'
                : 'این متن به‌عنوان محتوای عمومی فروشگاه منتشر می‌شود.'}
            </p>
            <span>{value.eyebrow}</span>
            <h2>{value.title}</h2>
            <p className="preserve-lines">{value.description}</p>
            <p>متن دکمهٔ تیکت: {value.ticketsAction}</p>
            <h3>{value.faqTitle}</h3>
            <p className="preserve-lines">{value.faqDescription}</p>
            <p>
              {value.faqs.filter((x) => x.enabled).length.toLocaleString('fa-IR')} پرسش فعال در سند؛
              وابستگی نوع خرید در نمایش عمومی نیز بررسی می‌شود.
            </p>
            {value.faqs.map((faq, index) => (
              <article key={faq.id}>
                <strong>
                  {(index + 1).toLocaleString('fa-IR')}. {faq.question}
                </strong>
                <small>
                  {!faq.enabled
                    ? 'غیرفعال؛ در پاسخ عمومی نیست'
                    : faq.purchaseMethodKind
                      ? `نمایش پس از انتشار، مشروط به فعال‌بودن حداقل یک روش ${purchaseDependencyNames[faq.purchaseMethodKind]}`
                      : 'فعال؛ بدون وابستگی به نوع خرید'}
                </small>
                <p className="preserve-lines">{faq.answer}</p>
              </article>
            ))}
          </>
        )
      )}
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || loading || !value || !!failure}
          onClick={onConfirm}
        >
          {busy
            ? 'در حال انتشار…'
            : restoreRevisionId
              ? 'تأیید بازگردانی و انتشار همین نسخه'
              : 'تأیید انتشار همین پیش‌نویس'}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          انصراف
        </button>
      </div>
      <small>
        نسخهٔ مرورشده ثابت است. اگر سرور تغییر کرده یا نتیجه نامشخص بود، ابتدا فهرست را بازخوانی
        کنید؛ انتشار دوبارهٔ نسخهٔ قدیمی مجاز نیست.
      </small>
    </div>
  );
}

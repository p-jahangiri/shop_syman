import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/api';
import { Check, ErrorBox, Field } from '../../components/ui';
import { FormActions } from '../../components/forms/forms';
import { CmsPurchaseDependencyField } from './cms-purchase-dependency-field';
import type { ContentDocument } from '../../types/types';
import {
  supportContentDraftSchema,
  emptySupportContent,
  type SupportContentDraft,
} from '@sayman/web-shared/lib/content/support-content-contract.ts';
export function SupportContentEditor({
  document,
  locale,
  onClose,
}: {
  document?: ContentDocument;
  locale: 'fa' | 'en';
  onClose: () => void;
}) {
  const [baseline] = useState(() => {
    try {
      return {
        version: document?.version ?? null,
        value: document
          ? supportContentDraftSchema.parse(JSON.parse(document.draftJson))
          : emptySupportContent(locale),
      };
    } catch {
      return null;
    }
  });
  const [value, setValue] = useState<SupportContentDraft | null>(baseline?.value ?? null),
    [error, setError] = useState<unknown>();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (content: SupportContentDraft) =>
      api(`/admin/content/support/${locale}`, {
        method: 'PUT',
        body: JSON.stringify({ content, version: baseline!.version }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (failure) => setError(failure),
  });
  if (!value || !baseline)
    return (
      <p role="alert">
        پیش‌نویس معتبر خوانده نشد؛ پنجره را ببندید و پس از بازخوانی محتوا دوباره باز کنید. سند موجود
        با نمونه جایگزین نشده است.
      </p>
    );
  const update = (patch: Partial<SupportContentDraft>) => setValue({ ...value, ...patch });
  function save(event: React.FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    const normalized = value && {
      ...value,
      ...Object.fromEntries(
        fields.map(([key]) => [key, value[key].replace(/\r\n?/g, '\n').trim()]),
      ),
      faqs: value.faqs.map((f) => ({
        ...f,
        question: f.question.trim(),
        answer: f.answer.replace(/\r\n?/g, '\n').trim(),
      })),
    };
    const parsed = supportContentDraftSchema.safeParse(normalized);
    if (!parsed.success) {
      setError(
        Error(
          'متن‌ها، شناسه‌های یکتا و محدودیت۳۰پرسش را بررسی کنید. سؤال و پاسخ پرسش غیرفعال نیز باید تکمیل باشد.',
        ),
      );
      return;
    }
    setError(undefined);
    mutation.mutate(parsed.data);
  }
  const fields = [
    ['eyebrow', 'متن بالای عنوان', 140],
    ['title', 'عنوان صفحه', 200],
    ['description', 'توضیح صفحه', 1000],
    ['ticketsAction', 'متن دکمهٔ تیکت', 100],
    ['faqTitle', 'عنوان پرسش‌های متداول', 150],
    ['faqDescription', 'توضیح پرسش‌های متداول', 1000],
  ] as const;
  const move = (index: number, direction: number) => {
    const items = [...value.faqs];
    [items[index], items[index + direction]] = [items[index + direction], items[index]];
    update({ faqs: items });
  };
  return (
    <form onSubmit={save} className="support-content-editor" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <p>
        ذخیره فقط پیش‌نویس همین زبان را تغییر می‌دهد. انتشار و بازگردانی از فهرست محتوا انجام
        می‌شوند؛ شرایط واقعی فروشگاه را بنویسید.
      </p>
      <ErrorBox error={error} />
      {error instanceof ApiError &&
        (error.status === 0 || error.status >= 500 || error.status === 409) && (
          <p role="status">
            ممکن است نسخهٔ سرور تغییر کرده باشد. پیش از ارسال دوباره، پنجره را ببندید و فهرست را
            بازخوانی کنید؛ نسخهٔ این فرم ثابت نگه داشته شده است.
          </p>
        )}
      <fieldset disabled={mutation.isPending}>
        <Check
          label="محتوای نمونهٔ توسعه؛ در محیط واقعی نمایش داده نشود"
          checked={value.isDemo}
          onChange={(e) => update({ isDemo: e.target.checked })}
        />
        <div className="form-grid">
          {fields.map(([key, label, max]) => (
            <Field key={key} label={label}>
              {key === 'description' || key === 'faqDescription' ? (
                <textarea
                  rows={3}
                  value={value[key]}
                  maxLength={max}
                  onChange={(e) => update({ [key]: e.target.value })}
                />
              ) : (
                <input
                  value={value[key]}
                  maxLength={max}
                  required={['title', 'ticketsAction', 'faqTitle'].includes(key)}
                  onChange={(e) => update({ [key]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
        {value.faqs.map((faq, index) => {
          const number = (index + 1).toLocaleString('fa-IR'),
            change = (patch: Partial<typeof faq>) =>
              update({ faqs: value.faqs.map((x) => (x.id === faq.id ? { ...x, ...patch } : x)) });
          return (
            <fieldset key={faq.id}>
              <legend>پرسش {number}</legend>
              <Check
                label={`نمایش پرسش ${number} در نسخهٔ منتشرشده`}
                checked={faq.enabled}
                onChange={(e) => change({ enabled: e.target.checked })}
              />
              <CmsPurchaseDependencyField
                label={`وابستگی نمایش پرسش ${number} به نوع خرید`}
                value={faq.purchaseMethodKind}
                onChange={(purchaseMethodKind) => change({ purchaseMethodKind })}
              />
              <Field label={`متن سؤال ${number}`}>
                <input
                  value={faq.question}
                  maxLength={240}
                  required
                  onChange={(e) => change({ question: e.target.value })}
                />
              </Field>
              <Field label={`متن پاسخ ${number}`}>
                <textarea
                  rows={5}
                  value={faq.answer}
                  maxLength={4000}
                  required
                  onChange={(e) => change({ answer: e.target.value })}
                />
              </Field>
              <div className="row-buttons">
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                  بالا بردن پرسش {number}
                </button>
                <button
                  type="button"
                  disabled={index === value.faqs.length - 1}
                  onClick={() => move(index, 1)}
                >
                  پایین بردن پرسش {number}
                </button>
                <button
                  type="button"
                  onClick={() => update({ faqs: value.faqs.filter((x) => x.id !== faq.id) })}
                >
                  حذف پرسش {number}
                </button>
              </div>
            </fieldset>
          );
        })}
        <button
          type="button"
          disabled={value.faqs.length >= 30}
          onClick={() =>
            update({
              faqs: [
                ...value.faqs,
                {
                  id: crypto.randomUUID().replaceAll('-', ''),
                  question: '',
                  answer: '',
                  enabled: false,
                },
              ],
            })
          }
        >
          افزودن پرسش
        </button>
      </fieldset>
      <FormActions pending={mutation.isPending} onClose={onClose}>
        <small>
          پرسش غیرفعال یا وابسته به نوع خرید خاموش، در پاسخ عمومی نمایش داده نمی‌شود؛ متن و سابقهٔ
          آن حفظ می‌شود. متن‌ها به‌صورت ساده نمایش داده می‌شوند.
        </small>
      </FormActions>
    </form>
  );
}

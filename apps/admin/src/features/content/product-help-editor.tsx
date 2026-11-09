import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, save } from '../../api/api';
import { Busy, ErrorBox, Field } from '../../components/ui';
import { ProductPicker } from '../catalog/product-picker';

type Question = { question: string; answer: string };
type Help = {
  accessoriesEnabled: boolean;
  accessoryIds: string[];
  questions: Question[];
  isDemo: boolean;
};
type HelpDocument = { draftJson: string; publishedJson?: string | null; version: string };
type Draft = { development: boolean; document: HelpDocument | null };
const blank = (): Help => ({
  accessoriesEnabled: false,
  accessoryIds: [],
  questions: [],
  isDemo: false,
});
const read = (value?: string | null) => (value ? (JSON.parse(value) as Help) : blank());

export function ProductHelpEditor({ viewerId, writable }: { viewerId: string; writable: boolean }) {
  const [selected, select] = useState<string[]>([]);
  const [locale, setLocale] = useState<'fa' | 'en'>('fa');
  const id = selected[0];
  const query = useQuery({
    queryKey: ['admin', 'product-help', viewerId, id, locale],
    queryFn: ({ signal }) => api<Draft>(`/admin/content/product-help/${locale}/${id}`, { signal }),
    enabled: Boolean(id),
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>پرسش‌وپاسخ و لوازم سازگار</h2>
          <p>
            یک کالا انتخاب کنید. لوازمِ فعال و قابل خرید فقط پس از انتشار در صفحهٔ همان کالا دیده
            می‌شوند.
          </p>
        </div>
      </div>
      <ProductPicker value={selected} onChange={select} maximum={1} label="انتخاب کالای اصلی" />
      {id && (
        <>
          <Field label="زبان پرسش و پاسخ">
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value === 'en' ? 'en' : 'fa')}
            >
              <option value="fa">فارسی</option>
              <option value="en">انگلیسی</option>
            </select>
          </Field>
          {query.isPending ? (
            <Busy />
          ) : query.error ? (
            <>
              <ErrorBox error={query.error} />
              <button type="button" onClick={() => void query.refetch()}>
                تلاش دوباره
              </button>
            </>
          ) : (
            query.data && (
              <ProductHelpForm
                key={`${id}:${locale}:${query.data.document?.version ?? 'new'}`}
                id={id}
                locale={locale}
                source={query.data}
                writable={writable}
                onRefresh={async () => {
                  const next = await query.refetch();
                  if (next.isError) throw next.error;
                }}
              />
            )
          )}
        </>
      )}
    </section>
  );
}

function ProductHelpForm({
  id,
  locale,
  source,
  writable,
  onRefresh,
}: {
  id: string;
  locale: 'fa' | 'en';
  source: Draft;
  writable: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [value, setValue] = useState<Help>(() => read(source.document?.draftJson));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const initial = read(source.document?.draftJson);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const draftDiffers = Boolean(
    source.document && source.document.draftJson !== source.document.publishedJson,
  );
  const path = `/admin/content/product-help-${id}/${locale}`;
  const valid =
    !value.accessoryIds.includes(id) &&
    value.questions.every((row) => row.question.trim() && row.answer.trim());
  const updateQuestion = (index: number, field: keyof Question, newValue: string) =>
    setValue((old) => ({
      ...old,
      questions: old.questions.map((row, i) => (i === index ? { ...row, [field]: newValue } : row)),
    }));
  async function submit(publish: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      if (publish) {
        if (!source.document || dirty) return;
        await save(path + '/publish', { version: source.document.version });
      } else {
        await save(
          path,
          {
            version: source.document?.version ?? null,
            content: {
              ...value,
              questions: value.questions.map((row) => ({
                question: row.question.trim(),
                answer: row.answer.trim(),
              })),
            },
          },
          'PUT',
        );
      }
      await onRefresh();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cms-editor-workspace">
      <p role="status">
        {dirty
          ? 'تغییرهای ذخیره‌نشده'
          : draftDiffers
            ? 'پیش‌نویس ذخیره شده و آمادهٔ انتشار است.'
            : source.document
              ? 'مطابق نسخهٔ منتشرشده'
              : 'هنوز تنظیمی برای این کالا ثبت نشده است.'}
      </p>
      <fieldset disabled={!writable || busy}>
        {locale === 'fa' && (
          <section className="panel">
            <h3>خریدت را کامل کن</h3>
            <label>
              <input
                type="checkbox"
                checked={value.accessoriesEnabled}
                onChange={(e) =>
                  setValue((old) => ({ ...old, accessoriesEnabled: e.target.checked }))
                }
              />{' '}
              نمایش لوازم سازگار
            </label>
            <p>سازگاری را با مدل کالا بررسی کنید. انتخاب لوازم برای هر دو زبان مشترک است.</p>
            <ProductPicker
              value={value.accessoryIds}
              maximum={8}
              excluded={id}
              label="انتخاب لوازم سازگار"
              onChange={(accessoryIds) => setValue((old) => ({ ...old, accessoryIds }))}
            />
          </section>
        )}
        <section className="panel">
          <h3>پرسش و پاسخ عمومی</h3>
          <p>
            پرسش‌های دریافتی در صندوق پشتیبانی‌اند. پاسخ مفید را بدون اطلاعات شخصی مشتری اینجا منتشر
            کنید.
          </p>
          {value.questions.map((row, index) => (
            <div className="form-grid" key={index}>
              <Field label={`پرسش ${index + 1}`}>
                <input
                  maxLength={240}
                  value={row.question}
                  onChange={(e) => updateQuestion(index, 'question', e.target.value)}
                />
              </Field>
              <Field label={`پاسخ ${index + 1}`}>
                <textarea
                  maxLength={1200}
                  rows={3}
                  value={row.answer}
                  onChange={(e) => updateQuestion(index, 'answer', e.target.value)}
                />
              </Field>
              <button
                type="button"
                onClick={() =>
                  setValue((old) => ({
                    ...old,
                    questions: old.questions.filter((_, i) => i !== index),
                  }))
                }
              >
                حذف پرسش {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={value.questions.length >= 10}
            onClick={() =>
              setValue((old) => ({
                ...old,
                questions: [...old.questions, { question: '', answer: '' }],
              }))
            }
          >
            افزودن پرسش
          </button>
        </section>
        {source.development && (
          <section className="panel">
            <label>
              <input
                type="checkbox"
                checked={value.isDemo}
                onChange={(e) => setValue((old) => ({ ...old, isDemo: e.target.checked }))}
              />{' '}
              محتوای نمونهٔ توسعه
            </label>
            <p>
              نمونهٔ منتشرشده با نشانی دارای <bdi>?examples=1</bdi> دیده می‌شود.
            </p>
            <button
              type="button"
              disabled={value.questions.length > 0}
              onClick={() =>
                setValue((old) => ({
                  ...old,
                  isDemo: true,
                  questions:
                    locale === 'fa'
                      ? [
                          {
                            question: 'قیمت کدام رنگ را می‌بینم؟',
                            answer: 'با انتخاب رنگ و حافظه، قیمت همان تنوع نشان داده می‌شود.',
                          },
                          {
                            question: 'چطور دربارهٔ سازگاری بپرسم؟',
                            answer: 'مدل دستگاه را از دکمهٔ «از سایمان بپرس» برای کارشناس بفرستید.',
                          },
                        ]
                      : [
                          {
                            question: 'Which variant price is shown?',
                            answer: 'Select a color and storage option to see its own price.',
                          },
                          {
                            question: 'How do I ask about compatibility?',
                            answer: 'Use Ask Sayman and include the exact model of your device.',
                          },
                        ],
                }))
              }
            >
              افزودن دو پرسش نمونه
            </button>
          </section>
        )}
        <div className="row-buttons">
          <button
            type="button"
            className="primary"
            disabled={!dirty || !valid}
            onClick={() => void submit(false)}
          >
            ذخیرهٔ پیش‌نویس
          </button>
          <button type="button" disabled={dirty || !draftDiffers} onClick={() => void submit(true)}>
            انتشار نسخهٔ ذخیره‌شده
          </button>
        </div>
      </fieldset>
      <ErrorBox error={error} />
    </div>
  );
}

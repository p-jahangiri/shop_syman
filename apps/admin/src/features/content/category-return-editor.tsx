import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/api';
import { ErrorBox } from '../../components/ui';
import { nameOf, type Catalog, type ContentDocument } from '../../types/types';
import {
  categoryReturnDocumentSchema,
  categoryReturnGuidanceLimit,
  categoryReturnTextLimit,
  type CategoryReturnGuidance,
} from '@sayman/web-shared/lib/content/category-return-guidance.ts';

export function CategoryReturnEditor({
  document,
  locale,
  catalog,
  onClose,
}: {
  document?: ContentDocument;
  locale: 'fa' | 'en';
  catalog?: Catalog;
  onClose: () => void;
}) {
  const [version] = useState(document?.version ?? null);
  const [items, setItems] = useState<CategoryReturnGuidance | null>(() => {
    if (!document) return [];
    try {
      return categoryReturnDocumentSchema.parse(JSON.parse(document.draftJson)).items;
    } catch {
      return null;
    }
  });
  const [invalid, setInvalid] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (items: CategoryReturnGuidance) =>
      api(`/admin/content/category-returns/${locale}`, {
        method: 'PUT',
        body: JSON.stringify({ content: { items }, version }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
  });
  if (!items) return <p role="alert">پیش‌نویس خوانده نشد. پنجره را ببندید و دوباره باز کنید.</p>;

  const categories = catalog?.categories.filter((category) => category.isActive) ?? [];
  const available = categories.filter(
    (category) => !items.some((row) => row.categoryId === category.id),
  );
  const labels = new Map(categories.map((category) => [category.id, nameOf(category)]));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (mutation.isPending) return;
        const parsed = categoryReturnDocumentSchema.safeParse({
          items: items.map((row) => ({ ...row, text: row.text.replace(/\r\n?/g, '\n').trim() })),
        });
        setInvalid(!parsed.success);
        if (parsed.success) mutation.mutate(parsed.data.items);
      }}
    >
      <p>
        متن هر دسته پس از انتشار همین سند، کنار خرید کالاهای آن دسته دیده می‌شود. مهلت و امکان ثبت
        درخواست از بخش «درخواست‌های مرجوعی» مدیریت می‌شود.
      </p>
      {!catalog && (
        <p role="status">فهرست دسته‌ها در دسترس نیست. متن دسته‌های قبلی قابل ویرایش است.</p>
      )}
      {invalid && <p role="alert">برای هر دسته یک متن معتبر تا ۱۰۰۰ نویسه وارد کنید.</p>}
      <ErrorBox error={mutation.error} />
      <fieldset disabled={mutation.isPending}>
        <legend>{locale === 'fa' ? 'شرایط فارسی دسته‌ها' : 'شرایط انگلیسی دسته‌ها'}</legend>
        {items.map((item, index) => (
          <fieldset key={item.categoryId} className="catalog-return-rule">
            <legend>{labels.get(item.categoryId) ?? item.categoryId}</legend>
            <label>
              متن مرجوعی
              <textarea
                dir={locale === 'fa' ? 'rtl' : 'ltr'}
                rows={4}
                maxLength={categoryReturnTextLimit}
                required
                value={item.text}
                onChange={(event) =>
                  setItems(
                    items.map((row, i) =>
                      i === index ? { ...row, text: event.target.value } : row,
                    ),
                  )
                }
              />
            </label>
            <button type="button" onClick={() => setItems(items.filter((_, i) => i !== index))}>
              <Trash2 size={15} aria-hidden="true" /> حذف متن این دسته
            </button>
          </fieldset>
        ))}
        <CategoryPicker
          categories={available}
          disabled={!available.length || items.length >= categoryReturnGuidanceLimit}
          onAdd={(categoryId) => setItems([...items, { categoryId, text: '' }])}
        />
      </fieldset>
      <div className="row-buttons">
        <button type="submit" className="primary" disabled={mutation.isPending}>
          ذخیرهٔ پیش‌نویس
        </button>
        <button type="button" onClick={onClose} disabled={mutation.isPending}>
          بستن
        </button>
      </div>
    </form>
  );
}

function CategoryPicker({
  categories,
  disabled,
  onAdd,
}: {
  categories: Catalog['categories'];
  disabled: boolean;
  onAdd: (id: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const value = categories.some((category) => category.id === selected)
    ? selected
    : (categories[0]?.id ?? '');
  return (
    <div className="row-buttons">
      <select
        aria-label="دسته‌بندی برای افزودن شرایط"
        value={value}
        onChange={(event) => setSelected(event.target.value)}
        disabled={disabled}
      >
        {!categories.length && <option value="">دستهٔ دیگری برای افزودن نیست</option>}
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {nameOf(category)}
          </option>
        ))}
      </select>
      <button type="button" disabled={disabled} onClick={() => onAdd(value)}>
        <Plus size={15} aria-hidden="true" /> افزودن دسته
      </button>
    </div>
  );
}

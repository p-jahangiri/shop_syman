import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/api';
import { Busy, ErrorBox, Modal } from '../../components/ui';
import { nameOf, type Catalog } from '../../types/types';
import {
  warrantyLibrarySchema,
  warrantyTemplateLimit,
  warrantyTemplatesPath,
  warrantyTemplatesQuery,
  type WarrantyTemplate,
} from './warranty-templates';

export function WarrantyLibraryEditor({
  categories,
  onClose,
}: {
  categories: Catalog['categories'];
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: warrantyTemplatesQuery,
    queryFn: async ({ signal }) =>
      warrantyLibrarySchema.parse(await api(warrantyTemplatesPath, { signal })),
  });
  return (
    <Modal title="الگوهای گارانتی" onClose={onClose}>
      {query.isPending && <Busy />}
      <ErrorBox error={query.error} />
      {query.isError && (
        <button type="button" onClick={() => void query.refetch()}>
          تلاش دوباره
        </button>
      )}
      {query.data && (
        <WarrantyLibraryForm initial={query.data} categories={categories} onClose={onClose} />
      )}
    </Modal>
  );
}

function WarrantyLibraryForm({
  initial,
  categories,
  onClose,
}: {
  initial: ReturnType<typeof warrantyLibrarySchema.parse>;
  categories: Catalog['categories'];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (value: typeof initial) =>
      api(warrantyTemplatesPath, { method: 'PUT', body: JSON.stringify(value) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: warrantyTemplatesQuery });
      onClose();
    },
  });
  function update(id: string, changes: Partial<WarrantyTemplate>) {
    setDraft((old) => ({
      ...old,
      items: old.items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    }));
  }
  function setDefault(id: string, categoryId: string, checked: boolean) {
    setDraft((old) => ({
      ...old,
      items: old.items.map((item) => ({
        ...item,
        defaultCategoryIds: [
          ...item.defaultCategoryIds.filter(
            (value) => value !== categoryId || (!checked && item.id !== id),
          ),
          ...(checked && item.id === id ? [categoryId] : []),
        ],
      })),
    }));
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending) return;
        const parsed = warrantyLibrarySchema.safeParse({
          ...draft,
          items: draft.items.map((item) => ({
            ...item,
            nameFa: item.nameFa.trim(),
            nameEn: item.nameEn.trim(),
            detailsFa: item.detailsFa.replace(/\r\n?/g, '\n').trim(),
            detailsEn: item.detailsEn.replace(/\r\n?/g, '\n').trim(),
          })),
        });
        setInvalid(!parsed.success);
        if (parsed.success) save.mutate(parsed.data);
      }}
    >
      <p>
        هر الگو را به دسته‌های مرتبط وصل کنید. برای هر دسته می‌توانید یک الگوی پیش‌فرض داشته باشید.
        هنگام ثبت کالا، متن انتخاب‌شده روی هر تنوع ذخیره می‌شود.
      </p>
      <ErrorBox error={save.error} />
      {invalid && <p role="alert">نام فارسی و دست‌کم یک دسته را برای هر الگو وارد کنید.</p>}
      <fieldset disabled={save.isPending}>
        <legend>فهرست گارانتی‌ها</legend>
        {draft.items.map((item) => (
          <fieldset key={item.id}>
            <legend>{item.nameFa || 'الگوی تازه'}</legend>
            <div className="form-grid">
              <label className="field">
                نام گارانتی
                <input
                  required
                  maxLength={120}
                  value={item.nameFa}
                  onChange={(event) => update(item.id, { nameFa: event.target.value })}
                />
              </label>
              <label className="field">
                نام انگلیسی
                <input
                  dir="ltr"
                  maxLength={120}
                  value={item.nameEn}
                  onChange={(event) => update(item.id, { nameEn: event.target.value })}
                />
              </label>
              <label className="field">
                توضیح و مدت گارانتی
                <textarea
                  rows={3}
                  maxLength={1600}
                  value={item.detailsFa}
                  onChange={(event) => update(item.id, { detailsFa: event.target.value })}
                />
              </label>
              <label className="field">
                توضیح انگلیسی
                <textarea
                  dir="ltr"
                  rows={3}
                  maxLength={1600}
                  value={item.detailsEn}
                  onChange={(event) => update(item.id, { detailsEn: event.target.value })}
                />
              </label>
            </div>
            <fieldset>
              <legend>دسته‌های مرتبط</legend>
              {categories
                .filter((category) => category.isActive || item.categoryIds.includes(category.id))
                .map((category) => {
                  const linked = item.categoryIds.includes(category.id);
                  return (
                    <div className="row-buttons" key={category.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={linked}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            update(item.id, {
                              categoryIds: checked
                                ? [...item.categoryIds, category.id]
                                : item.categoryIds.filter((id) => id !== category.id),
                              defaultCategoryIds: checked
                                ? item.defaultCategoryIds
                                : item.defaultCategoryIds.filter((id) => id !== category.id),
                            });
                          }}
                        />{' '}
                        {nameOf(category)}
                      </label>
                      {linked && (
                        <label>
                          <input
                            type="checkbox"
                            checked={item.defaultCategoryIds.includes(category.id)}
                            onChange={(event) =>
                              setDefault(item.id, category.id, event.target.checked)
                            }
                          />{' '}
                          پیش‌فرض این دسته
                        </label>
                      )}
                    </div>
                  );
                })}
            </fieldset>
            <button
              type="button"
              onClick={() =>
                setDraft((old) => ({
                  ...old,
                  items: old.items.filter((row) => row.id !== item.id),
                }))
              }
            >
              <Trash2 size={15} aria-hidden="true" /> حذف الگو
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={draft.items.length >= warrantyTemplateLimit}
          onClick={() =>
            setDraft((old) => ({
              ...old,
              items: [
                ...old.items,
                {
                  id: crypto.randomUUID().replaceAll('-', ''),
                  nameFa: '',
                  nameEn: '',
                  detailsFa: '',
                  detailsEn: '',
                  categoryIds: [],
                  defaultCategoryIds: [],
                },
              ],
            }))
          }
        >
          <Plus size={16} aria-hidden="true" /> افزودن گارانتی
        </button>
      </fieldset>
      <div className="row-buttons">
        <button type="submit" className="primary" disabled={save.isPending}>
          ذخیرهٔ الگوها
        </button>
        <button type="button" onClick={onClose} disabled={save.isPending}>
          بستن
        </button>
      </div>
    </form>
  );
}

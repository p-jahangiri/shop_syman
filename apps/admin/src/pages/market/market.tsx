import { AdminTable } from '../../components/tables/admin-table';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, save } from '../../api/api';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import { Text, Translations } from '../../components/forms/forms';
import { ImageEditor } from '../../features/media/media';
import { nameOf, type Catalog, type AttributeDefinition } from '../../types/types';
import {
  marketPageSchema,
  marketDetailSchema,
  marketSavedSchema,
  marketModelSchema,
  marketListPath,
  normalizeMarketDigits,
  type MarketDetails,
  type MarketModelInput,
  type ModelAttribute,
} from '../../api/contracts/market/market-contract';
import { MarketImport } from '../../features/market/market-import';
import { MarketSourceCsvImport } from '../../features/market/market-source-csv';
import {
  MarketSourceFields,
  MarketPublicationField,
} from '../../features/market/market-source-fields';
import {
  marketPhoneScope,
  newMarketPhoneModel,
  newMarketPhoneDetails,
} from '../../features/market/market-phone-defaults';
import { MarketPhoneConfigurations } from '../../features/market/market-phone-configurations';
import { readMarketPhoneJournal } from '../../state/market/market-phone-journal';
import { MarketSourcesManager } from '../../features/market/market-sources';
import { readSourceJournal } from '../../state/market/market-source-journal';
const labels = { Draft: 'پیش‌نویس', Published: 'منتشرشده در بازار', Hidden: 'پنهان از بازار' };
const blankAttribute = (attributeId: string): ModelAttribute => ({
  attributeId,
  textFa: null,
  textEn: null,
  number: null,
  bool: null,
  optionId: null,
  optionIds: null,
});
function CsvGuide({ catalog }: { catalog: Catalog }) {
  const [categoryId, setCategoryId] = useState(catalog.categories[0]?.id ?? '');
  const category = catalog.categories.find((c) => c.id === categoryId);
  return (
    <details className="panel csv-guide">
      <summary>راهنمای شناسه‌ها و ستون‌های CSV</summary>
      <p>
        شناسه‌ها را دقیقاً از جدول‌ها بردارید. وضعیت انتشار یکی از{' '}
        <bdi>Draft / Published / Hidden</bdi> و گزارش موجودی یکی از{' '}
        <bdi>unknown / available / unavailable</bdi> است. تاریخ‌ها مانند{' '}
        <bdi>2026-10-23T12:00:00Z</bdi> همراه منطقهٔ زمانی‌اند. <bdi>is_demo</bdi> مقدار{' '}
        <bdi>true / false</bdi> می‌گیرد.
      </p>
      <div className="form-grid">
        <div>
          <h3>دسته‌ها — category_id</h3>
          {catalog.categories.map((c) => (
            <p key={c.id}>
              {nameOf(c)}: <code dir="ltr">{c.id}</code>
            </p>
          ))}
        </div>
        <div>
          <h3>برندها — brand_id</h3>
          {catalog.brands.map((b) => (
            <p key={b.id}>
              {b.name}: <code dir="ltr">{b.id}</code>
            </p>
          ))}
        </div>
      </div>
      <Field label="ویژگی‌های دسته برای CSV">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {catalog.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {nameOf(c)}
            </option>
          ))}
        </select>
      </Field>
      <div className="table-wrap" role="region" aria-label="راهنمای ستون ویژگی CSV" tabIndex={0}>
        <AdminTable>
          <thead>
            <tr>
              <th>ویژگی</th>
              <th>نام ستون</th>
              <th>مقدار / گزینه‌ها</th>
            </tr>
          </thead>
          <tbody>
            {catalog.attributes
              .filter((d) => category?.attributes.some((a) => a.attributeId === d.id))
              .map((d) => (
                <tr key={d.id}>
                  <td>
                    {nameOf(d)}
                    {category?.attributes.find((a) => a.attributeId === d.id)?.isRequired
                      ? ' (اجباری)'
                      : ''}
                  </td>
                  <td>
                    {{
                      Text: ['fa', 'en'],
                      Number: ['number'],
                      Bool: ['bool'],
                      Select: ['option_id'],
                      MultiSelect: ['option_ids'],
                    }[d.dataType].map((part) => (
                      <p key={part}>
                        <code dir="ltr">
                          attr.{d.key}.{part}
                        </code>
                      </p>
                    ))}
                  </td>
                  <td>
                    {d.dataType === 'Number' ? (
                      `عدد اعشاری بدون جداکننده${d.unit ? '، ' + d.unit : ''}`
                    ) : d.dataType === 'Bool' ? (
                      <bdi>true / false</bdi>
                    ) : d.options.length ? (
                      d.options.map((o) => (
                        <p key={o.id}>
                          {o.labelFa}: <code dir="ltr">{o.id}</code>
                        </p>
                      ))
                    ) : (
                      'متن؛ فارسی و انگلیسی در دو ستون جدا'
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </AdminTable>
      </div>
    </details>
  );
}
function ModelAttributes({
  definitions,
  value,
  onChange,
}: {
  definitions: AttributeDefinition[];
  value: ModelAttribute[];
  onChange: (value: ModelAttribute[]) => void;
}) {
  const update = (id: string, patch: Partial<ModelAttribute>) =>
    onChange([...value.filter((v) => v.attributeId !== id), { ...blankAttribute(id), ...patch }]);
  return (
    <div className="form-grid">
      {definitions.map((d) => {
        const v = value.find((v) => v.attributeId === d.id);
        return (
          <fieldset key={d.id}>
            <legend>
              {nameOf(d)} {d.unit && `(${d.unit})`}
            </legend>
            {d.dataType === 'Text' ? (
              <>
                <Text
                  label="فارسی"
                  value={v?.textFa ?? ''}
                  onChange={(textFa) => update(d.id, { textFa, textEn: v?.textEn ?? null })}
                />
                <Text
                  label="English"
                  dir="ltr"
                  value={v?.textEn ?? ''}
                  onChange={(textEn) => update(d.id, { textFa: v?.textFa ?? null, textEn })}
                />
              </>
            ) : d.dataType === 'Number' ? (
              <Text
                label={nameOf(d)}
                dir="ltr"
                value={v?.number ?? ''}
                onChange={(number) => {
                  if (number === '') onChange(value.filter((a) => a.attributeId !== d.id));
                  else update(d.id, { number: normalizeMarketDigits(number).replace('٫', '.') });
                }}
              />
            ) : d.dataType === 'Bool' ? (
              <Field label={nameOf(d)}>
                <select
                  value={v?.bool === null || v?.bool === undefined ? '' : String(v.bool)}
                  onChange={(e) => {
                    if (e.target.value === '')
                      onChange(value.filter((a) => a.attributeId !== d.id));
                    else update(d.id, { bool: e.target.value === 'true' });
                  }}
                >
                  <option value="">نامعلوم / تعیین‌نشده</option>
                  <option value="true">بله</option>
                  <option value="false">خیر</option>
                </select>
              </Field>
            ) : d.dataType === 'Select' ? (
              <Field label={nameOf(d)}>
                <select
                  value={v?.optionId ?? ''}
                  onChange={(e) => {
                    if (!e.target.value) onChange(value.filter((a) => a.attributeId !== d.id));
                    else update(d.id, { optionId: e.target.value });
                  }}
                >
                  <option value="">انتخاب کنید</option>
                  {d.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.labelFa} / {o.labelEn}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="inline-checks">
                {d.options.map((o) => (
                  <Check
                    key={o.id}
                    label={o.labelFa}
                    checked={v?.optionIds?.includes(o.id) ?? false}
                    onChange={(e) =>
                      update(d.id, {
                        optionIds: e.target.checked
                          ? [...(v?.optionIds ?? []), o.id]
                          : (v?.optionIds ?? []).filter((id) => id !== o.id),
                      })
                    }
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              className="clear-value"
              onClick={() => onChange(value.filter((a) => a.attributeId !== d.id))}
            >
              پاک کردن مقدار
            </button>
          </fieldset>
        );
      })}
    </div>
  );
}
function MarketForm({
  catalog,
  id,
  initialModel,
  initialDetails,
  listingVersion,
  onClose,
  onSaved,
  onLock,
  onCreated,
  hasOffers = false,
}: {
  catalog: Catalog;
  id?: string;
  initialModel?: MarketModelInput;
  initialDetails?: MarketDetails;
  listingVersion?: string;
  onClose: () => void;
  onSaved: () => void;
  onLock: (locked: boolean) => void;
  onCreated?: (listingId: string) => void;
  hasOffers?: boolean;
}) {
  const [model, setModel] = useState<MarketModelInput>(
    initialModel ?? newMarketPhoneModel(catalog),
  );
  const [details, setDetails] = useState<MarketDetails>(
    initialDetails ?? newMarketPhoneDetails(crypto.randomUUID()),
  );
  const [slugEdited, setSlugEdited] = useState(!!initialModel),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState<unknown>();
  const scope = marketPhoneScope(catalog),
    category = catalog.categories.find((value) => value.id === model.categoryId),
    definitions = catalog.attributes.filter((value) =>
      category?.attributes.some((rule) => rule.attributeId === value.id),
    );
  useEffect(() => {
    onLock(busy || uploadBusy);
    return () => onLock(false);
  }, [busy, uploadBusy, onLock]);
  function translationsChanged(translations: MarketModelInput['translations']) {
    const english = translations.find((value) => value.locale === 'en')?.name ?? '';
    const generated = english
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 150);
    setModel((previous) => ({
      ...previous,
      translations,
      ...(!slugEdited ? { slug: generated } : {}),
    }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || uploadBusy || unknown || (!id && !scope.ready)) return;
    if (!model.slug.trim()) {
      setError(Error('نام انگلیسی مدل یا نشانی آن را تکمیل کنید.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const cleaned = {
        ...model,
        attributes: model.attributes.filter(
          (value) =>
            value.number !== null ||
            value.bool !== null ||
            value.optionId ||
            value.optionIds?.length ||
            value.textFa?.trim() ||
            value.textEn?.trim(),
        ),
      };
      const body = id ? { model: cleaned, details, listingVersion } : { model: cleaned, details };
      const saved = marketSavedSchema.parse(
        await save<unknown>(
          id ? `/admin/market/${encodeURIComponent(id)}/edit` : '/admin/market/models',
          body,
          id ? 'PUT' : 'POST',
        ),
      );
      if (id && saved.id !== id)
        throw Error('پاسخ ذخیره معتبر نیست؛ نتیجه را از فهرست بازخوانی کنید.');
      onSaved();
      onClose();
      if (!id) onCreated?.(saved.id);
    } catch (error) {
      setError(error);
      if (!(error instanceof ApiError && error.status >= 400 && error.status < 500))
        setUnknown(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="market-phone-model-form" onSubmit={(event) => void submit(event)}>
      <div className="market-business-note">
        <strong>{id ? 'مشخصات مدل گوشی' : 'مدل تازهٔ گوشی سامسونگ'}</strong>
        <p>
          ابتدا مشخصات و تصاویر مدل را ثبت کنید؛ سپس رم، حافظه و رنگ‌های قابل انتخاب را اضافه کنید.
          مشتری برای ترکیب دلخواه خود درخواست می‌دهد و پیشنهاد قیمت را بعد از بررسی دریافت می‌کند.
        </p>
      </div>
      <ErrorBox error={error} />
      {!id && !scope.ready && (
        <p className="notice" role="alert">
          پیش از افزودن مدل، دستهٔ فعال گوشی با نشانی phones و برند فعال Samsung با نشانی samsung
          باید در کاتالوگ تعریف شده باشند.
        </p>
      )}
      {hasOffers && (
        <p className="notice">
          این مدل پیشنهاد فروشگاهی دارد. مشخصات مشترک ویرایش می‌شوند؛ قیمت، گارانتی و موجودی از این
          فرم تغییر نمی‌کنند.
        </p>
      )}
      {unknown && (
        <p className="notice" role="alert">
          نتیجهٔ ذخیره مشخص نیست. پیش از ثبت دوباره، فهرست را با شناسهٔ همین ردیف بازخوانی کنید:{' '}
          <bdi>{details.sourceItemKey}</bdi>
        </p>
      )}
      <fieldset disabled={busy || unknown || uploadBusy}>
        <legend>نام، معرفی و تصاویر مدل</legend>
        <Translations value={model.translations} onChange={translationsChanged} />
        <ImageEditor
          value={model.imageUrls}
          onChange={(imageUrls) => setModel((previous) => ({ ...previous, imageUrls }))}
          onBusy={setUploadBusy}
        />
        <div className="form-grid">
          <Field label="دستهٔ مدل">
            <select
              disabled={!id}
              value={model.categoryId}
              onChange={(event) => {
                const next = catalog.categories.find((value) => value.id === event.target.value);
                setModel({
                  ...model,
                  categoryId: event.target.value,
                  attributes: model.attributes.filter((value) =>
                    next?.attributes.some((rule) => rule.attributeId === value.attributeId),
                  ),
                });
              }}
            >
              <option value="">انتخاب دسته</option>
              {catalog.categories.map((value) => (
                <option key={value.id} value={value.id}>
                  {nameOf(value)}
                  {value.isActive ? '' : ' (غیرفعال)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="برند">
            <select
              disabled={!id}
              value={model.brandId}
              onChange={(event) => setModel({ ...model, brandId: event.target.value })}
            >
              <option value="">انتخاب برند</option>
              {catalog.brands.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                  {value.isActive ? '' : ' (غیرفعال)'}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
      <fieldset disabled={busy || unknown || uploadBusy}>
        <legend>مشخصات فنی مدل</legend>
        <p className="muted">
          مشخصات پایهٔ گوشی را تکمیل کنید. ترکیب‌های قابل انتخاب مشتری در مرحلهٔ بعد جدا ثبت
          می‌شوند.
        </p>
        <ModelAttributes
          definitions={definitions}
          value={model.attributes}
          onChange={(attributes) => setModel({ ...model, attributes })}
        />
      </fieldset>
      <fieldset disabled={busy || unknown || uploadBusy}>
        <legend>نمایش به مشتری</legend>
        <MarketPublicationField details={details} onChange={setDetails} />
        <p className="muted">
          قیمت و منبع داخلی در معرفی گوشی به مشتری نمایش داده نمی‌شوند. انتشار مدل، به‌معنی
          موجودبودن یا ثبت سفارش فروش نیست.
        </p>
      </fieldset>
      <details className="market-internal-settings">
        <summary>اطلاعات داخلی و منابع (اختیاری)</summary>
        <p className="muted">
          برای ثبت اولیهٔ مدل لازم نیست منبع یا مبلغ وارد کنید. شناسهٔ داخلی به‌صورت خودکار ساخته
          شده است؛ مقادیر قبلی هنگام ویرایش محفوظ می‌مانند.
        </p>
        <fieldset disabled={busy || unknown || uploadBusy}>
          <Text
            label="نشانی مدل"
            dir="ltr"
            value={model.slug}
            onChange={(slug) => {
              setSlugEdited(true);
              setModel({ ...model, slug });
            }}
          />
          <MarketSourceFields details={details} onChange={setDetails} includePublication={false} />
        </fieldset>
      </details>
      <div className="form-actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || uploadBusy || unknown || (!id && !scope.ready)}
        >
          {busy ? 'در حال ذخیره…' : id ? 'ذخیرهٔ مشخصات مدل' : 'ذخیره و تنظیم انتخاب‌های گوشی'}
        </button>
        <button
          type="button"
          disabled={busy || uploadBusy}
          onClick={() => {
            if (unknown) onSaved();
            onClose();
          }}
        >
          {unknown ? 'بستن و بازخوانی فهرست' : 'بستن'}
        </button>
      </div>
    </form>
  );
}
function MarketEditor({
  id,
  catalog,
  onClose,
  onSaved,
  onLock,
}: {
  id: string;
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => void;
  onLock: (locked: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ['admin', 'market-edit', id],
    queryFn: async ({ signal }) => {
      const listing = marketDetailSchema.parse(
        await api<unknown>(`/admin/market/${encodeURIComponent(id)}`, { signal }),
      );
      const model = marketModelSchema.parse(
        await api<unknown>(`/admin/market/models/${encodeURIComponent(listing.modelId)}`, {
          signal,
        }),
      );
      return { listing, model };
    },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return query.isPending ? (
    <Busy />
  ) : query.error ? (
    <>
      <ErrorBox error={query.error} />
      <button onClick={() => void query.refetch()}>بازخوانی جزئیات</button>
    </>
  ) : query.data ? (
    <MarketForm
      key={query.data.listing.version + query.data.model.model.input.version}
      id={id}
      catalog={catalog}
      initialModel={query.data.model.model.input}
      initialDetails={query.data.listing.details}
      listingVersion={query.data.listing.version}
      hasOffers={query.data.model.model.hasOffers}
      onClose={onClose}
      onSaved={onSaved}
      onLock={onLock}
    />
  ) : null;
}
export function MarketPage({
  catalog,
  writable,
  viewerId,
}: {
  catalog: Catalog;
  writable: boolean;
  viewerId: string;
}) {
  const scope = marketPhoneScope(catalog);
  const [draft, setDraft] = useState({
      query: '',
      status: 'all',
      categoryId: scope.category?.id ?? '',
      brandId: scope.brand?.id ?? '',
    }),
    [filter, setFilter] = useState(draft),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [generation, setGeneration] = useState(0),
    [editing, setEditing] = useState<string | null | undefined>(),
    [sourcesId, setSourcesId] = useState<string | undefined>(
      () => readSourceJournal(viewerId)?.command.listingId,
    ),
    [phoneId, setPhoneId] = useState<string | undefined>(() => {
      const value = readMarketPhoneJournal(viewerId);
      return value?.result === null ? value.command.listingId : undefined;
    }),
    [modalLocked, setModalLocked] = useState(false);
  const client = useQueryClient(),
    cursor = cursors.at(-1)!;
  const query = useQuery({
    queryKey: ['admin', 'market-page', filter, cursor, generation],
    queryFn: async ({ signal }) =>
      marketPageSchema.parse(
        await api<unknown>(
          marketListPath(filter.query, filter.status, filter.categoryId, cursor, filter.brandId),
          { signal },
        ),
      ),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function refresh() {
    setCursors([null]);
    setGeneration((value) => value + 1);
    void client.invalidateQueries({ queryKey: ['admin'] });
  }
  function edit(id: string | null) {
    setSourcesId(undefined);
    setPhoneId(undefined);
    setEditing(id);
  }
  function configurations(id: string) {
    setSourcesId(undefined);
    setEditing(undefined);
    setPhoneId(id);
  }
  return (
    <>
      <section className="panel market-list market-phone-models">
        <div className="section-heading">
          <div>
            <h2>مدل‌های گوشی و انتخاب‌های مشتری</h2>
            <p>
              مدل، رم، حافظه و رنگ را معرفی کنید؛ مشتری برای اطلاع‌رسانی یا بررسی تأمین انتخاب
              می‌کند و قیمت را در پیشنهاد مدیر می‌بیند.
            </p>
          </div>
          <div className="row-buttons">
            <button type="button" onClick={refresh} disabled={query.isFetching}>
              بازخوانی مدل‌ها
            </button>
            {writable && (
              <button
                type="button"
                className="primary"
                disabled={!scope.ready}
                onClick={() => edit(null)}
              >
                افزودن گوشی سامسونگ
              </button>
            )}
          </div>
        </div>
        <AdminFilterForm
          onSubmit={(event) => {
            event.preventDefault();
            setFilter({ ...draft });
            setCursors([null]);
            setGeneration((value) => value + 1);
          }}

          label="فیلتر کاتالوگ گوشی"
          search={
            <Text
              label="نام مدل یا شناسهٔ داخلی"
              value={draft.query}
              onChange={(query) => setDraft({ ...draft, query: query.slice(0, 120) })}
            />
          }
          actions={
            <>
              <button className="primary">جست‌وجو</button>
              <button
                type="button"
                onClick={() => {
                  const initial = {
                    query: '',
                    status: 'all',
                    categoryId: scope.category?.id ?? '',
                    brandId: scope.brand?.id ?? '',
                  };
                  setDraft(initial);
                  setFilter(initial);
                  setCursors([null]);
                  setGeneration((value) => value + 1);
                }}
              >
                بازنشانی فیلترها
              </button>
            </>
          }
          applied={[
            filter.query ? 'جست‌وجو: ' + filter.query : '',
            filter.status === 'all'
              ? ''
              : (Object.entries(labels).find(([key]) => key === filter.status)?.[1] ??
                filter.status),
            filter.categoryId
              ? nameOf(catalog.categories.find((item) => item.id === filter.categoryId))
              : '',
            filter.brandId
              ? (catalog.brands.find((item) => item.id === filter.brandId)?.name ?? 'برند انتخابی')
              : '',
          ].filter(Boolean)}
        >
          <Field label="نمایش به مشتری">
            <select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
            >
              <option value="all">همه</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="دسته">
            <select
              value={draft.categoryId}
              onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
            >
              <option value="">همه، شامل مدل‌های قبلی</option>
              {catalog.categories.map((value) => (
                <option key={value.id} value={value.id}>
                  {nameOf(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="برند">
            <select
              value={draft.brandId}
              onChange={(event) => setDraft({ ...draft, brandId: event.target.value })}
            >
              <option value="">همهٔ برندها</option>
              {catalog.brands.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                  {value.isActive ? '' : ' (غیرفعال)'}
                </option>
              ))}
            </select>
          </Field>
        </AdminFilterForm>
        <ErrorBox error={query.error} />
        {query.isPending ? (
          <Busy />
        ) : query.error ? (
          <button type="button" onClick={() => void query.refetch()}>
            تلاش دوباره
          </button>
        ) : (
          query.data && (
            <>
              <div
                className="table-wrap"
                role="region"
                aria-label="فهرست مدل‌های گوشی"
                tabIndex={0}
              >
                <AdminTable>
                  <thead>
                    <tr>
                      <th>مدل</th>
                      <th>نمایش به مشتری</th>
                      <th>مدیریت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.nameFa || item.nameEn || item.modelId}</strong>
                          <small dir="ltr">{item.nameEn}</small>
                          {item.isDemo && <small>نمونهٔ توسعه</small>}
                        </td>
                        <td>{labels[item.status]}</td>
                        <td>
                          <div className="row-buttons">
                            <button type="button" onClick={() => configurations(item.id)}>
                              رم، حافظه و رنگ‌ها
                            </button>
                            {writable && (
                              <button type="button" onClick={() => edit(item.id)}>
                                ویرایش مدل
                              </button>
                            )}
                          </div>
                          <details className="market-row-tools">
                            <summary>اطلاعات و ابزارهای داخلی</summary>
                            <small>
                              <bdi>model_id: {item.modelId}</bdi>
                            </small>
                            <small>
                              <bdi>listing_id: {item.id}</bdi>
                            </small>
                            <small>
                              <bdi>
                                {item.sourceKey} / {item.sourceItemKey}
                              </bdi>
                            </small>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(undefined);
                                setPhoneId(undefined);
                                setSourcesId(item.id);
                              }}
                            >
                              منابع داخلی و تاریخچه
                            </button>
                          </details>
                        </td>
                      </tr>
                    ))}
                    {!query.data.items.length && (
                      <tr>
                        <td colSpan={3} className="empty">
                          مدلی با این انتخاب‌ها پیدا نشد. برای دیدن رکوردهای قبلی، دسته و برند را
                          تغییر دهید.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </AdminTable>
              </div>
              <div className="pagination">
                <button
                  type="button"
                  disabled={cursors.length === 1 || query.isFetching}
                  onClick={() => setCursors((value) => value.slice(0, -1))}
                >
                  صفحهٔ قبل
                </button>
                <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
                <button
                  type="button"
                  disabled={!query.data.nextCursor || query.isFetching}
                  onClick={() => setCursors((value) => [...value, query.data!.nextCursor])}
                >
                  ۵۰ ردیف بعدی
                </button>
              </div>
            </>
          )
        )}
      </section>
      {writable && (
        <details className="panel market-bulk-tools">
          <summary>ورود گروهی و گزارش‌های داخلی</summary>
          <p className="muted">
            قالب‌های قبلی CSV همچنان پشتیبانی می‌شوند. قیمت و گزارش منبع در این بخش فقط برای کار
            داخلی‌اند؛ انتخاب‌های قابل درخواست گوشی از بخش رم، حافظه و رنگ‌ها تنظیم می‌شوند.
          </p>
          <CsvGuide catalog={catalog} />
          <MarketImport key={viewerId} viewerId={viewerId} onSaved={refresh} />
          <MarketSourceCsvImport
            key={viewerId + ':source-csv'}
            viewerId={viewerId}
            onSaved={refresh}
          />
        </details>
      )}
      {editing !== undefined && writable && (
        <Modal
          title={editing ? 'ویرایش مدل گوشی' : 'مدل تازهٔ گوشی سامسونگ'}
          onClose={() => {
            if (!modalLocked) {
              refresh();
              setEditing(undefined);
            }
          }}
          preventClose={modalLocked}
        >
          {editing ? (
            <MarketEditor
              id={editing}
              catalog={catalog}
              onClose={() => setEditing(undefined)}
              onSaved={refresh}
              onLock={setModalLocked}
            />
          ) : (
            <MarketForm
              catalog={catalog}
              onClose={() => setEditing(undefined)}
              onSaved={refresh}
              onLock={setModalLocked}
              onCreated={configurations}
            />
          )}
        </Modal>
      )}
      {phoneId && (
        <Modal
          title="انتخاب‌های رم، حافظه و رنگ گوشی"
          onClose={() => {
            if (!modalLocked) {
              setPhoneId(undefined);
              refresh();
            }
          }}
          preventClose={modalLocked}
        >
          <MarketPhoneConfigurations
            key={viewerId + phoneId}
            listingId={phoneId}
            viewerId={viewerId}
            writable={writable}
            onSaved={refresh}
            onLock={setModalLocked}
            onOpenListing={configurations}
          />
        </Modal>
      )}
      {sourcesId && (
        <Modal
          title="منابع داخلی و تاریخچهٔ مدل"
          onClose={() => {
            if (!modalLocked) {
              setSourcesId(undefined);
              refresh();
            }
          }}
          preventClose={modalLocked}
        >
          <MarketSourcesManager
            key={viewerId + sourcesId}
            listingId={sourcesId}
            viewerId={viewerId}
            writable={writable}
            onSaved={refresh}
            onLock={setModalLocked}
            onOpenListing={setSourcesId}
          />
        </Modal>
      )}
    </>
  );
}

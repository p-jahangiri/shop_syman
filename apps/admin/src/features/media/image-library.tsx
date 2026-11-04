import { PersianDateField } from '../../components/forms/persian-date-field';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ImageOff, RefreshCw, X } from 'lucide-react';
import { api } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Busy, ErrorBox, Field } from '../../components/ui';
import { imagePreviewUrl } from '../../api/contracts/media/media-contract';
import {
  emptyImageLibraryFilters,
  imageLibraryAssetId,
  imageLibraryFiltersSchema,
  imageLibraryPath,
  localImageLibraryTime,
  readImageLibraryPage,
  type ImageLibraryFilters,
  type ImageLibraryItem,
} from '../../api/contracts/media/image-library-contract';
import '../../styles/media/image-library.css';

const blank = { q: '', fromLocal: '', toLocal: '' };
const date = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
export function ImageLibrary({
  id,
  value,
  max,
  disabled = false,
  onSelect,
  onClose,
}: {
  id: string;
  value: readonly string[];
  max: number;
  disabled?: boolean;
  onSelect: (item: ImageLibraryItem) => boolean;
  onClose: () => void;
}) {
  const instance = useId(),
    revision = adminViewRevision();
  // No element uses this id. Filter controls therefore have no native form
  // owner and cannot validate or serialize with the enclosing product/CMS form.
  const filterFormOwner = instance + '-image-library-filters-detached';
  const [draft, setDraft] = useState(blank);
  const [filters, setFilters] = useState<ImageLibraryFilters>(emptyImageLibraryFilters);
  const [generation, setGeneration] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [broken, setBroken] = useState<string[]>([]);
  const cursor = cursors.at(-1)!;
  const blocked = disabled || value.length >= max;
  const owner = JSON.stringify([revision, generation, filters, cursor, blocked]);
  const active = useRef(owner);
  const context = useRef({ revision, blocked, value, onSelect });
  const snapshot = useRef<{ scope: string; asOfAt: string } | null>(null);
  const scope = JSON.stringify([revision, generation, filters]);
  active.current = owner;
  context.current = { revision, blocked, value, onSelect };
  useEffect(() => {
    active.current = owner;
    return () => {
      if (active.current === owner) active.current = '';
    };
  }, [owner]);
  const query = useQuery({
    queryKey: ['admin', 'image-library', instance, revision, generation, filters, cursor],
    enabled: !blocked,
    queryFn: async ({ signal }) => {
      if (blocked || signal.aborted || adminViewRevision() !== revision || active.current !== owner)
        throw new Error('این درخواست به نمای فعلی کتابخانه تعلق ندارد.');
      const raw = await api<unknown>(imageLibraryPath(filters, cursor), { signal });
      if (signal.aborted || adminViewRevision() !== revision || active.current !== owner)
        throw new Error('این درخواست به نمای فعلی کتابخانه تعلق ندارد.');
      const page = readImageLibraryPage(raw, filters);
      if (cursor && snapshot.current?.scope === scope && snapshot.current.asOfAt !== page.asOfAt)
        throw new Error('زمان مبنای کتابخانه تغییر کرده است؛ از ابتدا تازه‌سازی کنید.');
      snapshot.current = { scope, asOfAt: page.asOfAt };
      return page;
    },
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  function refresh() {
    setCursors([null]);
    setGeneration((old) => old + 1);
    setNotice('');
  }
  function apply() {
    try {
      const parsed = imageLibraryFiltersSchema.safeParse({
        q: draft.q.trim().toLowerCase() || null,
        fromAt: localImageLibraryTime(draft.fromLocal),
        toAt: localImageLibraryTime(draft.toLocal),
      });
      if (!parsed.success)
        throw new Error(
          'شناسه باید ۴ تا ۳۲ نویسهٔ ۰ تا ۹ یا a تا f باشد؛ پایان بازه نباید قبل از شروع باشد.',
        );
      setFilters(parsed.data);
      setError(undefined);
      refresh();
    } catch (failure) {
      setError(failure);
    }
  }
  function choose(item: ImageLibraryItem) {
    const current = context.current;
    if (
      active.current !== owner ||
      current.blocked ||
      current.revision !== adminViewRevision() ||
      current.value.some((url) => imageLibraryAssetId(url) === item.id)
    )
      return;
    if (current.onSelect(item))
      setNotice('تصویر به فرم اضافه شد؛ برای ثبت نهایی، خود فرم را ذخیره کنید.');
  }
  function filterKeyDown(event: {
    key: string;
    preventDefault: () => void;
    stopPropagation: () => void;
    nativeEvent: { isComposing: boolean };
  }) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      apply();
    }
  }
  return (
    <section id={id} className="image-library" aria-label="کتابخانهٔ تصاویر آماده">
      <header className="image-library-heading">
        <div>
          <h4>تصاویر آمادهٔ فروشگاه</h4>
          <p>تصویرهای عمومیِ قبلاً بارگذاری‌شده را دوباره استفاده کنید.</p>
        </div>
        <button type="button" className="icon" onClick={onClose} aria-label="بستن کتابخانهٔ تصاویر">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="image-library-filters" role="group" aria-label="فیلتر کتابخانهٔ تصاویر">
        <Field label="شناسهٔ تصویر یا ابتدای آن">
          <input
            type="search"
            form={filterFormOwner}
            dir="ltr"
            maxLength={32}
            placeholder="مانند a12f"
            value={draft.q}
            disabled={blocked}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            onKeyDown={filterKeyDown}
          />
        </Field>
        <div className="field">
          <PersianDateField
            label="از زمان (شامل)"
            encoding="local"
            precision="minute"
            form={filterFormOwner}
            value={draft.fromLocal}
            disabled={blocked}
            onChange={(next) => setDraft({ ...draft, fromLocal: next })}
            onKeyDown={filterKeyDown}
          />
        </div>
        <div className="field">
          <PersianDateField
            label="تا زمان (پیش از)"
            encoding="local"
            precision="minute"
            form={filterFormOwner}
            value={draft.toLocal}
            disabled={blocked}
            onChange={(next) => setDraft({ ...draft, toLocal: next })}
            onKeyDown={filterKeyDown}
          />
        </div>
        <div className="image-library-actions">
          <button type="button" className="primary" onClick={apply} disabled={blocked}>
            اعمال فیلتر تصاویر
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              setDraft(blank);
              setFilters(emptyImageLibraryFilters);
              setError(undefined);
              refresh();
            }}
          >
            پاک‌کردن فیلتر تصاویر
          </button>
          <button type="button" disabled={blocked || query.isFetching} onClick={refresh}>
            <RefreshCw size={15} aria-hidden="true" />
            تازه‌سازی تصاویر
          </button>
        </div>
      </div>
      <p className="image-library-guide">
        جست‌وجو با شناسهٔ تصویر است. زمان ورودی شمسی و منطقهٔ دستگاه (
        {Intl.DateTimeFormat().resolvedOptions().timeZone})؛ نمایش تاریخ شمسی است. انتخاب تصویر فقط
        آن را به فرم اضافه می‌کند.
      </p>
      <ErrorBox error={error ?? query.error} />
      {notice && (
        <p role="status" className="image-library-notice">
          {notice}
        </p>
      )}
      {blocked ? (
        <p role="status">انتخاب تصویر فعلاً غیرفعال است یا ظرفیت این فرم تکمیل شده است.</p>
      ) : query.isPending ? (
        <Busy />
      ) : query.error ? (
        <div className="image-library-actions">
          <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
            تلاش دوباره برای تصاویر
          </button>
          {cursors.length > 1 && (
            <button type="button" onClick={() => setCursors((old) => old.slice(0, -1))}>
              بازگشت به تصاویر قبلی
            </button>
          )}
        </div>
      ) : (
        query.data && (
          <>
            <p className="image-library-count" role="status">
              {query.data.items.length.toLocaleString('fa-IR')} تصویر در این صفحه · صفحهٔ{' '}
              {cursors.length.toLocaleString('fa-IR')}
            </p>
            {query.data.items.length ? (
              <div
                className="image-library-results"
                role="region"
                aria-label="تصاویر آماده، قابل پیمایش"
                tabIndex={0}
              >
                <ul className="image-library-grid">
                  {query.data.items.map((item) => {
                    const selected = value.some((url) => imageLibraryAssetId(url) === item.id);
                    const card = item.variants.find((variant) => variant.name === 'card')!;
                    return (
                      <li key={item.id} className="image-library-card">
                        <div className="image-library-preview">
                          {broken.includes(item.id) ? (
                            <span role="img" aria-label="پیش‌نمایش تصویر در دسترس نیست">
                              <ImageOff size={22} aria-hidden="true" />
                              پیش‌نمایش در دسترس نیست
                            </span>
                          ) : (
                            <img
                              src={imagePreviewUrl(item.url)}
                              width={160}
                              height={112}
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              alt={'پیش‌نمایش تصویر ' + item.id}
                              onError={() =>
                                setBroken((old) =>
                                  old.includes(item.id) ? old : [...old.slice(-95), item.id],
                                )
                              }
                            />
                          )}
                        </div>
                        <bdi className="image-library-id">{item.id}</bdi>
                        <span className="image-library-metadata">
                          {card.width.toLocaleString('fa-IR')} ×{' '}
                          {card.height.toLocaleString('fa-IR')} پیکسل · اندازهٔ میانی
                        </span>
                        <time dateTime={item.createdAt}>
                          {date.format(new Date(item.createdAt))}
                        </time>
                        <button
                          type="button"
                          disabled={selected || blocked}
                          onClick={() => choose(item)}
                          aria-label={
                            (selected ? 'تصویر در فرم موجود است ' : 'انتخاب تصویر ') + item.id
                          }
                        >
                          {selected ? (
                            <>
                              <Check size={16} aria-hidden="true" />
                              در فرم موجود است
                            </>
                          ) : (
                            'انتخاب تصویر'
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="image-library-empty">
                تصویر آماده‌ای با این فیلتر پیدا نشد. می‌توانید فیلتر را پاک کنید یا از بخش آپلود،
                تصویر تازه‌ای اضافه کنید.
              </p>
            )}
            <div className="image-library-pagination">
              <button
                type="button"
                disabled={cursors.length === 1 || query.isFetching}
                onClick={() => setCursors((old) => old.slice(0, -1))}
              >
                تصاویر قبلی
              </button>
              <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
              <button
                type="button"
                disabled={!query.data.nextCursor || query.isFetching}
                onClick={() => {
                  if (query.data?.nextCursor) setCursors((old) => [...old, query.data!.nextCursor]);
                }}
              >
                ۲۴ تصویر بعدی
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}

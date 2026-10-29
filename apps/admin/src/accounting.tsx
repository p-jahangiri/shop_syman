import { AdminTable } from './admin-table';
import { AdminFilterForm } from './admin-filters';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, save } from './api';
import { Busy, Check, ErrorBox, Field, Modal } from './ui';
import { Text } from './forms';
import { AccountingImports } from './accounting-imports';
import { AccountingWarehouses } from './accounting-reconciliation';
import { AccountingStockCommandPanel } from './accounting-stock';
import {
  holooStatusSchema,
  accountingLinkSchema,
  accountingPageSchema,
  accountingVariantsSchema,
  accountingSavedSchema,
  accountingListPath,
  accountingRecoveryMatches,
  type AccountingLink,
  type AccountingLinkInput,
} from './accounting-contract';

const base = '/admin/accounting/holoo';

function LinkForm({
  initial,
  onClose,
  onSaved,
  onLock,
}: {
  initial?: AccountingLink;
  onClose: () => void;
  onSaved: () => void;
  onLock: (value: boolean) => void;
}) {
  const [id] = useState(initial?.id ?? crypto.randomUUID().replaceAll('-', ''));
  const [value, setValue] = useState<AccountingLinkInput>(
    initial
      ? {
          companyKey: initial.companyKey,
          externalItemId: initial.externalItemId,
          externalCode: initial.externalCode,
          variantId: initial.variantId,
          isActive: initial.isActive,
          version: initial.version,
        }
      : {
          companyKey: '',
          externalItemId: '',
          externalCode: null,
          variantId: '',
          isActive: true,
          version: null,
        },
  );
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState(
    initial ? `${initial.sku} — ${initial.nameFa}` : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [frozen, setFrozen] = useState<AccountingLinkInput | null>(null);
  const [recovered, setRecovered] = useState<AccountingLink | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<AccountingLinkInput | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy && !frozen) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, frozen]);
  const choices = useQuery({
    queryKey: ['admin', 'holoo-variant-search', query],
    queryFn: async ({ signal }) =>
      accountingVariantsSchema.parse(
        await api<unknown>(base + '/variants?query=' + encodeURIComponent(query), { signal }),
      ),
    enabled: query.trim().length >= 2,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  function begin() {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    onLock(true);
    setError(undefined);
    setReviewed(false);
    return true;
  }
  function finish() {
    inFlight.current = false;
    if (mounted.current) {
      setBusy(false);
      onLock(pending.current !== null);
    }
  }
  function complete() {
    pending.current = null;
    setFrozen(null);
    onSaved();
    onClose();
  }
  async function send(command: AccountingLinkInput) {
    if (!begin()) return;
    const snapshot = structuredClone(command);
    try {
      const result = accountingSavedSchema.parse(
        await save<unknown>(base + '/links/' + id, snapshot, 'PUT'),
      );
      if (result.id !== id)
        throw new Error('شناسهٔ پاسخ معتبر نیست؛ نتیجه را از فهرست بازخوانی کنید.');
      if (mounted.current) complete();
    } catch (e) {
      if (!mounted.current) return;
      setError(e);
      if (!(e instanceof ApiError && e.status >= 400 && e.status < 500)) {
        pending.current = snapshot;
        setFrozen(snapshot);
        setRecovered(null);
      }
    } finally {
      finish();
    }
  }
  async function recover() {
    const command = pending.current;
    if (!command || !begin()) return;
    try {
      const current = accountingLinkSchema.parse(await api<unknown>(base + '/links/' + id));
      if (!mounted.current) return;
      if (!accountingRecoveryMatches(id, command, current)) {
        setRecovered(current);
        throw new Error(
          'وضعیت فعلی با درخواست ذخیره یکسان نیست یا نسخه هنوز تغییر نکرده است. نتیجهٔ ذخیره تأیید نشد؛ مقادیر فعلی را بررسی کنید.',
        );
      }
      complete();
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      finish();
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending.current) void send(value);
      }}
    >
      <p className="notice">
        این فرم فقط شناسهٔ آیتم هلو را به یک SKU فیزیکی متصل می‌کند. دریافت کالا، موجودی یا قیمت از
        هلو هنوز فعال نیست. شناسهٔ ثابت را از خروجی/سرویس معتبر بردارید؛ کد نمایشی ممکن است تغییر
        کند.
      </p>
      <ErrorBox error={error} />
      <fieldset disabled={busy || !!frozen}>
        <legend>تطبیق شناسه‌ها</legend>
        <fieldset disabled={!!initial}>
          <legend>محدوده و هویت خارجی</legend>
          <Text
            label="شناسهٔ شرکت/پایگاه هلو"
            dir="ltr"
            required
            value={value.companyKey}
            onChange={(companyKey) => setValue({ ...value, companyKey })}
          />
          <Text
            label="شناسهٔ ثابت کالای هلو"
            dir="ltr"
            required
            value={value.externalItemId}
            onChange={(externalItemId) => setValue({ ...value, externalItemId })}
          />
        </fieldset>
        {initial && (
          <p className="muted">
            شرکت و شناسهٔ ثابت این نگاشت تغییر نمی‌کنند؛ برای شناسهٔ دیگر، نگاشت قبلی را غیرفعال و
            مورد تازه بسازید.
          </p>
        )}
        <Text
          label="کد نمایشی هلو (اختیاری)"
          dir="ltr"
          value={value.externalCode ?? ''}
          onChange={(externalCode) => setValue({ ...value, externalCode: externalCode || null })}
        />
        <div className="form-grid">
          <Text label="جست‌وجوی SKU یا نام کالا، حداقل دو حرف" value={draft} onChange={setDraft} />
          <button type="button" disabled={draft.trim().length < 2} onClick={() => setQuery(draft)}>
            یافتن تنوع کالا
          </button>
        </div>
        <ErrorBox error={choices.error} />
        {choices.isFetching ? (
          <Busy />
        ) : (
          choices.data && (
            <div className="accounting-choices">
              {choices.data.items.length ? (
                choices.data.items.map((item) => (
                  <button
                    type="button"
                    key={item.variantId}
                    aria-pressed={value.variantId === item.variantId}
                    onClick={() => {
                      setValue({ ...value, variantId: item.variantId });
                      setSelectedLabel(`${item.sku} — ${item.nameFa}`);
                    }}
                  >
                    <bdi>{item.sku}</bdi>
                    <span>
                      {item.nameFa}
                      {item.isActive ? '' : ' (SKU غیرفعال)'}
                    </span>
                  </button>
                ))
              ) : (
                <p>SKU فیزیکی با این جست‌وجو پیدا نشد.</p>
              )}
            </div>
          )
        )}
        <p className="notice">
          SKU انتخاب‌شده: <bdi>{selectedLabel || 'هنوز انتخاب نشده'}</bdi>
        </p>
        <Check
          label="نگاشت فعال باشد (به‌معنی فعال‌شدن همگام‌سازی نیست)"
          checked={value.isActive}
          onChange={(event) => setValue({ ...value, isActive: event.target.checked })}
        />
      </fieldset>
      {frozen && (
        <div className="notice" role="alert">
          <strong>نتیجهٔ ذخیره مشخص نیست.</strong>
          <p>
            کد نگاشت: <code dir="ltr">{id}</code> پیش از ساخت مورد جدید، نتیجه را بازخوانی یا همان
            درخواست را دوباره ارسال کنید. پیدا شدن یک رکورد به‌تنهایی ذخیرهٔ تغییرات شما را تأیید
            نمی‌کند.
          </p>
          <div className="row-buttons">
            <button type="button" disabled={busy} onClick={() => void recover()}>
              بازخوانی نتیجهٔ این نگاشت
            </button>
            <button type="button" disabled={busy} onClick={() => void send(frozen)}>
              ارسال دوبارهٔ همان نگاشت
            </button>
          </div>
          {recovered && (
            <div>
              <p>نگاشت فعلی دریافت‌شده:</p>
              <dl>
                <dt>کد نگاشت</dt>
                <dd>
                  <code dir="ltr">{recovered.id}</code>
                </dd>
                <dt>شرکت / شناسهٔ ثابت</dt>
                <dd>
                  <bdi>
                    {recovered.companyKey} / {recovered.externalItemId}
                  </bdi>
                </dd>
                <dt>کد نمایشی</dt>
                <dd>
                  <bdi>{recovered.externalCode ?? '—'}</bdi>
                </dd>
                <dt>SKU</dt>
                <dd>
                  <bdi>{recovered.sku}</bdi> — {recovered.nameFa}
                </dd>
                <dt>وضعیت</dt>
                <dd>{recovered.isActive ? 'فعال' : 'غیرفعال'}</dd>
              </dl>
            </div>
          )}
          <p>
            اگر فرم را ببندید، بدنهٔ تلاش مجدد از حافظه پاک می‌شود. برای پیگیری بعدی، کد نگاشت را
            نگه دارید؛ بستن فرم به معنی موفقیت ذخیره نیست.
          </p>
          <Check
            label="کد نگاشت را نگه داشته‌ام و نتیجهٔ ذخیره را هنوز تأییدشده نمی‌دانم."
            checked={reviewed}
            disabled={busy}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          <button type="button" disabled={busy || !reviewed} onClick={onClose}>
            بستن بدون تأیید ذخیره
          </button>
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy || !!frozen || !value.variantId}>
          {busy ? 'در حال پیگیری…' : 'ذخیرهٔ تطبیق'}
        </button>
        <button type="button" disabled={busy || !!frozen} onClick={onClose}>
          بستن
        </button>
      </div>
    </form>
  );
}

type Editing = { key: string; link: AccountingLink | null };
export function AccountingPage({
  writable,
  inventoryReadable,
  inventoryWritable,
  viewerId,
  onManageUnits,
}: {
  writable: boolean;
  inventoryReadable: boolean;
  inventoryWritable: boolean;
  viewerId: string;
  onManageUnits: () => void;
}) {
  const [draft, setDraft] = useState({ company: '', query: '', enabled: 'all' });
  const [filter, setFilter] = useState(draft);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [generation, setGeneration] = useState(0);
  const [editing, setEditing] = useState<Editing>();
  const [locked, setLocked] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>();
  const client = useQueryClient();
  const editRequest = useRef<{ number: number; controller: AbortController } | null>(null);
  const editNumber = useRef(0);
  const canEdit = useRef(writable);
  canEdit.current = writable;
  function cancelEditLoad() {
    editNumber.current++;
    editRequest.current?.controller.abort();
    editRequest.current = null;
  }
  useEffect(() => () => cancelEditLoad(), []);
  useEffect(() => {
    if (!writable) {
      cancelEditLoad();
      setLoadingId(null);
      setEditing(undefined);
      setLocked(false);
    }
  }, [writable]);
  const status = useQuery({
    queryKey: ['admin', 'holoo-status'],
    queryFn: async () => holooStatusSchema.parse(await api<unknown>(base + '/status')),
    retry: false,
  });
  const page = useQuery({
    queryKey: ['admin', 'holoo-links', filter, cursors.at(-1), generation],
    queryFn: async ({ signal }) =>
      accountingPageSchema.parse(
        await api<unknown>(
          accountingListPath(filter.company, filter.query, filter.enabled, cursors.at(-1)!),
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
    void client.invalidateQueries({ queryKey: ['admin', 'holoo-links'] });
  }
  function openNew() {
    if (!canEdit.current || locked) return;
    cancelEditLoad();
    setLoadingId(null);
    setActionError(undefined);
    setLocked(false);
    setEditing({ key: crypto.randomUUID(), link: null });
  }
  async function edit(id: string) {
    if (!canEdit.current || locked) return;
    cancelEditLoad();
    const number = editNumber.current;
    const controller = new AbortController();
    editRequest.current = { number, controller };
    setLoadingId(id);
    setActionError(undefined);
    try {
      const link = accountingLinkSchema.parse(
        await api<unknown>(base + '/links/' + id, { signal: controller.signal }),
      );
      if (controller.signal.aborted || number !== editNumber.current || !canEdit.current) return;
      if (link.id !== id) throw new Error('شناسهٔ پاسخ ویرایش با نگاشت انتخاب‌شده یکسان نیست.');
      setLocked(false);
      setEditing({ key: `${id}:${number}`, link });
    } catch (error) {
      if (!controller.signal.aborted && number === editNumber.current && canEdit.current)
        setActionError(error);
    } finally {
      if (number === editNumber.current) {
        editRequest.current = null;
        setLoadingId(null);
      }
    }
  }
  function closeEditor() {
    setEditing(undefined);
    setLocked(false);
  }

  return (
    <>
      <section className="panel">
        <h2>اتصال به هلو</h2>
        <ErrorBox error={status.error} />
        {status.isPending ? (
          <Busy />
        ) : (
          status.data && (
            <div className="notice" role="status">
              <strong>دریافت زنده از هلو هنوز پیکربندی نشده است.</strong>
              <p>
                نسخه و ماژول وب‌سرویس نصب‌شده مشخص نشده‌اند. فعلاً تطبیق کد کالاها آماده است؛ هیچ
                موجودی، قیمت یا سندی از هلو دریافت یا در آن ثبت نمی‌شود.
              </p>
              <a
                href="https://holoostore.com/product/webcom-web-service/"
                target="_blank"
                rel="noreferrer"
              >
                معرفی وب‌سرویس وب‌کام در هلواستور
              </a>
            </div>
          )
        )}
      </section>
      <section className="panel accounting-links">
        <div className="section-heading">
          <div>
            <h2>تطبیق کالاهای هلو و سایت</h2>
            <p>
              هر شناسهٔ ثابت، در محدودهٔ همان شرکت، به SKU مستقل سایت متصل می‌شود. صفر ابتدایی و
              حروف شناسه حفظ می‌شوند.
            </p>
          </div>
          <div className="row-buttons">
            <button onClick={refresh}>تازه‌سازی</button>
            {writable && (
              <button className="primary" disabled={locked} onClick={openNew}>
                افزودن تطبیق کالا
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

          label="فیلتر تطبیق کالاهای هلو"
          search={
            <Text
              label="شناسه، کد هلو یا SKU"
              value={draft.query}
              onChange={(query) => setDraft({ ...draft, query })}
            />
          }
          actions={
            <>
              <button className="primary">جست‌وجو</button>
              <button
                type="button"
                onClick={() => {
                  const empty = { company: '', query: '', enabled: 'all' };
                  setDraft(empty);
                  setFilter(empty);
                  setCursors([null]);
                  setGeneration((value) => value + 1);
                }}
              >
                پاک‌کردن فیلترها
              </button>
            </>
          }
          applied={[
            filter.query ? 'جست‌وجو: ' + filter.query : '',
            filter.company ? 'شرکت: ' + filter.company : '',
            filter.enabled === 'all'
              ? ''
              : filter.enabled === 'true'
                ? 'نگاشت فعال'
                : 'نگاشت غیرفعال',
          ].filter(Boolean)}
        >
          <Text
            label="شرکت/پایگاه هلو (تطبیق دقیق)"
            dir="ltr"
            value={draft.company}
            onChange={(company) => setDraft({ ...draft, company })}
          />

          <Field label="وضعیت نگاشت">
            <select
              value={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.value })}
            >
              <option value="all">همه</option>
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </select>
          </Field>
        </AdminFilterForm>
        <ErrorBox error={page.error} />
        <ErrorBox error={actionError} />
        {loadingId && <Busy />}
        {page.isPending ? (
          <Busy />
        ) : page.error ? (
          <button onClick={() => void page.refetch()}>بازخوانی فهرست</button>
        ) : (
          page.data && (
            <>
              <div className="table-wrap" role="region" aria-label="تطبیق کالاهای هلو" tabIndex={0}>
                <AdminTable>
                  <thead>
                    <tr>
                      <th>شرکت / شناسهٔ ثابت / کد</th>
                      <th>SKU سایت</th>
                      <th>وضعیت</th>
                      {writable && <th>عملیات</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {page.data.items.map((link) => (
                      <tr key={link.id}>
                        <td>
                          <bdi>{link.companyKey}</bdi>
                          <small>
                            <bdi>{link.externalItemId}</bdi>
                          </small>
                          <small>
                            <bdi>{link.externalCode ?? '—'}</bdi>
                          </small>
                        </td>
                        <td>
                          <bdi>{link.sku}</bdi>
                          <small>{link.nameFa}</small>
                          <small>{link.nameEn}</small>
                        </td>
                        <td>{link.isActive ? 'فعال' : 'غیرفعال'}</td>
                        {writable && (
                          <td>
                            <button disabled={locked} onClick={() => void edit(link.id)}>
                              ویرایش تطبیق
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {!page.data.items.length && (
                      <tr>
                        <td colSpan={writable ? 4 : 3}>نگاشتی با این فیلتر وجود ندارد.</td>
                      </tr>
                    )}
                  </tbody>
                </AdminTable>
              </div>
              <div className="pagination">
                <button
                  disabled={cursors.length === 1 || page.isFetching}
                  onClick={() => setCursors((value) => value.slice(0, -1))}
                >
                  صفحهٔ قبل
                </button>
                <span>صفحهٔ {cursors.length.toLocaleString('fa-IR')}</span>
                <button
                  disabled={!page.data.nextCursor || page.isFetching}
                  onClick={() => setCursors((value) => [...value, page.data!.nextCursor])}
                >
                  ۵۰ ردیف بعدی
                </button>
              </div>
            </>
          )
        )}
      </section>
      {inventoryReadable && (
        <AccountingWarehouses
          viewerId={viewerId}
          writable={inventoryWritable}
          onManageUnits={onManageUnits}
        />
      )}
      {inventoryReadable && (
        <AccountingStockCommandPanel viewerId={viewerId} writable={inventoryWritable} />
      )}
      <AccountingImports
        writable={writable}
        inventoryReadable={inventoryReadable}
        inventoryWritable={inventoryWritable}
        viewerId={viewerId}
        onManageUnits={onManageUnits}
      />
      {writable && editing && (
        <Modal
          key={editing.key}
          title={editing.link ? 'ویرایش تطبیق هلو' : 'تطبیق کالای هلو با سایت'}
          preventClose={locked}
          onClose={() => {
            if (!locked) closeEditor();
          }}
        >
          <LinkForm
            key={editing.key}
            initial={editing.link ?? undefined}
            onSaved={refresh}
            onClose={closeEditor}
            onLock={setLocked}
          />
        </Modal>
      )}
    </>
  );
}

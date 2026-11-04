import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { AdminFilterForm } from '../../components/filters/admin-filters';
import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { Busy, Check, ErrorBox, Field, Modal } from '../../components/ui';
import {
  commandTarget,
  freezeCommand,
  latinDigits,
  utcFromInput,
  type RecoveredAdminCommand,
} from '../../features/market/sourcing-admin-command';
import {
  commandPermitted,
  inventorySourcingStockInvalidations,
} from '../../features/market/sourcing-command-protocol';
import { useSourcingCommand } from '../../features/market/sourcing-pending';
import { useSourcingRunner } from '../../hooks/use-sourcing-runner';
import {
  inventorySupplyDetailV2Schema as inventorySupplyDetailSchema,
  inventorySupplyPageV2Schema as inventorySupplyPageSchema,
  inventorySupplyPath,
  mappingInputSchema,
  mappingPageSchema,
  mappingSchema,
  receivingDataSchema,
  receivingInputSchema,
  receivingQuantity,
  sourceKey,
  sameReceivingSku,
  supplyIdSchema,
  supplyNames,
  type InventorySupplyDetail,
  type ReceivingMapping,
} from '../../api/contracts/market/supply-contract';
import {
  emptyInventoryFilters,
  inventoryPath,
  readInventoryPage,
  type InventoryRow,
} from '../../api/contracts/inventory/inventory-contract';
import { parseReceipt } from '../../api/contracts/inventory/serial-contract';
import { OpaqueSourcingCommand } from '../../features/market/opaque-sourcing-command';
import { SupplyAllocationStatus } from '../../features/market/supply-allocation-status';
import { SourcingAllocation } from '../../features/market/sourcing-allocation';
import { manualAllocationReceiptRecovery } from '../../features/market/sourcing-receipt-recovery';
import { HolooSourcePicker } from '../../features/accounting/holoo-source-picker';
import {
  convertAccountingQuantity,
  type HolooSource,
} from '../../api/contracts/accounting/accounting-reconciliation-contract';

const uuid = () => crypto.randomUUID().replaceAll('-', '');
const count = (value: number) => value.toLocaleString('fa-IR');
const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
const emptyFilters = { originSystem: '', companyKey: '', warehouseKey: '', variantId: '' };
function mappingPath(filters: typeof emptyFilters, cursor: string | null) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set('cursor', cursor);
  return '/admin/inventory/receiving-unit-mappings' + (params.size ? '?' + params : '');
}
const readableError = (failure: unknown) =>
  failure instanceof Error && failure.message.startsWith('[')
    ? new Error('اطلاعات لازم، قالب کلیدها، نسخه و زمان UTC را بررسی کنید.')
    : failure;
type Runner = ReturnType<typeof useSourcingRunner>;
export function SourcingReceivingPage({
  viewerId,
  writable,
  initialTab = 'tasks',
  mappingsOnly = false,
  initialSource,
  onAccounting,
}: {
  viewerId: string;
  writable: boolean;
  initialTab?: 'tasks' | 'mappings';
  mappingsOnly?: boolean;
  initialSource?: HolooSource;
  onAccounting?: () => void;
}) {
  const pending = useSourcingCommand(viewerId).data;
  const stored =
      !mappingsOnly || (pending && commandTarget(pending).domain === 'mapping') ? pending : null,
    permissions = { sales: false, financial: false, inventory: writable };
  const [tab, setTab] = useState<'tasks' | 'mappings'>(initialTab),
    [selected, setSelected] = useState<string | null>(null),
    [mapping, setMapping] = useState<string | null>(null),
    [receipt, setReceipt] = useState<string | null>(null),
    [allocationFocus, setAllocationFocus] = useState<{ taskId: string; id: string } | null>(null),
    [editRevision, setEditRevision] = useState(0),
    [error, setError] = useState<unknown>(),
    [draft, setDraft] = useState({ state: 'all', query: '' }),
    [filters, setFilters] = useState(draft);
  const runner = useSourcingRunner(
    viewerId,
    permissions,
    (focus) => {
      if (focus.taskId && !mappingsOnly) {
        setTab('tasks');
        setSelected(focus.taskId);
      }
      if (focus.mappingId) {
        setTab('mappings');
        setMapping(focus.mappingId);
      }
      if (focus.receiptId && !mappingsOnly) setReceipt(focus.receiptId);
      if (focus.allocationId && focus.taskId)
        setAllocationFocus({ taskId: focus.taskId, id: focus.allocationId });
    },
    setError,
  );
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'inventory-sourcing-tasks', filters],
    queryFn: async ({ pageParam }) => {
      const result = inventorySupplyPageSchema.parse(
        await api<unknown>(inventorySupplyPath(filters, pageParam)),
      );
      if (filters.state !== 'all' && result.items.some((item) => item.task.state !== filters.state))
        throw new Error('پاسخ با فیلتر وضعیت پیگیری یکسان نیست.');
      return result;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !mappingsOnly && tab === 'tasks',
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: ['admin', 'inventory-sourcing-task', selected],
    queryFn: async () => {
      const value = inventorySupplyDetailSchema.parse(
        await api<unknown>('/admin/inventory/sourcing-tasks/v2/' + selected),
      );
      if (value.task.task.id !== selected) throw new Error('پاسخ به پیگیری انتخاب‌شده تعلق ندارد.');
      return value;
    },
    enabled: !mappingsOnly && tab === 'tasks' && !!selected,
    refetchOnWindowFocus: false,
  });
  const items = Array.from(
    new Map(
      pages.data?.pages.flatMap((page) => page.items).map((item) => [item.task.id, item]) ?? [],
    ).values(),
  );
  const locked = runner.busy || !!stored;
  const taskModalOpen = tab === 'tasks' && selected !== null;
  const commandPanel = (
    <>
      {stored &&
        (commandPermitted(stored, permissions) ? (
          <div className="notice" role="status">
            <strong>
              {stored.phase === 'refresh'
                ? 'ثبت فرمان تأیید شد؛ وضعیت جاری لازم است'
                : stored.phase === 'failed'
                  ? 'فرمان پذیرفته نشد'
                  : 'فرمان در انتظار نتیجهٔ قطعی است'}
            </strong>
            <p>{stored.message}</p>
            <p>
              شناسهٔ فرمان: <bdi>{stored.id}</bdi>
            </p>
            <p>
              نوع فرمان: <bdi>{commandTarget(stored).operation}</bdi>
              {commandTarget(stored).taskId && (
                <>
                  {' '}
                  · پیگیری <bdi>{commandTarget(stored).taskId}</bdi>
                </>
              )}
              {commandTarget(stored).resourceId && (
                <>
                  {' '}
                  · سند، نگاشت یا تخصیص <bdi>{commandTarget(stored).resourceId}</bdi>
                </>
              )}
            </p>
            <div className="row-buttons">
              {stored.phase === 'refresh' ? (
                <button disabled={runner.busy} onClick={() => void runner.refresh(stored)}>
                  دریافت وضعیت پس از ثبت — بدون ارسال دوبارهٔ فرمان
                </button>
              ) : (
                <>
                  <button
                    disabled={runner.busy || !commandPermitted(stored, permissions)}
                    onClick={() => void runner.recover(stored)}
                  >
                    پیگیری رسید همین فرمان
                  </button>
                  <button
                    disabled={runner.busy || !commandPermitted(stored, permissions)}
                    onClick={() => void runner.send(stored)}
                  >
                    تلاش دوباره با همان شناسه
                  </button>
                </>
              )}
              {stored.phase === 'failed' && (
                <button
                  disabled={runner.busy}
                  onClick={() => {
                    if (!runner.discardFailed(stored, inventorySourcingStockInvalidations()))
                      return;
                    setEditRevision((value) => value + 1);
                    void pages.refetch();
                    if (selected) void detail.refetch();
                  }}
                >
                  بازبینی و اصلاح تازه
                </button>
              )}
            </div>
            {!commandPermitted(stored, permissions) && (
              <p>فرمان محفوظ مربوط به بخش دیگری است؛ برای پیگیری به همان بخش پنل بروید.</p>
            )}
            <small>
              فرمان در حافظهٔ همین تب و فقط برای همین حساب حفظ می‌شود. پیدا نشدن رسید، انجام‌نشدن
              فرمان را ثابت نمی‌کند.
            </small>
          </div>
        ) : (
          <OpaqueSourcingCommand />
        ))}
      <ErrorBox error={error} />
    </>
  );
  if (mappingsOnly)
    return (
      <section className="panel sourcing-receiving holoo-workspace">
        <div className="section-heading">
          <div>
            <h2>نگاشت واحدهای هلو</h2>
            <p>واحد هر کالا را برای شرکت و انبار مبدأ به واحد فروش سایمان تبدیل کنید.</p>
          </div>
          {onAccounting && (
            <button type="button" onClick={onAccounting}>
              منابع و اتصال هلو
            </button>
          )}
        </div>
        {commandPanel}
        <ReceivingMappings
          writable={writable}
          locked={locked}
          selected={mapping}
          onSelected={setMapping}
          onCommand={runner.send}
          holooOnly
          initialSource={initialSource}
        />
        {writable && !stored && (
          <InventoryReceiptLookup
            mappingsOnly
            busy={runner.busy}
            onRecover={(command) => void runner.recover(command)}
          />
        )}
      </section>
    );
  return (
    <section className="panel sourcing-receiving">
      <div className="section-heading">
        <div>
          <h2>دریافت واقعی تأمین</h2>
          <p>
            افزایش موجودی فقط برای کالایی که واقعاً تحویل انبار شده است. این صفحه اطلاعات خصوصی
            مشتری یا قیمت پیشنهاد را دریافت نمی‌کند.
          </p>
        </div>
        <button
          disabled={runner.busy}
          onClick={() => {
            if (stored?.phase === 'refresh' && commandPermitted(stored, permissions))
              void runner.refresh(stored);
            else {
              void pages.refetch();
              if (selected) void detail.refetch();
            }
          }}
        >
          دریافت وضعیت تازه
        </button>
      </div>
      {!taskModalOpen && commandPanel}
      {writable && !stored && (
        <InventoryReceiptLookup
          busy={runner.busy}
          onRecover={(command) => void runner.recover(command)}
        />
      )}
      <div className="row-buttons" role="group" aria-label="بخش دریافت تأمین">
        <button aria-pressed={tab === 'tasks'} onClick={() => setTab('tasks')}>
          پیگیری‌ها و ثبت دریافت
        </button>
        <button aria-pressed={tab === 'mappings'} onClick={() => setTab('mappings')}>
          نگاشت واحد دریافت
        </button>
      </div>
      {tab === 'mappings' ? (
        <ReceivingMappings
          key="mappings"
          writable={writable}
          locked={locked}
          selected={mapping}
          onSelected={setMapping}
          onCommand={runner.send}
        />
      ) : (
        <>
          <AdminFilterForm
            onSubmit={(event) => {
              event.preventDefault();
              try {
                inventorySupplyPath(draft, null);
                setFilters({ ...draft });
                setError(undefined);
              } catch (failure) {
                setError(readableError(failure));
              }
            }}

            label="فیلتر پیگیری‌های انبار"
            search={
              <Field label="جست‌وجوی SKU، نام کالا یا شناسهٔ پیگیری">
                <input
                  maxLength={120}
                  value={draft.query}
                  onChange={(event) => setDraft({ ...draft, query: event.target.value })}
                />
              </Field>
            }
            actions={
              <>
                <button className="primary" disabled={pages.isFetching}>
                  جست‌وجوی پیگیری‌های انبار
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const empty = { state: 'all', query: '' };
                    setDraft(empty);
                    setFilters(empty);
                  }}
                >
                  پاک‌کردن فیلترها
                </button>
              </>
            }
            applied={[
              filters.query ? 'جست‌وجو: ' + filters.query : '',
              filters.state === 'all' ? '' : (supplyNames[filters.state] ?? filters.state),
            ].filter(Boolean)}
          >
            <Field label="وضعیت پیگیری تأمین">
              <select
                value={draft.state}
                onChange={(event) => setDraft({ ...draft, state: event.target.value })}
              >
                <option value="all">همهٔ وضعیت‌ها</option>
                {[
                  'PendingSupply',
                  'SupplierRequested',
                  'SupplierOrderRecorded',
                  'Cancelled',
                  'Failed',
                ].map((state) => (
                  <option key={state} value={state}>
                    {supplyNames[state]}
                  </option>
                ))}
              </select>
            </Field>
          </AdminFilterForm>
          <ErrorBox error={pages.error} />
          {pages.isPending ? (
            <Busy />
          ) : (
            <>
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label="پیگیری‌های قابل مشاهدهٔ انبار"
              >
                <AdminTable>
                  <thead>
                    <tr>
                      <th>درخواست</th>
                      <th>وضعیت</th>
                      <th>لازم / دریافت / باقی‌مانده</th>
                      <th>جزئیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.task.id}>
                        <td>
                          <bdi>{item.requestReference}</bdi>
                          {item.task.isDemo && <small>نمونهٔ توسعه</small>}
                        </td>
                        <td>
                          {supplyNames[item.task.effectiveState]}
                          {item.task.allocation && (
                            <small>
                              {' '}
                              · تخصیص ثبت‌شده تا {date(item.task.allocation.expiresAt)}
                            </small>
                          )}
                        </td>
                        <td>
                          {count(item.task.requiredQuantity)} / {count(item.task.receivedQuantity)}{' '}
                          / {count(item.task.remainingQuantity)}
                        </td>
                        <td>
                          <button disabled={runner.busy} onClick={() => setSelected(item.task.id)}>
                            بررسی و ثبت دریافت
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!items.length && (
                      <tr>
                        <td colSpan={4}>پیگیری تأمینی ثبت نشده است.</td>
                      </tr>
                    )}
                  </tbody>
                </AdminTable>
              </div>
              {pages.hasNextPage && (
                <button
                  disabled={pages.isFetchingNextPage}
                  onClick={() => void pages.fetchNextPage()}
                >
                  ۵۰ پیگیری بعدی
                </button>
              )}
            </>
          )}
          {selected && (
            <Modal
              title={
                detail.data
                  ? 'دریافت واقعی · ' + detail.data.task.requestReference
                  : 'جزئیات دریافت'
              }
              preventClose={runner.busy}
              onClose={() => setSelected(null)}
            >
              {commandPanel}
              <ErrorBox error={detail.error} />
              {detail.isPending ? (
                <Busy />
              ) : (
                detail.data && (
                  <>
                    <InventoryTaskSnapshot value={detail.data} />
                    <SourcingAllocation
                      key={selected + ':' + editRevision}
                      taskId={selected}
                      writable={writable}
                      locked={locked}
                      focusAllocationId={
                        allocationFocus?.taskId === selected ? allocationFocus.id : null
                      }
                      onCommand={runner.send}
                    />
                    <button
                      disabled={runner.busy || detail.isFetching}
                      onClick={() => void detail.refetch()}
                    >
                      دریافت تازهٔ پیگیری و مانده
                    </button>
                    {writable && detail.data.task.canReceive && (
                      <ReceivingForm
                        key={
                          detail.data.task.task.version +
                          ':' +
                          detail.dataUpdatedAt +
                          ':' +
                          editRevision
                        }
                        value={detail.data}
                        locked={locked || detail.isError || detail.fetchStatus !== 'idle'}
                        onCommand={runner.send}
                      />
                    )}
                  </>
                )
              )}
            </Modal>
          )}
        </>
      )}
      {receipt && (
        <Modal title="سند دریافت ثبت‌شده" onClose={() => setReceipt(null)}>
          <ReceivingReceipt id={receipt} />
        </Modal>
      )}
    </section>
  );
}
function InventoryTaskSnapshot({ value }: { value: InventorySupplyDetail }) {
  const task = value.task;
  return (
    <>
      <h3>{supplyNames[task.task.effectiveState]}</h3>
      <SupplyAllocationStatus
        allocation={task.task.allocation}
        reserved={task.reservedForRequest}
      />
      <p>
        شناسهٔ پیگیری: <bdi>{task.task.id}</bdi>
      </p>
      {task.requiresHistoricalAcknowledgement && (
        <p className="notice">
          این دریافت مربوط به پذیرش تاریخی، منقضی یا شرایط تغییرکرده است؛ ثبت واقعیت انبار به تأیید
          صریح نیاز دارد و پیشنهاد تازه برای ادامهٔ خرید لازم است.
        </p>
      )}
      {task.lines.map((line) => {
        const stock = value.stock.find((item) => sameReceivingSku(item.variantId, line.variantId))!;
        return (
          <article className="sourcing-request-line" key={line.offerLineId}>
            <h4>
              {line.nameFa} · {line.labelFa}
            </h4>
            <p>
              <bdi>{line.sku}</bdi>
            </p>
            <p>
              لازم {count(line.requiredQuantity)} · دریافت {count(line.receivedQuantity)} ·
              باقی‌مانده {count(line.remainingQuantity)}
            </p>
            <p>
              روش رهگیری:{' '}
              {({ none: 'بدون شناسه', serial: 'سریال', imei: 'IMEI' } as const)[stock.trackingMode]}{' '}
              · ماندهٔ فیزیکی {count(stock.onHand)} · رزرو سفارش {count(stock.reserved)}
            </p>
          </article>
        );
      })}
    </>
  );
}
function InventoryReceiptLookup({
  busy,
  onRecover,
  mappingsOnly = false,
}: {
  busy: boolean;
  onRecover: (command: RecoveredAdminCommand) => void;
  mappingsOnly?: boolean;
}) {
  const [fields, setFields] = useState({
      kind: mappingsOnly ? 'mapping' : 'receiving',
      resourceId: '',
      requestId: '',
      taskId: '',
      commandId: '',
    }),
    [error, setError] = useState<unknown>();
  function submit() {
    setError(undefined);
    try {
      if (fields.kind === 'allocation-allocate' || fields.kind === 'allocation-release') {
        onRecover(
          manualAllocationReceiptRecovery(
            {
              operation: fields.kind === 'allocation-allocate' ? 'allocate' : 'release',
              requestId: fields.requestId,
              taskId: fields.taskId,
              resourceId: fields.resourceId,
              commandId: fields.commandId,
            },
            true,
          ),
        );
        return;
      }
      const resourceId = supplyIdSchema.parse(fields.resourceId),
        id = supplyIdSchema.parse(fields.commandId),
        target =
          fields.kind === 'mapping'
            ? { domain: 'mapping' as const, operation: 'save', resourceId }
            : {
                domain: 'receiving' as const,
                operation: 'receive',
                resourceId,
                requestId: supplyIdSchema.parse(fields.requestId),
                taskId: supplyIdSchema.parse(fields.taskId),
              };
      onRecover({
        kind: 'recovered',
        id,
        reference: resourceId,
        target,
        body: { requestId: id },
        phase: 'refresh',
      });
    } catch (failure) {
      setError(readableError(failure));
    }
  }
  const input = (key: 'resourceId' | 'requestId' | 'taskId' | 'commandId', label: string) => (
    <Field label={label}>
      <input
        dir="ltr"
        maxLength={32}
        value={fields[key]}
        onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
      />
    </Field>
  );
  return (
    <details>
      <summary>پیگیری رسید با شناسه‌های ذخیره‌شده</summary>
      <p>
        رسید فقط برای حساب اجراکننده در دسترس است. دریافت سند و وضعیت جاری پس از تأیید رسید انجام
        می‌شود.
      </p>
      <ErrorBox error={error} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            {!mappingsOnly && (
              <Field label="نوع فرمان">
                <select
                  value={fields.kind}
                  onChange={(event) => setFields({ ...fields, kind: event.target.value })}
                >
                  <option value="receiving">ثبت دریافت واقعی</option>
                  <option value="mapping">ذخیرهٔ نگاشت واحد</option>
                  <option value="allocation-allocate">تخصیص سهم موجودی</option>
                  <option value="allocation-release">آزادسازی تخصیص</option>
                </select>
              </Field>
            )}
            {input(
              'resourceId',
              fields.kind === 'mapping'
                ? 'شناسهٔ نگاشت'
                : fields.kind.startsWith('allocation-')
                  ? 'شناسهٔ تخصیص'
                  : 'شناسهٔ سند دریافت',
            )}
            {input('commandId', 'شناسهٔ فرمان UUID بدون خط تیره')}
            {fields.kind !== 'mapping' && (
              <>
                {input('requestId', 'شناسهٔ درخواست')}
                {input('taskId', 'شناسهٔ پیگیری تأمین')}
              </>
            )}
          </div>
          <button>پیگیری رسید</button>
        </fieldset>
      </form>
    </details>
  );
}
function ReceivingMappings({
  writable,
  locked,
  selected,
  onSelected,
  onCommand,
  holooOnly = false,
  initialSource,
}: {
  writable: boolean;
  locked: boolean;
  selected: string | null;
  onSelected: (id: string | null) => void;
  onCommand: Runner['send'];
  holooOnly?: boolean;
  initialSource?: HolooSource;
}) {
  const [source, setSource] = useState(initialSource);
  const [draft, setDraft] = useState(() => ({
      ...emptyFilters,
      originSystem: holooOnly ? 'holoo' : '',
      companyKey: initialSource?.companyKey ?? '',
      warehouseKey: initialSource?.externalWarehouseKey ?? '',
    })),
    [filters, setFilters] = useState(draft),
    [editing, setEditing] = useState(false),
    [error, setError] = useState<unknown>();
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'receiving-unit-mappings', filters],
    queryFn: async ({ pageParam }) =>
      mappingPageSchema.parse(await api<unknown>(mappingPath(filters, pageParam))),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: ['admin', 'receiving-unit-mapping', selected],
    queryFn: async () => {
      const value = mappingSchema.parse(
        await api<unknown>('/admin/inventory/receiving-unit-mappings/' + selected),
      );
      if (value.id !== selected) throw new Error('نگاشت دریافتی با هدف یکسان نیست.');
      return value;
    },
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const items = Array.from(
    new Map(
      pages.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]) ?? [],
    ).values(),
  );
  return (
    <section>
      <div className="section-heading">
        <div>
          <h3>نگاشت صریح واحد مبدأ به واحد فروش</h3>
          <p>
            کلید شرکت و انبار، منشأ سند هستند؛ این مرحله موجودی تفکیکی چندانبار یا اتصال زندهٔ هلو
            ندارد.
          </p>
        </div>
        {writable && (
          <button
            disabled={locked}
            onClick={() => {
              onSelected(null);
              setEditing(true);
            }}
          >
            نگاشت واحد تازه
          </button>
        )}
      </div>
      {holooOnly && (
        <>
          <details className="notice">
            <summary>راهنمای نگاشت و نمونهٔ تبدیل</summary>
            <ol>
              <li>شرکت و انبار همان گزارش را انتخاب کنید یا کلیدهای آن‌ها را عیناً وارد کنید.</li>
              <li>شناسهٔ واحد را از خروجی همان هلو بردارید و تنوع سایت را با SKU پیدا کنید.</li>
              <li>
                برای هر کارتن ۶ عدد، نسبت ۶ به ۱ وارد کنید. اگر مبدأ و مقصد هر دو «عدد» هستند، نسبت
                ۱ به ۱ است.
              </li>
              <li>
                تبدیل را با تعداد واقعی پیش‌نمایش کنید. عدد اعشاری گرد نمی‌شود و مانده با ذخیرهٔ
                نگاشت تغییر نمی‌کند.
              </li>
            </ol>
          </details>
          <HolooSourcePicker
            source={source}
            disabled={locked || editing}
            onSelect={(next) => {
              setSource(next);
              const change = (old: typeof emptyFilters) => ({
                ...old,
                companyKey: next?.companyKey ?? '',
                warehouseKey: next?.externalWarehouseKey ?? '',
              });
              setDraft(change);
              setFilters(change);
              onSelected(null);
            }}
          />
        </>
      )}
      <ErrorBox error={error ?? pages.error} />
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            for (const [key, value] of Object.entries(draft))
              if (value) sourceKey(key === 'variantId' ? 64 : 64).parse(value);
            setFilters({ ...draft });
            onSelected(null);
            setError(undefined);
          } catch (failure) {
            setError(readableError(failure));
          }
        }}
      >
        {Object.entries({
          originSystem: 'سامانهٔ مبدأ',
          companyKey: 'کلید شرکت',
          warehouseKey: 'کلید انبار مبدأ',
          variantId: 'شناسهٔ تنوع برای فیلتر',
        })
          .filter(([key]) => !holooOnly || key !== 'originSystem')
          .map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                dir="ltr"
                maxLength={64}
                value={draft[key as keyof typeof draft]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </Field>
          ))}
        <div className="row-buttons">
          <button disabled={pages.isFetching || editing}>فیلتر نگاشت‌ها</button>
          <button type="button" disabled={pages.isFetching} onClick={() => void pages.refetch()}>
            تازه‌سازی
          </button>
        </div>
      </form>
      <div className="table-wrap" role="region" aria-label="نگاشت واحدهای دریافت" tabIndex={0}>
        <AdminTable>
          <thead>
            <tr>
              <th>سامانه / شرکت / انبار</th>
              <th>واحد منبع / تنوع</th>
              <th>نسبت</th>
              <th>وضعیت</th>
              <th>جزئیات</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <bdi>
                    {item.originSystem} / {item.companyKey} / {item.warehouseKey}
                  </bdi>
                </td>
                <td>
                  {item.nameFa}
                  <br />
                  <bdi>
                    {item.sourceUnitKey} / {item.variantId}
                  </bdi>
                </td>
                <td>
                  <bdi>
                    {item.numerator} / {item.denominator}
                  </bdi>
                </td>
                <td>{item.isActive ? 'فعال' : 'غیرفعال'}</td>
                <td>
                  <button
                    disabled={locked}
                    onClick={() => {
                      onSelected(item.id);
                      setEditing(false);
                    }}
                  >
                    نمایش نگاشت
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && !pages.isPending && (
              <tr>
                <td colSpan={5}>نگاشتی با این فیلتر ثبت نشده است.</td>
              </tr>
            )}
          </tbody>
        </AdminTable>
      </div>
      {pages.isPending && <Busy />}
      {pages.hasNextPage && (
        <button disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          ۵۰ نگاشت بعدی
        </button>
      )}
      {selected && (
        <article className="receiving-mapping-detail">
          <ErrorBox error={detail.error} />
          {detail.isPending ? (
            <Busy />
          ) : (
            detail.data && (
              <>
                <p>
                  شناسهٔ نگاشت: <bdi>{detail.data.id}</bdi> · نسخه: <bdi>{detail.data.version}</bdi>
                </p>
                <p>
                  {detail.data.nameFa} · <bdi>{detail.data.nameEn}</bdi> · نسبت{' '}
                  <bdi>
                    {detail.data.numerator}/{detail.data.denominator}
                  </bdi>
                </p>
                <p>
                  هویت منبع و SKU نگاشت موجود قابل جابه‌جایی نیست؛ برای هویت دیگر، نگاشت تازه
                  بسازید.
                </p>
                <button
                  disabled={locked || detail.isFetching}
                  onClick={() => void detail.refetch()}
                >
                  دریافت تازهٔ نگاشت
                </button>
                {writable && !editing && (
                  <button
                    disabled={locked || detail.isError || detail.fetchStatus !== 'idle'}
                    onClick={() => setEditing(true)}
                  >
                    ویرایش نسبت، نام یا فعالیت
                  </button>
                )}
              </>
            )
          )}
        </article>
      )}
      {writable && editing && (!selected || detail.data) && (
        <MappingEditor
          key={selected ? selected + ':' + detail.dataUpdatedAt : 'new'}
          initial={selected ? detail.data! : null}
          defaults={holooOnly ? filters : undefined}
          locked={locked || (!!selected && (detail.isError || detail.fetchStatus !== 'idle'))}
          onCancel={() => setEditing(false)}
          onCommand={onCommand}
        />
      )}
    </section>
  );
}
function MappingEditor({
  initial,
  defaults,
  locked,
  onCancel,
  onCommand,
}: {
  initial: ReceivingMapping | null;
  defaults?: typeof emptyFilters;
  locked: boolean;
  onCancel: () => void;
  onCommand: Runner['send'];
}) {
  const [resourceId] = useState(initial?.id ?? uuid()),
    [fields, setFields] = useState(() => ({
      originSystem: initial?.originSystem ?? defaults?.originSystem ?? '',
      companyKey: initial?.companyKey ?? defaults?.companyKey ?? '',
      warehouseKey: initial?.warehouseKey ?? defaults?.warehouseKey ?? '',
      sourceUnitKey: initial?.sourceUnitKey ?? '',
      variantId: initial?.variantId ?? '',
      numerator: initial ? String(initial.numerator) : '',
      denominator: initial ? String(initial.denominator) : '',
      nameFa: initial?.nameFa ?? '',
      nameEn: initial?.nameEn ?? '',
      isActive: initial?.isActive ?? false,
    })),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<unknown>();
  const [trial, setTrial] = useState('');
  function positive(value: string) {
    const normalized = latinDigits(value);
    if (!/^[1-9][0-9]{0,6}$/.test(normalized) || Number(normalized) > 1000000)
      throw new Error('صورت و مخرج باید صحیح مثبت و حداکثر یک میلیون باشند.');
    return Number(normalized);
  }
  let trialResult: string | undefined;
  let trialError: string | undefined;
  if (trial.trim()) {
    try {
      trialResult = count(
        convertAccountingQuantity(
          latinDigits(trial.trim()).replace('٫', '.'),
          positive(fields.numerator),
          positive(fields.denominator),
        ),
      );
    } catch (error) {
      trialError = error instanceof Error ? error.message : 'نسبت و مقدار مبدأ را بررسی کنید.';
    }
  }
  async function submit() {
    setError(undefined);
    try {
      if (locked || !confirm) return;
      const id = uuid(),
        body = mappingInputSchema.parse({
          ...fields,
          requestId: id,
          numerator: positive(fields.numerator),
          denominator: positive(fields.denominator),
          version: initial?.version ?? null,
        });
      if (
        await onCommand(
          freezeCommand({
            kind: 'mapping-save',
            id,
            resourceId,
            reference: 'نگاشت ' + resourceId,
            phase: 'pending',
            body,
          }),
        )
      )
        onCancel();
    } catch (failure) {
      setError(readableError(failure));
    }
  }
  const input = (
    key: Exclude<keyof typeof fields, 'isActive'>,
    label: string,
    max: number,
    identity = false,
  ) => (
    <Field label={label}>
      <input
        dir={key === 'nameFa' ? 'rtl' : 'ltr'}
        maxLength={max}
        readOnly={(!!initial && identity) || (key === 'originSystem' && !!defaults)}
        value={fields[key]}
        onChange={(event) => {
          setFields({ ...fields, [key]: event.target.value });
          setConfirm(false);
        }}
      />
    </Field>
  );
  return (
    <fieldset disabled={locked}>
      <legend>{initial ? 'ویرایش نگاشت موجود' : 'ثبت نگاشت واحد تازه'}</legend>
      <p>
        شناسهٔ ثابت نگاشت: <bdi>{resourceId}</bdi>
      </p>
      <p>
        کلیدها عیناً، با بزرگی حروف و صفر ابتدایی نگه داشته می‌شوند. واحد فروش = مقدار مبدأ × صورت ÷
        مخرج؛ نسبت۱:۱ هم باید صریح وارد شود.
      </p>
      <ErrorBox error={error} />
      <div className="form-grid">
        {input('originSystem', 'سامانهٔ مبدأ', 64, true)}
        {input('companyKey', 'کلید شرکت مبدأ', 64, true)}
        {input('warehouseKey', 'کلید انبار مبدأ', 64, true)}
        {input('sourceUnitKey', 'کلید واحد مبدأ', 120, true)}
        {input('variantId', 'شناسهٔ SKU انتخاب‌شده', 64, true)}
        {input('numerator', 'صورت نسبت', 7)}
        {input('denominator', 'مخرج نسبت', 7)}
        {input('nameFa', 'نام فارسی واحد مبدأ', 200)}
        {input('nameEn', 'English source unit name', 200)}
      </div>
      {defaults && (
        <div className="notice">
          <Field
            label="تعداد مبدأ برای آزمون نسبت"
            hint="صرفاً پیش‌نمایش است و همراه نگاشت ذخیره نمی‌شود."
            error={trialError}
          >
            <input
              dir="ltr"
              inputMode="decimal"
              maxLength={29}
              value={trial}
              onChange={(event) => setTrial(event.target.value)}
            />
          </Field>
          {trialResult !== undefined && (
            <p role="status">تعداد در واحد فروش سایمان: {trialResult}</p>
          )}
        </div>
      )}
      {!initial && (
        <MappingVariantPicker
          disabled={locked}
          onChoose={(row) => {
            setFields({ ...fields, variantId: row.variantId });
            setConfirm(false);
          }}
        />
      )}
      <Check
        label="نگاشت برای دریافت تازه فعال باشد"
        checked={fields.isActive}
        onChange={(event) => {
          setFields({ ...fields, isActive: event.target.checked });
          setConfirm(false);
        }}
      />
      <Check
        label="هویت دقیق منبع، SKU و نسبت تبدیل را بررسی کرده‌ام."
        checked={confirm}
        onChange={(event) => setConfirm(event.target.checked)}
      />
      <div className="row-buttons">
        <button className="primary" disabled={!confirm} onClick={() => void submit()}>
          ذخیرهٔ همین نگاشت واحد
        </button>
        <button onClick={onCancel}>بستن فرم نگاشت</button>
      </div>
    </fieldset>
  );
}
function MappingVariantPicker({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (row: InventoryRow) => void;
}) {
  const [input, setInput] = useState(''),
    [query, setQuery] = useState<string | null>(null);
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'receiving-variant-picker', 2, query],
    queryFn: async ({ pageParam }) => {
      const filters = { ...emptyInventoryFilters, query: query ?? '' };
      return readInventoryPage(await api<unknown>(inventoryPath(filters, pageParam)), filters);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: query !== null,
    refetchOnWindowFocus: false,
  });
  return (
    <details>
      <summary>انتخاب SKU واقعی از فهرست انبار</summary>
      <div className="form-grid">
        <Field label="جست‌وجوی نام یا کد SKU">
          <input maxLength={120} value={input} onChange={(event) => setInput(event.target.value)} />
        </Field>
        <button disabled={disabled || pages.isFetching} onClick={() => setQuery(input)}>
          جست‌وجوی SKU واقعی
        </button>
      </div>
      <ErrorBox error={pages.error} />
      <ul className="offer-sku-choices">
        {pages.data?.pages
          .flatMap((page) => page.items)
          .map((row) => (
            <li key={row.variantId}>
              <div>
                <strong>{row.nameFa}</strong>
                <small>
                  <bdi>{row.sku}</bdi> · {row.productStatus}
                </small>
                <small>
                  فیزیکی: {count(row.onHand)} · رزرو سفارش: {count(row.reserved)} · رزرو تأمین:{' '}
                  {count(row.sourcingReserved)} · آزاد: {count(row.available)}
                </small>
              </div>
              <button disabled={disabled} onClick={() => onChoose(row)}>
                انتخاب همین SKU برای نگاشت
              </button>
            </li>
          ))}
      </ul>
      {pages.hasNextPage && (
        <button
          disabled={disabled || pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          ۵۰ SKU بعدی
        </button>
      )}
    </details>
  );
}
type ReceiptLineDraft = {
  localId: string;
  offerLineId: string;
  sourceReceiptLineKey: string;
  sourceQuantity: string;
  mapping: ReceivingMapping | null;
  units: string;
};
function ReceivingForm({
  value,
  locked,
  onCommand,
}: {
  value: InventorySupplyDetail;
  locked: boolean;
  onCommand: Runner['send'];
}) {
  const [resourceId] = useState(uuid()),
    [fields, setFields] = useState({
      channel: '',
      originSystem: '',
      companyKey: '',
      warehouseKey: '',
      sourceReceiptKey: '',
      receivedAt: '',
      reason: '',
    }),
    [lines, setLines] = useState<ReceiptLineDraft[]>([]),
    [lineChoice, setLineChoice] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [historical, setHistorical] = useState(false),
    [error, setError] = useState<unknown>();
  const task = value.task,
    eligible = task.lines.filter((line) => line.remainingQuantity > 0);
  function change(key: keyof typeof fields, text: string) {
    setFields({ ...fields, [key]: text });
    setConfirmed(false);
    if (['originSystem', 'companyKey', 'warehouseKey'].includes(key))
      setLines((old) => old.map((line) => ({ ...line, mapping: null })));
  }
  function update(localId: string, changes: Partial<ReceiptLineDraft>) {
    setLines((old) =>
      old.map((line) => (line.localId === localId ? { ...line, ...changes } : line)),
    );
    setConfirmed(false);
  }
  async function submit() {
    setError(undefined);
    try {
      if (locked || !confirmed || (task.requiresHistoricalAcknowledgement && !historical)) return;
      const id = uuid(),
        body = receivingInputSchema.parse({
          ...fields,
          requestId: id,
          requestVersion: task.requestVersion,
          taskVersion: task.task.version,
          receivedAt: utcFromInput(fields.receivedAt),
          acknowledgeHistorical: historical,
          lines: lines.map((line) => {
            const target = task.lines.find((item) => item.offerLineId === line.offerLineId),
              mapping = line.mapping;
            if (
              !target ||
              !mapping ||
              !sameReceivingSku(mapping.variantId, target.variantId) ||
              !mapping.isActive ||
              mapping.originSystem !== fields.originSystem ||
              mapping.companyKey !== fields.companyKey ||
              mapping.warehouseKey !== fields.warehouseKey
            )
              throw new Error('برای هر ردیف، نگاشت فعال دقیق همان منبع و SKU را انتخاب کنید.');
            const sourceQuantity = latinDigits(line.sourceQuantity),
              quantity = receivingQuantity(sourceQuantity, mapping.numerator, mapping.denominator),
              stock = value.stock.find((item) =>
                sameReceivingSku(item.variantId, target.variantId),
              )!;
            if (quantity > target.remainingQuantity)
              throw new Error('تعداد دریافت از باقی‌ماندهٔ همین ردیف بیشتر است.');
            const units =
              stock.trackingMode === 'none' ? [] : parseReceipt(line.units, stock.trackingMode);
            if (stock.trackingMode !== 'none' && units.length !== quantity)
              throw new Error(
                'تعداد دستگاه‌های شناسه‌دار باید دقیقاً با تعداد واحد فروش برابر باشد.',
              );
            return {
              offerLineId: line.offerLineId,
              sourceReceiptLineKey: line.sourceReceiptLineKey,
              mappingId: mapping.id,
              mappingVersion: mapping.version,
              sourceQuantity,
              trackingMode: stock.trackingMode,
              stockVersion: stock.version,
              units,
            };
          }),
        });
      for (const target of task.lines) {
        const sum = body.lines
          .filter((line) => line.offerLineId === target.offerLineId)
          .reduce((sum, line) => {
            const mapping = lines.find(
              (row) => row.sourceReceiptLineKey === line.sourceReceiptLineKey,
            )!.mapping!;
            return (
              sum + receivingQuantity(line.sourceQuantity, mapping.numerator, mapping.denominator)
            );
          }, 0);
        if (sum > target.remainingQuantity)
          throw new Error('جمع دریافت چند خط از باقی‌ماندهٔ ردیف پیشنهاد بیشتر است.');
      }
      if (new TextEncoder().encode(JSON.stringify(body)).length > 65536)
        throw new Error('سند بیش از ۶۴ کیلوبایت است؛ هویت سند را برای تقسیم خودکار تغییر ندهید.');
      await onCommand(
        freezeCommand({
          kind: 'receive',
          id,
          reference: task.requestReference,
          requestId: task.requestId,
          taskId: task.task.id,
          resourceId,
          body,
          phase: 'pending',
        }),
      );
    } catch (failure) {
      setError(readableError(failure));
    }
  }
  return (
    <fieldset disabled={locked}>
      <legend>ثبت کالای واقعاً تحویل‌گرفته‌شده</legend>
      <p>
        شناسهٔ ثابت سند دریافت: <bdi>{resourceId}</bdi>
      </p>
      <p>
        مقدار دریافت، زمان، مرجع و نسبت از پذیرش یا قیمت بازار پر نمی‌شوند. هر خط سند مبدأ باید کلید
        واقعی و پایدار خودش را داشته باشد.
      </p>
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="روش ثبت سند">
          <select
            value={fields.channel}
            onChange={(event) => change('channel', event.target.value)}
          >
            <option value="">انتخاب روش</option>
            <option value="manual">ورود دستی</option>
            <option value="csv">رونویسی سند CSV</option>
          </select>
        </Field>
        {(['originSystem', 'companyKey', 'warehouseKey', 'sourceReceiptKey'] as const).map(
          (key) => (
            <Field
              key={key}
              label={
                {
                  originSystem: 'سامانهٔ مبدأ سند',
                  companyKey: 'کلید شرکت مبدأ',
                  warehouseKey: 'کلید انبار مبدأ',
                  sourceReceiptKey: 'کلید واقعی سند دریافت',
                }[key]
              }
            >
              <input
                dir="ltr"
                maxLength={key === 'sourceReceiptKey' ? 120 : 64}
                value={fields[key]}
                onChange={(event) => change(key, event.target.value)}
              />
            </Field>
          ),
        )}
        <div className="field">
          <PersianDateField
            label="زمان واقعی دریافت — UTC"
            encoding="utc"
            value={fields.receivedAt}
            onChange={(next) => change('receivedAt', next)}
          />
        </div>
        <Field label="دلیل ثبت دریافت">
          <textarea
            maxLength={500}
            value={fields.reason}
            onChange={(event) => change('reason', event.target.value)}
          />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="ردیف پذیرش برای دریافت واقعی">
          <select value={lineChoice} onChange={(event) => setLineChoice(event.target.value)}>
            <option value="">انتخاب SKU درخواست</option>
            {eligible.map((line) => (
              <option key={line.offerLineId} value={line.offerLineId}>
                {line.sku} · {line.nameFa} · باقی‌مانده {count(line.remainingQuantity)}
              </option>
            ))}
          </select>
        </Field>
        <button
          disabled={!lineChoice || lines.length >= 64}
          onClick={() => {
            setLines((old) => [
              ...old,
              {
                localId: uuid(),
                offerLineId: lineChoice,
                sourceReceiptLineKey: '',
                sourceQuantity: '',
                mapping: null,
                units: '',
              },
            ]);
            setConfirmed(false);
          }}
        >
          افزودن خط سند دریافت
        </button>
      </div>
      {lines.map((line) => (
        <ReceivingLine
          key={line.localId}
          line={line}
          value={value}
          header={fields}
          onChange={(changes) => update(line.localId, changes)}
          onRemove={() => {
            setLines((old) => old.filter((item) => item.localId !== line.localId));
            setConfirmed(false);
          }}
        />
      ))}
      {task.requiresHistoricalAcknowledgement && (
        <Check
          label="می‌دانم این دریافت برای پذیرش تاریخی/منقضی است؛ فقط واقعیت ورود ثبت می‌شود و خرید به رضایت تازه نیاز دارد."
          checked={historical}
          onChange={(event) => {
            setHistorical(event.target.checked);
            setConfirmed(false);
          }}
        />
      )}
      <Check
        label="کالاهای همین سند واقعاً تحویل شده‌اند؛ کلیدهای سند، تعداد، نگاشت و شناسهٔ دستگاه‌ها را بررسی کرده‌ام و افزایش موجودی را تأیید می‌کنم."
        checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)}
      />
      <button
        className="primary"
        disabled={
          !confirmed || !lines.length || (task.requiresHistoricalAcknowledgement && !historical)
        }
        onClick={() => void submit()}
      >
        ثبت دریافت واقعی و افزایش موجودی
      </button>
    </fieldset>
  );
}
function ReceivingLine({
  line,
  value,
  header,
  onChange,
  onRemove,
}: {
  line: ReceiptLineDraft;
  value: InventorySupplyDetail;
  header: Pick<typeof emptyFilters, 'originSystem' | 'companyKey' | 'warehouseKey'>;
  onChange: (value: Partial<ReceiptLineDraft>) => void;
  onRemove: () => void;
}) {
  const target = value.task.lines.find((item) => item.offerLineId === line.offerLineId)!,
    stock = value.stock.find((item) => sameReceivingSku(item.variantId, target.variantId))!,
    filters = {
      originSystem: header.originSystem,
      companyKey: header.companyKey,
      warehouseKey: header.warehouseKey,
      variantId: target.variantId,
    };
  const enabled = !!header.originSystem && !!header.companyKey && !!header.warehouseKey;
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'receiving-unit-mappings', filters],
    queryFn: async ({ pageParam }) =>
      mappingPageSchema.parse(await api<unknown>(mappingPath(filters, pageParam))),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    refetchOnWindowFocus: false,
  });
  const choices = Array.from(
    new Map(
      pages.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]) ?? [],
    ).values(),
  ).filter(
    (item) =>
      item.isActive &&
      sameReceivingSku(item.variantId, target.variantId) &&
      item.originSystem === header.originSystem &&
      item.companyKey === header.companyKey &&
      item.warehouseKey === header.warehouseKey,
  );
  let result = '';
  try {
    if (line.mapping && line.sourceQuantity)
      result =
        count(
          receivingQuantity(
            latinDigits(line.sourceQuantity),
            line.mapping.numerator,
            line.mapping.denominator,
          ),
        ) + ' واحد فروش';
  } catch {
    result = 'تبدیل دقیق به تعداد صحیح ممکن نیست؛ مقدار و نسبت را بررسی کنید.';
  }
  return (
    <article className="sourcing-request-line">
      <h4>
        <bdi>{target.sku}</bdi> · {target.nameFa}
      </h4>
      <p>
        باقی‌مانده {count(target.remainingQuantity)} · رهگیری <bdi>{stock.trackingMode}</bdi>
      </p>
      <div className="form-grid">
        <Field label="کلید واقعی خط سند مبدأ">
          <input
            dir="ltr"
            maxLength={120}
            value={line.sourceReceiptLineKey}
            onChange={(event) => onChange({ sourceReceiptLineKey: event.target.value })}
          />
        </Field>
        <Field label="نگاشت فعال واحد همین منبع و SKU">
          <select
            value={line.mapping?.id ?? ''}
            onChange={(event) =>
              onChange({ mapping: choices.find((item) => item.id === event.target.value) ?? null })
            }
          >
            <option value="">نگاشت را انتخاب کنید</option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nameFa} · {item.sourceUnitKey} · {item.numerator}/{item.denominator}
              </option>
            ))}
          </select>
        </Field>
        <Field label="مقدار واقعی در واحد مبدأ">
          <input
            dir="ltr"
            inputMode="decimal"
            maxLength={30}
            value={line.sourceQuantity}
            onChange={(event) => onChange({ sourceQuantity: event.target.value })}
          />
        </Field>
      </div>
      {!enabled && <p>ابتدا هویت سامانه، شرکت و انبار مبدأ سرصفحه را وارد کنید.</p>}
      <ErrorBox error={pages.error} />
      {pages.hasNextPage && (
        <button disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          ۵۰ نگاشت بعدی همین SKU
        </button>
      )}
      {enabled && !pages.isPending && !choices.length && (
        <p className="notice">
          نگاشت فعال پیدا نشد؛ آن را در بخش نگاشت واحد صریح ثبت کنید و سپس این فرم را باز کنید.
        </p>
      )}
      {result && <p>{result}</p>}
      {stock.trackingMode !== 'none' && (
        <Field
          label={
            stock.trackingMode === 'imei'
              ? 'هر خط یک دستگاه: IMEI اول، IMEI دوم اختیاری، سریال اختیاری'
              : 'هر خط یک سریال دستگاه واقعی'
          }
        >
          <textarea
            dir="ltr"
            rows={5}
            maxLength={50000}
            value={line.units}
            onChange={(event) => onChange({ units: event.target.value })}
          />
        </Field>
      )}
      <button onClick={onRemove}>حذف خط از فرم دریافت</button>
    </article>
  );
}
function ReceivingReceipt({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['admin', 'sourcing-receipt', id],
    queryFn: async () => {
      const value = receivingDataSchema.parse(
        await api<unknown>('/admin/inventory/sourcing-receipts/' + id),
      );
      if (value.id !== id) throw new Error('سند دریافتی با هدف یکسان نیست.');
      return value;
    },
    refetchOnWindowFocus: false,
  });
  return (
    <>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Busy />
      ) : (
        query.data && (
          <>
            <p>
              سند دریافت: <bdi>{query.data.id}</bdi>
            </p>
            <p>
              منشأ:{' '}
              <bdi>
                {query.data.originSystem} / {query.data.companyKey} / {query.data.warehouseKey}
              </bdi>
            </p>
            <p>
              کلید واقعی سند: <bdi>{query.data.sourceReceiptKey}</bdi>
            </p>
            <p>
              دریافت واقعی: {date(query.data.receivedAt)} · ثبت در سیستم:{' '}
              {date(query.data.recordedAt)}
            </p>
            <p>{query.data.reason}</p>
            {query.data.requiresNewOffer && (
              <p className="notice">برای ادامهٔ خرید، پیشنهاد و رضایت تازه لازم است.</p>
            )}
            {query.data.lines.map((line) => (
              <article key={line.id} className="sourcing-request-line">
                <p>
                  خط سند <bdi>{line.sourceReceiptLineKey}</bdi>
                </p>
                <p>
                  <bdi>{line.sourceQuantity}</bdi> {line.unitNameFa} ×{' '}
                  <bdi>
                    {line.numerator}/{line.denominator}
                  </bdi>{' '}
                  = {count(line.quantity)} واحد فروش
                </p>
                <p>
                  گردش انبار <bdi>{line.movementId}</bdi> · واحدهای رهگیری‌شده{' '}
                  {count(line.unitIds.length)}
                </p>
              </article>
            ))}
          </>
        )
      )}
    </>
  );
}

import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { Busy, Check, ErrorBox, Field } from '../../components/ui';
import { freezeCommand, utcFromInput, type AdminSourcingCommand } from './sourcing-admin-command';
import {
  allocationBody,
  allocationCandidateSchema,
  allocationCurrentMatches,
  allocationDataSchema,
  allocationEventsSchema,
  allocationReleaseSchema,
  type AllocationAdminCommand,
  type AllocationCandidate,
  type AllocationData,
  type AllocationPicks,
  type AllocationPickedUnit,
} from '../../api/contracts/market/allocation-contract';
import { readSerialPageV2, serialPathV2 } from '../../api/contracts/inventory/serial-contract-v2';
import {
  serialFiltersSchema,
  type SerialFilters,
} from '../../api/contracts/inventory/serial-contract';
import { supplyAllocationHeld } from '@sayman/web-shared/lib/market/supply-allocation.ts';

const uuid = () => crypto.randomUUID().replaceAll('-', '');
const count = (value: number) => value.toLocaleString('fa-IR');
const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();
const labels = {
  Active: 'فعال',
  Released: 'آزادشده',
  Expired: 'منقضی',
  Transferred: 'منتقل‌شده به سفارش واقعی',
};
const readable = (error: unknown) =>
  error instanceof Error && error.message.startsWith('[')
    ? new Error('نسخه‌ها، تعداد دستگاه‌های انتخابی، دلیل و زمان صریح UTC را بررسی کنید.')
    : error;
type Send = (command: AdminSourcingCommand) => Promise<boolean>;
export function SourcingAllocation({
  taskId,
  writable,
  locked,
  focusAllocationId,
  onCommand,
}: {
  taskId: string;
  writable: boolean;
  locked: boolean;
  focusAllocationId: string | null;
  onCommand: Send;
}) {
  const [selected, setSelected] = useState<string | null>(focusAllocationId),
    [lookup, setLookup] = useState(''),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    if (focusAllocationId) setSelected(focusAllocationId);
  }, [focusAllocationId]);
  const candidate = useQuery({
    queryKey: ['admin', 'sourcing-allocation-candidate', taskId],
    queryFn: async () => {
      const value = allocationCandidateSchema.parse(
        await api<unknown>('/admin/inventory/sourcing-tasks/' + taskId + '/allocation'),
      );
      if (value.taskId !== taskId) throw new Error('نامزد تخصیص به پیگیری دیگری تعلق دارد.');
      return value;
    },
    refetchOnWindowFocus: false,
  });
  const allocation = useQuery({
    queryKey: ['admin', 'sourcing-allocation', selected],
    queryFn: async () => {
      const value = allocationDataSchema.parse(
        await api<unknown>('/admin/inventory/sourcing-allocations/' + selected),
      );
      if (value.id !== selected || value.taskId !== taskId)
        throw new Error('تخصیص دریافتی به همین پیگیری تعلق ندارد.');
      return value;
    },
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const events = useInfiniteQuery({
    queryKey: ['admin', 'sourcing-allocation-events', selected],
    queryFn: async ({ pageParam }) =>
      allocationEventsSchema.parse(
        await api<unknown>(
          '/admin/inventory/sourcing-allocations/' +
            selected +
            '/events' +
            (pageParam ? '?cursor=' + pageParam : ''),
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const fresh = !!candidate.data && !candidate.isError && candidate.fetchStatus === 'idle',
    current = candidate.data;
  const detailMatches =
    !!allocation.data &&
    allocation.data.taskId === taskId &&
    (!current || allocationCurrentMatches(allocation.data, current));
  const detailFresh =
    fresh && detailMatches && !allocation.isError && allocation.fetchStatus === 'idle';
  const releaseAllowed =
    detailFresh &&
    allocation.data?.state === 'Active' &&
    current?.allocation?.id === allocation.data.id &&
    current.allocation.version === allocation.data.version;
  const refresh = () => {
    void candidate.refetch();
    if (selected) {
      void allocation.refetch();
      void events.refetch();
    }
  };
  return (
    <section className="sourcing-allocation">
      <div className="section-heading">
        <div>
          <h3>تخصیص سهم واقعی موجودی</h3>
          <p>
            تمام خطوط همین پذیرش از موجودی واقعی نگه‌داری می‌شوند. این اقدام ورود کالا، خرید یا
            پرداخت ایجاد نمی‌کند و قیمت پذیرفته‌شده را تغییر نمی‌دهد.
          </p>
        </div>
        <button disabled={candidate.isFetching || allocation.isFetching} onClick={refresh}>
          دریافت تازهٔ تخصیص و موجودی
        </button>
      </div>
      <ErrorBox error={error ?? candidate.error} />
      {candidate.isPending ? (
        <Busy />
      ) : (
        current && (
          <>
            <p>
              درخواست <bdi>{current.requestReference}</bdi> · مهلت اعتبار قیمت پذیرفته‌شده:{' '}
              <time dateTime={current.purchaseUntil}>{date(current.purchaseUntil)}</time> · وقت
              تهران
            </p>
            {current.isDemo && <p className="notice">دادهٔ نمونهٔ محیط توسعه</p>}
            {current.allocation ? (
              <CurrentAllocation
                value={current.allocation}
                locked={locked}
                onSelect={() => setSelected(current.allocation!.id)}
              />
            ) : (
              <p className="notice">اکنون تخصیص فعالی برای این پذیرش ثبت نشده است.</p>
            )}
            <div
              className="table-wrap"
              role="region"
              aria-label="موجودی واقعی برای تخصیص کامل"
              tabIndex={0}
            >
              <AdminTable>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>رهگیری</th>
                    <th>فیزیکی</th>
                    <th>رزرو سفارش</th>
                    <th>سهم تأمین</th>
                    <th>آزاد</th>
                  </tr>
                </thead>
                <tbody>
                  {current.stock.map((stock) => (
                    <tr key={stock.variantId}>
                      <td>
                        <bdi>
                          {current.lines.find((line) => same(line.variantId, stock.variantId))!.sku}
                        </bdi>
                      </td>
                      <td>
                        {
                          ({ none: 'بدون شناسه', serial: 'سریال', imei: 'IMEI' } as const)[
                            stock.trackingMode
                          ]
                        }
                      </td>
                      <td>{count(stock.onHand)}</td>
                      <td>{count(stock.reserved)}</td>
                      <td>{count(stock.sourcingReserved)}</td>
                      <td>{count(stock.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            {writable && current.canAttemptAllocation && (
              <AllocationForm
                key={taskId + ':' + candidate.dataUpdatedAt}
                value={current}
                locked={locked || !fresh}
                onCommand={onCommand}
              />
            )}{' '}
            {!current.canAttemptAllocation && !current.allocation && (
              <p className="notice">
                تخصیص تازه اکنون مجاز نیست؛ بازبودن پیگیری، اعتبار رضایت و مشخصات جاری کالا را بررسی
                کنید.
              </p>
            )}
          </>
        )
      )}
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          setError(undefined);
          try {
            const id = allocationDataSchema.shape.id.parse(lookup);
            setSelected(id);
          } catch (failure) {
            setError(readable(failure));
          }
        }}
      >
        <Field label="شناسهٔ تخصیص تاریخی همین پیگیری">
          <input
            dir="ltr"
            maxLength={32}
            value={lookup}
            onChange={(event) => setLookup(event.target.value)}
          />
        </Field>
        <button disabled={locked || !lookup}>نمایش تخصیص با شناسه</button>
      </form>
      {selected && (
        <article className="allocation-detail">
          <h4>جزئیات تخصیص انتخاب‌شده</h4>
          <p>
            <bdi>{selected}</bdi>
          </p>
          <ErrorBox error={allocation.error} />
          {allocation.isPending ? (
            <Busy />
          ) : (
            detailMatches &&
            allocation.data && (
              <>
                <AllocationSnapshot value={allocation.data} />
                {writable && allocation.data.state === 'Active' && (
                  <AllocationRelease
                    key={
                      allocation.data.id +
                      ':' +
                      allocation.data.version +
                      ':' +
                      allocation.dataUpdatedAt +
                      ':' +
                      candidate.dataUpdatedAt
                    }
                    value={allocation.data}
                    reference={current?.requestReference ?? allocation.data.requestId}
                    locked={locked || !releaseAllowed}
                    onCommand={onCommand}
                  />
                )}
                <h4>تاریخچهٔ همین تخصیص</h4>
                <ErrorBox error={events.error} />
                {events.isPending ? (
                  <Busy />
                ) : (
                  <ol className="sourcing-events">
                    {events.data?.pages
                      .flatMap((page) => page.items)
                      .map((event) => (
                        <li key={event.id}>
                          <strong>{labels[event.state]}</strong> ·{' '}
                          <time dateTime={event.at}>{date(event.at)}</time>
                          <p>{event.reason}</p>
                        </li>
                      ))}
                  </ol>
                )}
                {events.hasNextPage && (
                  <button
                    disabled={events.isFetchingNextPage}
                    onClick={() => void events.fetchNextPage()}
                  >
                    ۵۰ رویداد بعدی تخصیص
                  </button>
                )}
              </>
            )
          )}
        </article>
      )}
    </section>
  );
}
function CurrentAllocation({
  value,
  locked,
  onSelect,
}: {
  value: NonNullable<AllocationCandidate['allocation']>;
  locked: boolean;
  onSelect: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [value.id, value.version]);
  const held = supplyAllocationHeld(true, value, now);
  return (
    <div className="notice">
      <strong>
        {held ? 'سهم موجودی این پذیرش نگه‌داری شده است' : 'مهلت نگه‌داری تخصیص ثبت‌شده گذشته است'}
      </strong>
      <p>
        شناسه <bdi>{value.id}</bdi> · نگه‌داری تا {date(value.expiresAt)}
      </p>
      <button disabled={locked} onClick={onSelect}>
        نمایش تخصیص جاری و تاریخچه
      </button>
    </div>
  );
}
function AllocationForm({
  value,
  locked,
  onCommand,
}: {
  value: AllocationCandidate;
  locked: boolean;
  onCommand: Send;
}) {
  const [resourceId] = useState(uuid()),
    [expires, setExpires] = useState(''),
    [reason, setReason] = useState(''),
    [picks, setPicks] = useState<AllocationPicks>({}),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<unknown>();
  const totalTracked = value.lines.reduce(
    (sum, line) =>
      sum +
      (value.stock.find((stock) => same(stock.variantId, line.variantId))!.trackingMode === 'none'
        ? 0
        : line.quantity),
    0,
  );
  function choose(lineId: string, selected: AllocationPickedUnit[]) {
    setPicks((old) => ({ ...old, [lineId]: selected }));
    setConfirm(false);
  }
  async function submit() {
    setError(undefined);
    try {
      if (locked || !confirm) return;
      const id = uuid(),
        body = allocationBody(value, id, utcFromInput(expires), reason, picks, Date.now());
      const command: AllocationAdminCommand = {
        kind: 'allocation-allocate',
        id,
        resourceId,
        requestId: value.requestId,
        taskId: value.taskId,
        offerId: value.offerId,
        reference: value.requestReference,
        phase: 'pending',
        body,
      };
      await onCommand(freezeCommand(command));
    } catch (failure) {
      setError(readable(failure));
    }
  }
  return (
    <fieldset disabled={locked}>
      <legend>نگه‌داری کامل همین اقلام برای این درخواست</legend>
      <p>
        شناسهٔ تخصیص تازه: <bdi>{resourceId}</bdi>
      </p>
      <p>
        تعدادها از پذیرش قطعی می‌آیند و قابل تغییر نیستند. برای SKU تکراری، ظرفیت آزاد مشترک است؛
        قیمت یا مالک از این فرم ارسال نمی‌شود.
      </p>
      <ErrorBox error={error} />
      <div className="form-grid">
        <div className="field">
          <PersianDateField
            label="پایان صریح نگه‌داری — UTC"
            encoding="utc"
            value={expires}
            onChange={(next) => {
              setExpires(next);
              setConfirm(false);
            }}
          />
        </div>
        <Field label="دلیل تخصیص موجودی">
          <textarea
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setConfirm(false);
            }}
          />
        </Field>
      </div>
      {value.lines.map((line) => {
        const stock = value.stock.find((stock) => same(stock.variantId, line.variantId))!;
        return (
          <article className="sourcing-request-line" key={line.offerLineId}>
            <h4>
              {line.nameFa} · {line.labelFa}
            </h4>
            <p>
              <bdi>{line.sku}</bdi> · تعداد دقیق: {count(line.quantity)}
            </p>
            {stock.trackingMode === 'none' ? (
              <p>تخصیص شمارشیِ کامل از موجودی آزاد واقعی؛ دستگاه مشخصی انتخاب نمی‌شود.</p>
            ) : (
              <AllocationUnits
                key={line.offerLineId + ':' + stock.version}
                taskId={value.taskId}
                line={line}
                stock={stock}
                selected={picks[line.offerLineId] ?? []}
                otherIds={Object.entries(picks)
                  .filter(([id]) => id !== line.offerLineId)
                  .flatMap(([, items]) => items.map((item) => item.unit.id))}
                locked={locked || totalTracked > 100}
                onChange={(units) => choose(line.offerLineId, units)}
              />
            )}
          </article>
        );
      })}
      {totalTracked > 100 && (
        <p className="notice" role="alert">
          تعداد کل دستگاه‌های رهگیری‌شده از سقف ۱۰۰ این فرمان بیشتر است. تخصیص کامل را با تقسیم
          خودکار یا تغییر مقدار پذیرش انجام ندهید.
        </p>
      )}
      <Check
        label="همهٔ خطوط، دستگاه‌های مشخص و مهلت UTC را بررسی کرده‌ام؛ سهم واقعی انبار برای همین درخواست نگه‌داری شود."
        checked={confirm}
        onChange={(event) => setConfirm(event.target.checked)}
      />
      <button
        className="primary"
        disabled={!confirm || !expires || !reason.trim() || totalTracked > 100}
        onClick={() => void submit()}
      >
        تخصیص کامل موجودی واقعی
      </button>
    </fieldset>
  );
}
function AllocationUnits({
  taskId,
  line,
  stock,
  selected,
  otherIds,
  locked,
  onChange,
}: {
  taskId: string;
  line: AllocationCandidate['lines'][number];
  stock: AllocationCandidate['stock'][number];
  selected: AllocationPickedUnit[];
  otherIds: string[];
  locked: boolean;
  onChange: (units: AllocationPickedUnit[]) => void;
}) {
  const [input, setInput] = useState(''),
    [filters, setFilters] = useState<SerialFilters>({ state: 'available', query: '' }),
    [error, setError] = useState<unknown>();
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'allocation-unit-picker', taskId, line.offerLineId, stock.version, filters],
    queryFn: async ({ pageParam }) => {
      const value = readSerialPageV2(
        await api<unknown>(serialPathV2(line.variantId, filters, pageParam)),
        line.variantId,
        filters,
        pageParam,
      );
      if (value.stock.version !== stock.version || value.stock.mode !== stock.trackingMode)
        throw new Error(
          'موجودی یا روش رهگیری عوض شده است؛ ابتدا تخصیص و موجودی را از بالای این بخش بازخوانی کنید.',
        );
      return value;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  });
  const items = Array.from(
      new Map(
        pages.data?.pages.flatMap((page) => page.items).map((item) => [item.unit.id, item]) ?? [],
      ).values(),
    ),
    fresh = !pages.isError && pages.fetchStatus === 'idle';
  return (
    <div>
      <p>
        انتخاب دستی دستگاه‌ها: {count(selected.length)} از {count(line.quantity)}؛ فقط دستگاه‌های
        آزادِ بدون سهم محفوظ نمایش داده می‌شوند.
      </p>
      <div className="form-grid">
        <Field label="جست‌وجوی سریال یا IMEI آزاد">
          <input
            dir="ltr"
            maxLength={100}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </Field>
        <button
          disabled={locked || pages.isFetching}
          onClick={() => {
            setError(undefined);
            try {
              setFilters(serialFiltersSchema.parse({ state: 'available', query: input }));
            } catch (failure) {
              setError(readable(failure));
            }
          }}
        >
          جست‌وجوی دستگاه‌های آزاد
        </button>
      </div>
      <ErrorBox error={error ?? pages.error} />
      {pages.isPending ? (
        <Busy />
      ) : (
        <ul className="offer-sku-choices">
          {items.map((item) => {
            const unit = item.unit,
              checked = selected.some((row) => row.unit.id === unit.id),
              used = otherIds.includes(unit.id);
            return (
              <li key={unit.id}>
                <div>
                  <strong>
                    <bdi>{unit.serial ?? unit.imei1}</bdi>
                  </strong>
                  {unit.imei2 && (
                    <small>
                      IMEI دوم: <bdi>{unit.imei2}</bdi>
                    </small>
                  )}
                  <small>
                    شناسهٔ واحد: <bdi>{unit.id}</bdi>
                  </small>
                </div>
                <button
                  disabled={
                    locked ||
                    !fresh ||
                    item.hasActiveClaim ||
                    used ||
                    (!checked && selected.length >= line.quantity)
                  }
                  aria-pressed={checked}
                  onClick={() =>
                    onChange(
                      checked
                        ? selected.filter((row) => row.unit.id !== unit.id)
                        : [
                            ...selected,
                            {
                              unit,
                              stockVersion: stock.version!,
                              hasActiveClaim: item.hasActiveClaim,
                            },
                          ],
                    )
                  }
                >
                  {checked
                    ? 'برداشتن انتخاب'
                    : used
                      ? 'در خط دیگر انتخاب شده'
                      : 'انتخاب همین دستگاه'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pages.hasNextPage && (
        <button
          disabled={locked || pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          ۵۰ دستگاه آزاد بعدی
        </button>
      )}
      {selected.length > 0 && (
        <details>
          <summary>همهٔ دستگاه‌های انتخاب‌شدهٔ این خط</summary>
          <ul>
            {selected.map((row) => (
              <li key={row.unit.id}>
                <bdi>{row.unit.serial ?? row.unit.imei1}</bdi> ·{' '}
                <button
                  disabled={locked}
                  onClick={() => onChange(selected.filter((item) => item.unit.id !== row.unit.id))}
                >
                  حذف این انتخاب
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
function AllocationSnapshot({ value }: { value: AllocationData }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [value.id, value.version]);
  const held = supplyAllocationHeld(value.state === 'Active', value, now),
    state = value.state === 'Active' && !held ? 'Expired' : value.effectiveState;
  return (
    <>
      <p className="notice">
        <strong>{labels[state as keyof typeof labels]}</strong> · پایان نگه‌داری:{' '}
        <time dateTime={value.expiresAt}>{date(value.expiresAt)}</time> · وقت تهران
      </p>
      <p>
        این جزئیات وضعیت جاری همین شناسه است؛ رسید موفق قبلی، فعال‌بودن کنونی سهم را ثابت نمی‌کند.
        خرید و پرداخت از تخصیص فعال نمی‌شوند.
      </p>
      {value.lines.map((line) => (
        <article className="sourcing-request-line" key={line.offerLineId}>
          <p>
            خط پذیرش <bdi>{line.offerLineId}</bdi> · شناسهٔ تنوع <bdi>{line.variantId}</bdi> ·{' '}
            {count(line.quantity)} واحد
          </p>
          {line.unitIds.length > 0 && (
            <details>
              <summary>شناسهٔ واحدهای فیزیکی این تخصیص</summary>
              <ul>
                {line.unitIds.map((id) => (
                  <li key={id}>
                    <bdi>{id}</bdi>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      ))}
    </>
  );
}
function AllocationRelease({
  value,
  reference,
  locked,
  onCommand,
}: {
  value: AllocationData;
  reference: string;
  locked: boolean;
  onCommand: Send;
}) {
  const [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit() {
    setError(undefined);
    try {
      if (locked || !confirm) return;
      const id = uuid(),
        body = allocationReleaseSchema.parse({
          requestId: id,
          acceptanceId: value.acceptanceId,
          version: value.version,
          reason,
        });
      await onCommand(
        freezeCommand({
          kind: 'allocation-release',
          id,
          reference,
          resourceId: value.id,
          requestId: value.requestId,
          taskId: value.taskId,
          offerId: value.offerId,
          body,
          phase: 'pending',
        }),
      );
    } catch (failure) {
      setError(readable(failure));
    }
  }
  return (
    <fieldset disabled={locked}>
      <legend>آزادسازی صریح سهم همین تخصیص</legend>
      <p>
        مهلت گذشته هم تا آزادسازی فیزیکی می‌تواند سهم را نگه دارد. این فرمان با نسخهٔ تازه اجرا
        می‌شود، موجودی فیزیکی را تغییر نمی‌دهد و سفارش واقعی را لغو نمی‌کند؛ سهم منتقل‌شده به سفارش
        از این مسیر آزاد نمی‌شود.
      </p>
      <ErrorBox error={error} />
      <Field label="دلیل آزادسازی سهم">
        <textarea
          maxLength={500}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setConfirm(false);
          }}
        />
      </Field>
      <Check
        label="سهم موجودی همین تخصیص آزاد شود؛ این اقدام لغو سفارش یا تغییر قیمت پذیرفته‌شده نیست."
        checked={confirm}
        onChange={(event) => setConfirm(event.target.checked)}
      />
      <button disabled={!confirm || !reason.trim()} onClick={() => void submit()}>
        آزادسازی همین سهم موجودی
      </button>
    </fieldset>
  );
}

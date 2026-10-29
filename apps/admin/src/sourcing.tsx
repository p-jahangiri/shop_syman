import { AdminTable } from './admin-table';
import { AdminFilterForm } from './admin-filters';
import { useCallback, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Busy, ErrorBox, Field, Modal } from './ui';
import { sourcingCommandKey as key, useSourcingCommand as useCommand } from './sourcing-pending';
import {
  sourcingAdminDetailSchema,
  sourcingAdminEventsSchema,
  sourcingAdminPageSchema,
  sourcingAttributeText,
  sourcingListPath,
  sourcingStateNames,
  type SourcingAdminDetail,
  type SourcingCommand,
} from './sourcing-contract';

import {
  canMarkUnavailable,
  commandRequest,
  commandTarget,
  freezeCommand,
  isOfferCommand,
  type RecoveredAdminCommand,
} from './sourcing-admin-command';
import { commandPermitted } from './sourcing-command-protocol';
import { useSourcingRunner } from './use-sourcing-runner';
import {
  manualSourcingReceiptRecovery,
  manualSourcingReceiptScope,
  type ManualSourcingOperation,
} from './sourcing-receipt-recovery';
import { SourcingOffers } from './sourcing-offers';
import { SourcingSupply } from './sourcing-supply';
import { OpaqueSourcingCommand } from './opaque-sourcing-command';

const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
export function SourcingPage({
  viewerId,
  writable,
  financialWritable,
  inventoryWritable = false,
}: {
  viewerId: string;
  writable: boolean;
  financialWritable: boolean;
  inventoryWritable?: boolean;
}) {
  const client = useQueryClient();
  const stored = useCommand(viewerId).data;
  const permissions = {
    sales: writable,
    financial: financialWritable,
    inventory: inventoryWritable,
  };
  const [draft, setDraft] = useState({ state: 'all', query: '' }),
    [filter, setFilter] = useState(draft),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState<unknown>();
  const [offerGuard, setOfferGuard] = useState<{ requestVersion: string; canMark: boolean } | null>(
      null,
    ),
    [offerFocus, setOfferFocus] = useState<{
      requestId: string;
      offerId: string;
      token: number;
    } | null>(null),
    [supplyFocus, setSupplyFocus] = useState<{
      requestId: string;
      taskId: string;
      token: number;
    } | null>(null);
  const onOfferGuard = useCallback(
    (guard: { requestVersion: string; canMark: boolean } | null) => setOfferGuard(guard),
    [],
  );
  const runner = useSourcingRunner(
    viewerId,
    permissions,
    (focus) => {
      if (focus.requestId) setSelected(focus.requestId);
      if (focus.offerId && focus.requestId)
        setOfferFocus((old) => ({
          requestId: focus.requestId!,
          offerId: focus.offerId!,
          token: (old?.token ?? 0) + 1,
        }));
      if (focus.taskId && focus.requestId)
        setSupplyFocus((old) => ({
          requestId: focus.requestId!,
          taskId: focus.taskId!,
          token: (old?.token ?? 0) + 1,
        }));
    },
    setError,
  );
  const busy = runner.busy;
  const send = runner.send;
  const retryKnown = runner.refresh;
  const rows = useInfiniteQuery({
    queryKey: ['admin', 'sourcing', filter],
    queryFn: async ({ pageParam }) =>
      sourcingAdminPageSchema.parse(
        await api<unknown>(sourcingListPath(filter.state, filter.query, pageParam)),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: ['admin', 'sourcing-detail', selected],
    queryFn: async () => {
      const parsed = sourcingAdminDetailSchema.parse(
        await api<unknown>('/admin/sourcing/requests/' + selected),
      );
      if (parsed.summary.id !== selected) throw new Error('شناسهٔ پاسخ درخواست معتبر نیست.');
      return parsed;
    },
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const events = useInfiniteQuery({
    queryKey: ['admin', 'sourcing-events', selected],
    queryFn: async ({ pageParam }) =>
      sourcingAdminEventsSchema.parse(
        await api<unknown>(
          '/admin/sourcing/requests/' +
            selected +
            '/events' +
            (pageParam ? '?cursor=' + encodeURIComponent(pageParam) : ''),
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const items = Array.from(
    new Map(
      (rows.data?.pages.flatMap((page) => page.items) ?? []).map((row) => [row.id, row]),
    ).values(),
  );
  const refresh = async () => {
    await Promise.all(
      [
        'sourcing',
        'sourcing-detail',
        'sourcing-events',
        'sourcing-offers',
        'sourcing-offer',
        'sourcing-offer-events',
        'sourcing-supply',
        'sourcing-supply-detail',
        'sourcing-supply-events',
      ].map((name) => client.invalidateQueries({ queryKey: ['admin', name] })),
    );
  };
  function start(
    kind: 'review' | 'unavailable',
    item: SourcingAdminDetail,
    reasonCode?: string,
    publicMessage?: string,
  ) {
    if (
      busy ||
      detail.isError ||
      detail.fetchStatus !== 'idle' ||
      client.getQueryData(key(viewerId)) ||
      !writable ||
      (kind === 'unavailable' &&
        !canMarkUnavailable(item.canMarkUnavailable, offerGuard, item.summary.version))
    )
      return;
    const id = crypto.randomUUID();
    const command: SourcingCommand = {
      id,
      kind,
      targetId: item.summary.id,
      reference: item.summary.reference,
      body: {
        requestId: id,
        version: item.summary.version,
        ...(kind === 'unavailable' ? { reasonCode, publicMessage } : {}),
      },
      phase: 'pending',
    };
    void send(freezeCommand(command));
  }
  const blocked = !!stored || busy || detail.isError || detail.fetchStatus !== 'idle';
  return (
    <section className="panel sourcing-admin">
      <div className="section-heading">
        <div>
          <h2>درخواست‌های تأمین بازار</h2>
          <p>
            این درخواست‌ها برای بررسی امکان تأمین‌اند و تعهد خرید، پرداخت یا رزرو ایجاد نمی‌کنند.
          </p>
        </div>
        <button
          disabled={rows.isFetching || busy}
          onClick={() =>
            stored?.phase === 'refresh' && commandPermitted(stored, permissions)
              ? void retryKnown(stored)
              : void refresh()
          }
        >
          دریافت وضعیت تازه
        </button>
      </div>
      {stored &&
        (commandPermitted(stored, permissions) ? (
          <div className="notice" role="status">
            <strong>
              {stored.phase === 'failed'
                ? 'فرمان پذیرفته نشد'
                : stored.phase === 'refresh'
                  ? 'ثبت فرمان تأیید شد؛ وضعیت جاری لازم است'
                  : 'فرمان در انتظار نتیجهٔ قطعی است'}
            </strong>
            <p>
              {stored.message ?? 'در حال ثبت یا پیگیری فرمان؛ از ایجاد فرمان تازه خودداری کنید.'}
            </p>
            <p>
              درخواست <bdi>{stored.reference}</bdi> · شناسهٔ درخواست{' '}
              <bdi>{commandRequest(stored)}</bdi>
              {isOfferCommand(stored) && (
                <>
                  {' '}
                  · پیشنهاد <bdi>{stored.offerId}</bdi>
                </>
              )}{' '}
              · شناسهٔ فرمان <bdi>{stored.id}</bdi>
            </p>
            <div className="row-buttons">
              <button
                disabled={busy || !commandTarget(stored).requestId}
                onClick={() => {
                  setSelected(commandRequest(stored));
                  if (isOfferCommand(stored))
                    setOfferFocus((old) => ({
                      requestId: stored.requestId,
                      offerId: stored.offerId,
                      token: (old?.token ?? 0) + 1,
                    }));
                }}
              >
                نمایش همان درخواست
              </button>
              <button
                disabled={
                  busy || stored.phase === 'refresh' || !commandPermitted(stored, permissions)
                }
                onClick={() => void runner.recover(stored)}
              >
                پیگیری رسید همین فرمان
              </button>
              <button
                disabled={
                  busy || stored.phase === 'refresh' || !commandPermitted(stored, permissions)
                }
                onClick={() => void send(stored)}
              >
                تلاش دوباره با همان شناسه
              </button>
              {stored.phase === 'refresh' && (
                <button disabled={busy} onClick={() => void retryKnown(stored)}>
                  دریافت وضعیت پس از ثبت — بدون ارسال دوبارهٔ فرمان
                </button>
              )}
              {stored.phase === 'failed' && (
                <button
                  disabled={busy}
                  onClick={() => {
                    client.setQueryData(key(viewerId), null);
                    void refresh();
                  }}
                >
                  بازبینی و شروع اصلاح تازه
                </button>
              )}
            </div>
            <small>
              {stored.phase === 'refresh'
                ? 'ثبت این فرمان تأیید شده است؛ این مرحله فقط وضعیت جاری را با GET دریافت می‌کند و فرمان مالی دوباره ارسال نمی‌شود.'
                : 'ناوبری پنل فرمان را حفظ می‌کند؛ خروج از حساب یا بستن تب، نسخهٔ حافظه را پاک می‌کند. دریافت وضعیت تازه به‌تنهایی اجرای همین فرمان را ثابت نمی‌کند.'}
            </small>
          </div>
        ) : (
          <OpaqueSourcingCommand />
        ))}
      {(writable || financialWritable) && !stored && (
        <ReceiptLookup
          busy={busy}
          writable={writable}
          financialWritable={financialWritable}
          onLookup={(command) => void runner.recover(command)}
        />
      )}
      <AdminFilterForm
        onSubmit={(event) => {
          event.preventDefault();
          setFilter({ ...draft, query: draft.query.trim() });
        }}

        label="فیلتر درخواست‌های تأمین"
        search={
          <Field label="جست‌وجوی شمارهٔ درخواست">
            <input
              maxLength={120}
              value={draft.query}
              onChange={(event) => setDraft({ ...draft, query: event.target.value })}
            />
          </Field>
        }
        actions={
          <div>
            <button className="primary" disabled={rows.isFetching}>
              جست‌وجو
            </button>
            <button
              type="button"
              onClick={() => {
                const empty = { state: 'all', query: '' };
                setDraft(empty);
                setFilter(empty);
              }}
            >
              پاک‌کردن فیلترها
            </button>
          </div>
        }
        applied={[
          filter.query ? 'شماره: ' + filter.query : '',
          filter.state === 'all'
            ? ''
            : (Object.entries(sourcingStateNames).find(([key]) => key === filter.state)?.[1] ??
              filter.state),
        ].filter(Boolean)}
      >
        <Field label="وضعیت درخواست">
          <select
            value={draft.state}
            onChange={(event) => setDraft({ ...draft, state: event.target.value })}
          >
            <option value="all">همه</option>
            {Object.entries(sourcingStateNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </AdminFilterForm>
      <ErrorBox error={rows.error ?? error} />
      {rows.isPending ? (
        <Busy />
      ) : (
        <>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="فهرست درخواست‌های تأمین"
          >
            <AdminTable>
              <thead>
                <tr>
                  <th>شماره</th>
                  <th>وضعیت</th>
                  <th>زمان ثبت</th>
                  <th>تعداد / مدل</th>
                  <th>نوع داده</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <bdi>{item.reference}</bdi>
                    </td>
                    <td>{sourcingStateNames[item.state]}</td>
                    <td data-sort-value={item.createdAt}>{date(item.createdAt)}</td>
                    <td>
                      {item.itemCount.toLocaleString('fa-IR')} /{' '}
                      {item.lineCount.toLocaleString('fa-IR')}
                    </td>
                    <td>{item.isDemo ? 'نمونهٔ توسعه' : 'درخواست مشتری'}</td>
                    <td>
                      <button disabled={busy} onClick={() => setSelected(item.id)}>
                        نمایش درخواست
                      </button>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td className="empty" colSpan={6}>
                      درخواستی با این فیلتر وجود ندارد.
                    </td>
                  </tr>
                )}
              </tbody>
            </AdminTable>
          </div>
          {rows.hasNextPage && (
            <button disabled={rows.isFetchingNextPage} onClick={() => void rows.fetchNextPage()}>
              ۵۰ درخواست بعدی
            </button>
          )}
        </>
      )}
      {selected && (
        <Modal
          key={selected}
          title={detail.data ? 'درخواست ' + detail.data.summary.reference : 'جزئیات درخواست تأمین'}
          onClose={() => setSelected(null)}
          preventClose={busy}
        >
          <ErrorBox error={detail.error} />
          {detail.isPending ? (
            <Busy />
          ) : (
            detail.data && (
              <>
                {stored && commandPermitted(stored, permissions) && (
                  <div className="notice" role="status">
                    <strong>
                      {stored.phase === 'failed'
                        ? 'فرمان پذیرفته نشد'
                        : stored.phase === 'refresh'
                          ? 'ثبت فرمان تأیید شد؛ وضعیت جاری لازم است'
                          : 'فرمان در انتظار نتیجهٔ قطعی است'}
                    </strong>
                    <p>{stored.message ?? 'ثبت یا پیگیری فرمان در حال انجام است.'}</p>
                    <p>
                      شناسهٔ فرمان: <bdi>{stored.id}</bdi>
                    </p>
                    <button disabled={busy} onClick={() => setSelected(null)}>
                      بستن جزئیات و پیگیری همین فرمان
                    </button>
                  </div>
                )}
                <RequestContent detail={detail.data} />
                <button
                  disabled={detail.isFetching || busy}
                  onClick={() =>
                    stored?.phase === 'refresh' && commandPermitted(stored, permissions)
                      ? void retryKnown(stored)
                      : void refresh()
                  }
                >
                  دریافت وضعیت تازه
                </button>
                <SourcingOffers
                  request={detail.data}
                  financialWritable={financialWritable}
                  locked={blocked}
                  focus={offerFocus?.requestId === selected ? offerFocus : null}
                  onGuard={onOfferGuard}
                  onCommand={send}
                />
                <SourcingSupply
                  request={detail.data}
                  writable={writable}
                  locked={blocked}
                  focus={supplyFocus?.requestId === selected ? supplyFocus : null}
                  onCommand={send}
                />
                {writable && (
                  <Actions
                    key={detail.data.summary.version}
                    item={detail.data}
                    locked={blocked}
                    canUnavailable={canMarkUnavailable(
                      detail.data.canMarkUnavailable,
                      offerGuard,
                      detail.data.summary.version,
                    )}
                    onReview={() => start('review', detail.data!)}
                    onUnavailable={(reason, message) =>
                      start('unavailable', detail.data!, reason, message)
                    }
                  />
                )}
                <h3>تاریخچهٔ درخواست</h3>
                <ErrorBox error={events.error} />
                {events.isPending ? (
                  <Busy />
                ) : (
                  <ol className="sourcing-events">
                    {events.data?.pages
                      .flatMap((page) => page.items)
                      .map((event) => (
                        <li key={event.id}>
                          <strong>{sourcingStateNames[event.stateAfter]}</strong> · {date(event.at)}
                          {event.publicMessage && <p>{event.publicMessage}</p>}
                        </li>
                      ))}
                  </ol>
                )}
                {events.hasNextPage && (
                  <button
                    disabled={events.isFetchingNextPage}
                    onClick={() => void events.fetchNextPage()}
                  >
                    ۵۰ رویداد بعدی
                  </button>
                )}
              </>
            )
          )}
        </Modal>
      )}
    </section>
  );
}
function Actions({
  item,
  locked,
  canUnavailable,
  onReview,
  onUnavailable,
}: {
  item: SourcingAdminDetail;
  locked: boolean;
  canUnavailable: boolean;
  onReview: () => void;
  onUnavailable: (reason: string, message: string) => void;
}) {
  const [reason, setReason] = useState(''),
    [message, setMessage] = useState('');
  if (!item.canReview && !canUnavailable) return null;
  return (
    <fieldset disabled={locked}>
      <legend>بررسی درخواست</legend>
      {item.canReview && (
        <button type="button" className="primary" onClick={onReview}>
          شروع بررسی
        </button>
      )}
      {canUnavailable && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason && message.trim()) onUnavailable(reason, message.trim());
          }}
        >
          <h3>ثبت عدم امکان تأمین</h3>
          <Field label="دلیل">
            <select value={reason} onChange={(event) => setReason(event.target.value)} required>
              <option value="">انتخاب کنید</option>
              <option value="no_supplier">تأمین‌کننده پیدا نشد</option>
              <option value="discontinued">تولید متوقف شده است</option>
              <option value="other">دلیل دیگر</option>
            </select>
          </Field>
          <Field label="توضیح قابل مشاهده برای مشتری">
            <textarea
              maxLength={500}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              required
            />
          </Field>
          <button type="submit" disabled={!reason || !message.trim()}>
            ثبت عدم امکان تأمین
          </button>
        </form>
      )}
    </fieldset>
  );
}
function RequestContent({ detail }: { detail: SourcingAdminDetail }) {
  return (
    <>
      <dl className="charge-details">
        <dt>وضعیت</dt>
        <dd>{sourcingStateNames[detail.summary.state]}</dd>
        <dt>تعداد کالا</dt>
        <dd>{detail.summary.itemCount.toLocaleString('fa-IR')}</dd>
        <dt>آخرین تغییر</dt>
        <dd>{date(detail.summary.changedAt)}</dd>
        <dt>حساب مشتری</dt>
        <dd>
          <bdi>{detail.summary.ownerId}</bdi>
        </dd>
      </dl>
      {detail.note && (
        <div className="notice">
          <strong>یادداشت مشتری</strong>
          <p>{detail.note}</p>
        </div>
      )}
      {detail.lines.map((line) => (
        <article className="sourcing-request-line" key={line.listingId}>
          <h3>{line.model.nameFa}</h3>
          <small>
            <bdi>{line.model.nameEn}</bdi>
          </small>
          <p>
            تعداد {line.quantity.toLocaleString('fa-IR')} · {line.model.brand} ·{' '}
            {line.model.categoryNameFa}
          </p>
          {line.configuration && (
            <div className="sourcing-request-configuration">
              <strong>انتخاب دقیق مشتری در زمان ثبت درخواست</strong>
              <dl>
                <div>
                  <dt>حافظهٔ رم</dt>
                  <dd>{line.configuration.ramGb.toLocaleString('fa-IR')} گیگابایت</dd>
                </div>
                <div>
                  <dt>حافظهٔ داخلی</dt>
                  <dd>{line.configuration.storageGb.toLocaleString('fa-IR')} گیگابایت</dd>
                </div>
                <div>
                  <dt>رنگ</dt>
                  <dd>
                    {line.configuration.colorNameFa} · <bdi>{line.configuration.colorNameEn}</bdi>
                  </dd>
                </div>
              </dl>
              <small>
                این انتخاب ثابتِ درخواست است؛ SKU پیشنهادی باید با همین رنگ، رم و حافظه مطابقت داشته
                باشد.
              </small>
              <details>
                <summary>شناسهٔ ترکیب در درخواست</summary>
                <bdi>{line.configuration.id}</bdi>
              </details>
            </div>
          )}
          <p>
            منبع ثبت‌شده: {line.sourceNameFa} · وضعیت گزارش:{' '}
            {
              (
                {
                  unknown: 'نیازمند استعلام',
                  available: 'گزارش موجود',
                  unavailable: 'گزارش ناموجود',
                  stale: 'گزارش منقضی',
                } as const
              )[line.availability]
            }
          </p>
          {line.observedAt && (
            <small>
              زمان مشاهده: {date(line.observedAt)}
              {line.validUntil && ' · اعتبار: ' + date(line.validUntil)}
            </small>
          )}
          {line.referencePriceRial && (
            <p className="notice">
              قیمت مرجع در زمان درخواست:{' '}
              {new Intl.NumberFormat('fa-IR').format(BigInt(line.referencePriceRial))} ریال · قابل
              پرداخت نیست
            </p>
          )}
          <details>
            <summary>مشخصات ثبت‌شده در زمان درخواست</summary>
            <dl className="charge-details">
              {line.model.attributes.map((attribute) => (
                <div key={attribute.attributeId}>
                  <dt>{attribute.labelFa}</dt>
                  <dd>{sourcingAttributeText(attribute, 'fa')}</dd>
                </div>
              ))}
            </dl>
            <p>{line.model.descriptionFa}</p>
          </details>
        </article>
      ))}
    </>
  );
}

function ReceiptLookup({
  busy,
  writable,
  financialWritable,
  onLookup,
}: {
  busy: boolean;
  writable: boolean;
  financialWritable: boolean;
  onLookup: (command: RecoveredAdminCommand) => void;
}) {
  const [target, setTarget] = useState(''),
    [offer, setOffer] = useState(''),
    [task, setTask] = useState(''),
    [command, setCommand] = useState(''),
    [kind, setKind] = useState<ManualSourcingOperation>(writable ? 'review' : 'save');
  const scope = manualSourcingReceiptScope(kind);
  let recovery: RecoveredAdminCommand | null = null;
  try {
    recovery = manualSourcingReceiptRecovery(
      { operation: kind, requestId: target, commandId: command, offerId: offer, taskId: task },
      { sales: writable, financial: financialWritable },
    );
  } catch {
    /* Incomplete or unauthorized targets never issue a receipt request. */
  }
  return (
    <details>
      <summary>پیگیری با شناسهٔ فرمان ذخیره‌شده</summary>
      <p className="notice">
        برای فرمانی که نتیجه‌اش را دریافت نکرده‌اید، شناسه‌های همان تلاش را وارد کنید. رسید فقط برای
        حساب اجراکننده در دسترس است. وضعیت فعلی پس از بازیابی رسید جدا دریافت می‌شود؛ پیدا نشدن رسید
        پایان اجرای فرمان را ثابت نمی‌کند.
      </p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (recovery) onLookup(recovery);
        }}
      >
        <Field label="شناسهٔ درخواست">
          <input
            dir="ltr"
            maxLength={32}
            value={target}
            onChange={(event) => setTarget(event.target.value.trim().toLowerCase())}
            required
          />
        </Field>
        <Field label="شناسهٔ فرمان">
          <input
            dir="ltr"
            maxLength={36}
            value={command}
            onChange={(event) => setCommand(event.target.value.trim().toLowerCase())}
            required
          />
        </Field>
        <Field label="نوع فرمان">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ManualSourcingOperation)}
          >
            {writable && (
              <>
                <option value="review">شروع بررسی</option>
                <option value="unavailable">عدم امکان تأمین</option>
                <option value="supply-start">شروع پیگیری تأمین پذیرفته‌شده</option>
                <option value="supply-requested">گزارش استعلام تأمین</option>
                <option value="supply-ordered">گزارش سفارش دستی تأمین</option>
                <option value="supply-progress">ثبت پیشرفت پیگیری</option>
                <option value="supply-cancel">لغو پیگیری تأمین</option>
                <option value="supply-fail">ثبت شکست تأمین</option>
              </>
            )}
            {financialWritable && (
              <>
                <option value="save">ذخیرهٔ پیش‌نویس پیشنهاد</option>
                <option value="publish">انتشار پیشنهاد</option>
                <option value="withdraw">برداشت پیشنهاد</option>
              </>
            )}
          </select>
        </Field>
        {scope === 'offer' && (
          <Field label="شناسهٔ پیشنهاد">
            <input
              dir="ltr"
              maxLength={32}
              value={offer}
              onChange={(event) => setOffer(event.target.value.trim().toLowerCase())}
              required
            />
          </Field>
        )}
        {scope === 'supply' && (
          <Field label="شناسهٔ پیگیری تأمین">
            <input
              dir="ltr"
              maxLength={32}
              value={task}
              onChange={(event) => setTask(event.target.value.trim().toLowerCase())}
              required
            />
          </Field>
        )}
        <button disabled={busy || !recovery}>دریافت رسید</button>
      </form>
    </details>
  );
}

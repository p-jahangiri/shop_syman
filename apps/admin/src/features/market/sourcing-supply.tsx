import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { Busy, Check, ErrorBox, Field } from '../../components/ui';
import { freezeCommand, utcFromInput, type AdminSourcingCommand } from './sourcing-admin-command';
import {
  supplyAdminDetailV2Schema as supplyAdminDetailSchema,
  supplyAdminEventsSchema,
  supplyAdminPageV2Schema as supplyAdminPageSchema,
  supplyCloseSchema,
  supplyNames,
  supplyProgressSchema,
  supplySourceSchema,
  supplyStartSchema,
  type SupplyAdminCommand,
  type SupplyAdminDetail,
} from '../../api/contracts/market/supply-contract';
import type { SourcingAdminDetail } from '../../api/contracts/market/sourcing-contract';
import { supplyStartReviewKey, supplyStartReviewMatches } from './supply-start-review';
import { SupplyAllocationStatus } from './supply-allocation-status';

const uuid = () => crypto.randomUUID().replaceAll('-', '');
const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
const number = (value: number) => value.toLocaleString('fa-IR');
export function SourcingSupply({
  request,
  writable,
  locked,
  focus,
  onCommand,
}: {
  request: SourcingAdminDetail;
  writable: boolean;
  locked: boolean;
  focus: { taskId: string; token: number } | null;
  onCommand: (command: AdminSourcingCommand) => Promise<boolean>;
}) {
  const requestId = request.summary.id,
    base = '/admin/sourcing/requests/' + requestId;
  const [selected, setSelected] = useState<string | null>(null),
    [reviewedStart, setReviewedStart] = useState<string | null>(null),
    [error, setError] = useState<unknown>();
  const focusedTaskId = focus?.taskId;
  const focusToken = focus?.token;
  useEffect(() => {
    if (focusedTaskId) setSelected(focusedTaskId);
  }, [focusedTaskId, focusToken]);
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'sourcing-supply', requestId],
    queryFn: async ({ pageParam }) => {
      const value = supplyAdminPageSchema.parse(
        await api<unknown>(base + '/supply/v2' + (pageParam ? '?cursor=' + pageParam : '')),
      );
      if (value.requestId !== requestId || value.requestReference !== request.summary.reference)
        throw new Error('فهرست تأمین به درخواست دیگری تعلق دارد.');
      return value;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: ['admin', 'sourcing-supply-detail', requestId, selected],
    queryFn: async () => {
      const value = supplyAdminDetailSchema.parse(
        await api<unknown>(base + '/supply/v2/' + selected),
      );
      if (
        value.requestId !== requestId ||
        value.task.id !== selected ||
        value.requestReference !== request.summary.reference
      )
        throw new Error('جزئیات تأمین با هدف یکسان نیست.');
      return value;
    },
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const events = useInfiniteQuery({
    queryKey: ['admin', 'sourcing-supply-events', requestId, selected],
    queryFn: async ({ pageParam }) =>
      supplyAdminEventsSchema.parse(
        await api<unknown>(
          base + '/supply/' + selected + '/events' + (pageParam ? '?cursor=' + pageParam : ''),
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const items = Array.from(
    new Map(
      pages.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]) ?? [],
    ).values(),
  );
  const fresh =
    !pages.isError &&
    pages.fetchStatus === 'idle' &&
    pages.data?.pages.every((page) => page.requestVersion === request.summary.version) === true;
  const eligible = pages.data?.pages[0].startCandidate ?? null;
  const confirmed = supplyStartReviewMatches(
    reviewedStart,
    requestId,
    request.summary.version,
    eligible,
  );
  const setConfirmed = (checked: boolean) =>
    setReviewedStart(
      checked ? supplyStartReviewKey(requestId, request.summary.version, eligible) : null,
    );
  const detailFresh =
    fresh &&
    !detail.isError &&
    detail.fetchStatus === 'idle' &&
    detail.data?.requestVersion === request.summary.version;
  async function start() {
    setError(undefined);
    try {
      if (!writable || locked || !fresh || !confirmed || !eligible) return;
      const id = uuid();
      await onCommand(
        freezeCommand({
          kind: 'supply-start',
          id,
          requestId,
          taskId: uuid(),
          offerId: eligible.offerId,
          reference: request.summary.reference,
          phase: 'pending',
          body: supplyStartSchema.parse({
            requestId: id,
            requestVersion: request.summary.version,
            offerVersion: eligible.offerVersion,
            termsHash: eligible.termsHash,
          }),
        }),
      );
      setConfirmed(false);
    } catch (failure) {
      setError(failure);
    }
  }
  const refresh = () => {
    void pages.refetch();
    if (selected) {
      void detail.refetch();
      void events.refetch();
    }
    setConfirmed(false);
  };
  return (
    <section className="sourcing-supply">
      <div className="section-heading">
        <div>
          <h3>پیگیری تأمین و دریافت واقعی</h3>
          <p>
            ثبت اقدام فروشنده فقط گزارش اپراتور است. دریافت واقعی را کاربر مجاز انبار در صفحهٔ
            «دریافت تأمین» ثبت می‌کند.
          </p>
        </div>
        <button disabled={locked || pages.isFetching || detail.isFetching} onClick={refresh}>
          دریافت وضعیت تازهٔ تأمین
        </button>
      </div>
      <p className="notice">
        دریافت واقعی و تخصیص موجودی دو اقدام مستقل‌اند. وضعیت و مهلت نگه‌داری هر پیگیری در جزئیات
        نمایش داده می‌شود؛ خرید و پرداخت هنوز از این بخش انجام نمی‌شود.
      </p>
      <ErrorBox error={error ?? pages.error} />
      {pages.isPending ? (
        <Busy />
      ) : (
        <>
          <div
            className="table-wrap"
            role="region"
            aria-label="پیگیری‌های تأمین این درخواست"
            tabIndex={0}
          >
            <AdminTable>
              <thead>
                <tr>
                  <th>وضعیت</th>
                  <th>تعداد لازم / دریافت / باقی‌مانده</th>
                  <th>آخرین تغییر</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {supplyNames[item.effectiveState]}
                      {item.allocation && (
                        <small> · تخصیص ثبت‌شده تا {date(item.allocation.expiresAt)}</small>
                      )}
                      {item.isDemo && <small> · نمونهٔ توسعه</small>}
                    </td>
                    <td>
                      {number(item.requiredQuantity)} / {number(item.receivedQuantity)} /{' '}
                      {number(item.remainingQuantity)}
                    </td>
                    <td data-sort-value={item.changedAt}>{date(item.changedAt)}</td>
                    <td>
                      <button disabled={locked} onClick={() => setSelected(item.id)}>
                        نمایش پیگیری تأمین
                      </button>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={4}>هنوز پیگیری تأمینی ثبت نشده است.</td>
                  </tr>
                )}
              </tbody>
            </AdminTable>
          </div>
          {pages.hasNextPage && (
            <button disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
              ۵۰ پیگیری بعدی
            </button>
          )}
        </>
      )}
      {writable && eligible && (
        <fieldset disabled={locked || !fresh}>
          <legend>شروع صریح پیگیری از پذیرش فعال مشتری</legend>
          <p>
            پیشنهاد <bdi>{eligible.offerId}</bdi> · پذیرش <bdi>{eligible.acceptanceId}</bdi>
          </p>
          <p>پایان اعتبار: {date(eligible.purchaseUntil)}</p>
          <Check
            label="پیگیری همین پذیرش را شروع می‌کنم؛ موجودی، رزرو یا سفارش فروش از این فرمان ایجاد نمی‌شود."
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <button className="primary" disabled={!confirmed} onClick={() => void start()}>
            شروع پیگیری همین پذیرش
          </button>
        </fieldset>
      )}
      {selected && (
        <article className="supply-detail">
          <button disabled={locked} onClick={() => setSelected(null)}>
            بستن جزئیات پیگیری
          </button>
          <ErrorBox error={detail.error} />
          {detail.isPending ? (
            <Busy />
          ) : (
            detail.data && (
              <>
                <SupplySnapshot value={detail.data} />
                {writable && (
                  <SupplyActions
                    key={
                      detail.data.task.version +
                      ':' +
                      detail.dataUpdatedAt +
                      ':' +
                      pages.dataUpdatedAt
                    }
                    value={detail.data}
                    locked={locked || !detailFresh}
                    onCommand={onCommand}
                  />
                )}
                <h4>تاریخچهٔ پیگیری</h4>
                <ErrorBox error={events.error} />
                {events.isPending ? (
                  <Busy />
                ) : (
                  <ol className="sourcing-events">
                    {events.data?.pages
                      .flatMap((page) => page.items)
                      .map(({ event, sourceNameFa, reference, internalNote }) => (
                        <li key={event.id}>
                          <strong>{supplyNames[event.stateAfter]}</strong> · {date(event.at)}
                          <p>{event.publicMessageFa}</p>
                          <p lang="en" dir="ltr">
                            {event.publicMessageEn}
                          </p>
                          {sourceNameFa && (
                            <small>
                              منبع داخلی: {sourceNameFa}
                              {reference && ' · مرجع: ' + reference}
                            </small>
                          )}
                          {internalNote && (
                            <details>
                              <summary>یادداشت داخلی همان رویداد</summary>
                              <p className="preserve-lines">{internalNote}</p>
                            </details>
                          )}
                        </li>
                      ))}
                  </ol>
                )}
                {events.hasNextPage && (
                  <button
                    disabled={events.isFetchingNextPage}
                    onClick={() => void events.fetchNextPage()}
                  >
                    ۵۰ رویداد بعدی تأمین
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
function SupplySnapshot({ value }: { value: SupplyAdminDetail }) {
  return (
    <>
      <SupplyAllocationStatus
        allocation={value.task.allocation}
        reserved={value.reservedForRequest}
      />
      <h4>{supplyNames[value.task.effectiveState]}</h4>
      <dl className="charge-details">
        <dt>شناسهٔ پیگیری</dt>
        <dd>
          <bdi>{value.task.id}</bdi>
        </dd>
        <dt>پیشنهاد / پذیرش</dt>
        <dd>
          <bdi>{value.task.offerId}</bdi>
          <br />
          <bdi>{value.task.acceptanceId}</bdi>
        </dd>
        <dt>وضعیت دریافت</dt>
        <dd>
          {
            (
              {
                None: 'دریافتی ثبت نشده',
                Partial: 'بخشی دریافت شده',
                Complete: 'همه دریافت شده',
              } as const
            )[value.task.receiptProgress]
          }
        </dd>
        <dt>زمان احتمالی</dt>
        <dd>{value.task.expectedAt ? date(value.task.expectedAt) : 'تعیین نشده'}</dd>
        <dt>مهلت پیشنهاد پذیرفته‌شده</dt>
        <dd>{date(value.task.purchaseUntil)}</dd>
      </dl>
      {value.task.requiresNewOffer && (
        <p className="notice">
          ادامهٔ خرید به پیشنهاد و رضایت تازه نیاز دارد؛ دریافت واقعی مهلت گذشته را زنده نمی‌کند.
        </p>
      )}
      <p>{value.publicMessageFa}</p>
      <p lang="en" dir="ltr">
        {value.publicMessageEn}
      </p>
      {value.sourceNameFa && (
        <div className="notice">
          <strong>اطلاعات داخلی تأمین‌کننده</strong>
          <p>
            {value.sourceNameFa} · <bdi>{value.sourceNameEn}</bdi>
          </p>
          <p>
            کلید منبع: <bdi>{value.sourceKey}</bdi>
            {value.reference && (
              <>
                {' '}
                · مرجع: <bdi>{value.reference}</bdi>
              </>
            )}
          </p>
        </div>
      )}
      {value.internalNote && (
        <details>
          <summary>یادداشت داخلی کارکنان فروش</summary>
          <p className="preserve-lines">{value.internalNote}</p>
        </details>
      )}
      {value.lines.map((line) => (
        <article className="sourcing-request-line" key={line.offerLineId}>
          <h4>
            {line.nameFa} · {line.labelFa}
          </h4>
          <p>
            <bdi>{line.sku}</bdi>
          </p>
          <p>
            تعداد پذیرفته‌شده {number(line.requiredQuantity)} · دریافت واقعی{' '}
            {number(line.receivedQuantity)} · باقی‌مانده {number(line.remainingQuantity)}
          </p>
        </article>
      ))}
    </>
  );
}
function SupplyActions({
  value,
  locked,
  onCommand,
}: {
  value: SupplyAdminDetail;
  locked: boolean;
  onCommand: (command: AdminSourcingCommand) => Promise<boolean>;
}) {
  const [operation, setOperation] = useState<
      'requested' | 'ordered' | 'progress' | 'cancel' | 'fail'
    >('progress'),
    [fields, setFields] = useState({
      sourceKind: '',
      sourceKey: '',
      sourceNameFa: '',
      sourceNameEn: '',
      reference: '',
      actionAt: '',
      expectedAt: '',
      publicMessageFa: '',
      publicMessageEn: '',
      internalNote: '',
      reasonCode: '',
    }),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<unknown>();
  const source = operation === 'requested' || operation === 'ordered',
    close = operation === 'cancel' || operation === 'fail',
    allowed = close
      ? operation === 'cancel'
        ? value.canCancel
        : value.canFail
      : source
        ? value.canRecordSource
        : value.canProgress;
  function change(key: keyof typeof fields, text: string) {
    setFields((old) => ({ ...old, [key]: text }));
    setConfirm(false);
  }
  async function submit() {
    setError(undefined);
    try {
      if (locked || !confirm || !allowed) return;
      const id = uuid(),
        base = {
          requestId: id,
          requestVersion: value.requestVersion,
          taskVersion: value.task.version,
          publicMessageFa: fields.publicMessageFa,
          publicMessageEn: fields.publicMessageEn,
          internalNote: fields.internalNote,
        };
      let command: SupplyAdminCommand;
      if (source) {
        if (operation === 'ordered' && !fields.reference)
          throw new Error('ثبت سفارش دستی به مرجع واقعی همان اقدام نیاز دارد.');
        command = {
          kind: operation === 'ordered' ? 'supply-ordered' : 'supply-requested',
          id,
          reference: value.requestReference,
          requestId: value.requestId,
          taskId: value.task.id,
          phase: 'pending',
          body: supplySourceSchema.parse({
            ...base,
            sourceKind: fields.sourceKind,
            sourceKey: fields.sourceKey,
            sourceNameFa: fields.sourceNameFa,
            sourceNameEn: fields.sourceNameEn,
            reference: fields.reference || null,
            actionAt: utcFromInput(fields.actionAt),
            expectedAt: fields.expectedAt ? utcFromInput(fields.expectedAt) : null,
          }),
        };
      } else if (close) {
        command = {
          kind: operation === 'cancel' ? 'supply-cancel' : 'supply-fail',
          id,
          reference: value.requestReference,
          requestId: value.requestId,
          taskId: value.task.id,
          phase: 'pending',
          body: supplyCloseSchema.parse({ ...base, reasonCode: fields.reasonCode }),
        };
      } else
        command = {
          kind: 'supply-progress',
          id,
          reference: value.requestReference,
          requestId: value.requestId,
          taskId: value.task.id,
          phase: 'pending',
          body: supplyProgressSchema.parse({
            ...base,
            actionAt: utcFromInput(fields.actionAt),
            expectedAt: fields.expectedAt ? utcFromInput(fields.expectedAt) : null,
          }),
        };
      await onCommand(freezeCommand(command));
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message.startsWith('[')
          ? new Error('فیلدهای لازم، پیام دو زبان، کلیدها و زمان UTC را بررسی کنید.')
          : failure,
      );
    }
  }
  if (!value.canRecordSource && !value.canProgress && !value.canCancel && !value.canFail)
    return null;
  const input = (key: keyof typeof fields, label: string, max = 200) => (
    <Field label={label}>
      <input
        dir={key === 'sourceNameFa' ? 'rtl' : 'ltr'}
        maxLength={max}
        value={fields[key]}
        onChange={(event) => change(key, event.target.value)}
      />
    </Field>
  );
  return (
    <fieldset disabled={locked}>
      <legend>ثبت اقدام واقعی کارکنان فروش</legend>
      <ErrorBox error={error} />
      <Field label="نوع اقدام">
        <select
          value={operation}
          onChange={(event) => {
            setOperation(event.target.value as typeof operation);
            setConfirm(false);
          }}
        >
          <option value="progress">توضیح پیگیری</option>
          {value.canRecordSource && (
            <>
              <option value="requested">گزارش استعلام دستی</option>
              <option value="ordered">گزارش سفارش واقعی نزد تأمین‌کننده</option>
            </>
          )}
          {value.canCancel && <option value="cancel">لغو پیگیری تأمین</option>}
          {value.canFail && <option value="fail">ثبت ناموفق‌بودن تأمین</option>}
        </select>
      </Field>
      <div className="form-grid">
        {source && (
          <>
            <Field label="روش ثبت اقدام">
              <select
                value={fields.sourceKind}
                onChange={(event) => change('sourceKind', event.target.value)}
              >
                <option value="">انتخاب کنید</option>
                <option value="manual">ورود دستی</option>
                <option value="csv">ثبت از سند CSV</option>
              </select>
            </Field>
            {input('sourceKey', 'کلید پایدار منبع', 120)}
            {input('sourceNameFa', 'نام فارسی منبع')}
            {input('sourceNameEn', 'English source name')}
            {input(
              'reference',
              operation === 'ordered' ? 'مرجع واقعی سفارش — لازم' : 'مرجع اقدام — اختیاری',
            )}
          </>
        )}
        {!close && (
          <>
            <div className="field">
              <PersianDateField
                label="زمان واقعی اقدام — UTC"
                encoding="utc"
                value={fields.actionAt}
                onChange={(next) => change('actionAt', next)}
              />
            </div>
            <div className="field">
              <PersianDateField
                label="زمان احتمالی تأمین — UTC، اختیاری"
                encoding="utc"
                value={fields.expectedAt}
                onChange={(next) => change('expectedAt', next)}
              />
            </div>
          </>
        )}
        {close && (
          <Field label="دلیل پایان پیگیری">
            <select
              value={fields.reasonCode}
              onChange={(event) => change('reasonCode', event.target.value)}
            >
              <option value="">انتخاب دلیل</option>
              <option value="supplier_unavailable">تأمین‌کننده در دسترس نیست</option>
              <option value="customer_request">درخواست مشتری</option>
              <option value="other">دلیل دیگر</option>
            </select>
          </Field>
        )}
        <Field label="پیام قابل مشاهدهٔ مشتری — فارسی">
          <textarea
            maxLength={500}
            value={fields.publicMessageFa}
            onChange={(event) => change('publicMessageFa', event.target.value)}
          />
        </Field>
        <Field label="Customer message — English">
          <textarea
            dir="ltr"
            lang="en"
            maxLength={500}
            value={fields.publicMessageEn}
            onChange={(event) => change('publicMessageEn', event.target.value)}
          />
        </Field>
        <Field label="یادداشت داخلی فروش — اختیاری">
          <textarea
            maxLength={2000}
            value={fields.internalNote}
            onChange={(event) => change('internalNote', event.target.value)}
          />
        </Field>
      </div>
      <Check
        label={
          close
            ? 'پایان همین پیگیری را تأیید می‌کنم؛ موجودی دریافت‌شده حذف و سفارش فروش لغو نمی‌شود.'
            : 'این اقدام واقعاً انجام شده و اطلاعات و زمان آن را بررسی کرده‌ام؛ سیستم برای تأمین‌کننده پیام یا سفارش خارجی نمی‌فرستد.'
        }
        checked={confirm}
        onChange={(event) => setConfirm(event.target.checked)}
      />
      <button className="primary" disabled={!allowed || !confirm} onClick={() => void submit()}>
        ثبت همین اقدام تأمین
      </button>
    </fieldset>
  );
}

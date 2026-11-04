import { PersianDateField } from '../../components/forms/persian-date-field';
import { AdminTable } from '../../components/tables/admin-table';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../api/api';
import { Busy, Check, ErrorBox, Field } from '../../components/ui';
import {
  offerActionSchema,
  offerAdminDetailSchema,
  offerAdminEventsSchema,
  offerAdminPageSchema,
  offerPublishSchema,
  offerSaveSchema,
  offerSkuPageSchema,
  offerSkuSchema,
  offerSkuLookupPath,
  offerSkuReadPath,
  type OfferAdminCommand,
  type OfferAdminDetail,
  type OfferSku,
} from '../../api/contracts/market/offer-contract';
import {
  freezeCommand,
  offerControlsFresh,
  offerEditorLines,
  utcFromInput,
  type AdminSourcingCommand,
  type OfferEditorLine,
} from './sourcing-admin-command';
import {
  sourcingAttributeText,
  type SourcingAdminDetail,
} from '../../api/contracts/market/sourcing-contract';

const id = () => crypto.randomUUID().replaceAll('-', '');
const money = (value: string) => new Intl.NumberFormat('fa-IR').format(BigInt(value)) + ' ریال';
const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
const utcInput = (value: string) => new Date(value).toISOString().slice(0, 19);
const names: Record<string, string> = {
  Draft: 'پیش‌نویس خصوصی',
  Published: 'منتشرشده',
  Accepted: 'پذیرفته‌شده',
  Declined: 'ردشده',
  Withdrawn: 'برداشته‌شده',
  Superseded: 'جایگزین‌شده',
  Expired: 'منقضی‌شده',
};
const blockers: Record<string, string> = {
  sourcing_state_conflict: 'درخواست بسته است.',
  sourcing_offer_expired_conflict: 'مهلت پیشنهاد گذشته است.',
  sourcing_offer_catalog_conflict:
    'مشخصات یا وضعیت SKU تغییر کرده است؛ برای پیشنهاد تازه، مشخصات جاری را بازبینی کنید.',
  sourcing_offer_purchase_conflict: 'روش خرید مشترک فعال و متناسب با مبلغ/دسته وجود ندارد.',
  sourcing_offer_accepted_conflict:
    'پیشنهاد پذیرفته‌شدهٔ معتبر اجازهٔ انتشار جایگزین یا بستن درخواست را نمی‌دهد.',
};
type Props = {
  request: SourcingAdminDetail;
  financialWritable: boolean;
  locked: boolean;
  focus: { offerId: string; token: number } | null;
  onGuard: (guard: { requestVersion: string; canMark: boolean } | null) => void;
  onCommand: (command: AdminSourcingCommand) => Promise<boolean>;
};
export function SourcingOffers({
  request,
  financialWritable,
  locked,
  focus,
  onGuard,
  onCommand,
}: Props) {
  const requestId = request.summary.id;
  const [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<{ id: string; initial: OfferAdminDetail | null } | null>(null);
  const focusedOfferId = focus?.offerId;
  const focusToken = focus?.token;
  useEffect(() => {
    if (focusedOfferId) {
      setSelected(focusedOfferId);
      setEditing(null);
    }
  }, [focusedOfferId, focusToken]);
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'sourcing-offers', requestId],
    queryFn: async ({ pageParam }) => {
      const parsed = offerAdminPageSchema.parse(
        await api<unknown>(
          `/admin/sourcing/requests/${requestId}/offers${pageParam ? '?cursor=' + encodeURIComponent(pageParam) : ''}`,
        ),
      );
      if (parsed.requestId !== requestId || parsed.requestReference !== request.summary.reference)
        throw new Error('فهرست پیشنهاد متعلق به این درخواست نیست.');
      return parsed;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  });
  const page = pages.data?.pages[0];
  const pageVersionMismatch =
    pages.data?.pages.some((item) => item.requestVersion !== request.summary.version) ?? false;
  useEffect(() => {
    onGuard(
      page &&
        !pages.isError &&
        !pageVersionMismatch &&
        pages.fetchStatus === 'idle' &&
        page.requestVersion === request.summary.version
        ? { requestVersion: page.requestVersion, canMark: page.canMarkRequestUnavailable }
        : null,
    );
    return () => onGuard(null);
  }, [
    page,
    page?.requestVersion,
    page?.canMarkRequestUnavailable,
    pages.isError,
    pageVersionMismatch,
    pages.fetchStatus,
    request.summary.version,
    onGuard,
  ]);
  const detail = useQuery({
    queryKey: ['admin', 'sourcing-offer', requestId, selected],
    queryFn: async () => {
      const parsed = offerAdminDetailSchema.parse(
        await api<unknown>(`/admin/sourcing/requests/${requestId}/offers/${selected}`),
      );
      if (
        parsed.requestId !== requestId ||
        parsed.offer.summary.id !== selected ||
        parsed.requestReference !== request.summary.reference
      )
        throw new Error('جزئیات پیشنهاد متعلق به این هدف نیست.');
      return parsed;
    },
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const events = useInfiniteQuery({
    queryKey: ['admin', 'sourcing-offer-events', requestId, selected],
    queryFn: async ({ pageParam }) =>
      offerAdminEventsSchema.parse(
        await api<unknown>(
          `/admin/sourcing/requests/${requestId}/offers/${selected}/events${pageParam ? '?cursor=' + encodeURIComponent(pageParam) : ''}`,
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const items = Array.from(
    new Map(
      pages.data?.pages.flatMap((p) => p.items).map((item) => [item.id, item]) ?? [],
    ).values(),
  );
  const open = ['Submitted', 'Reviewing'].includes(request.summary.state);
  const pageFresh = offerControlsFresh({
    parentVersion: request.summary.version,
    pageVersion: page?.requestVersion,
    pageError: pages.isError || pageVersionMismatch,
    pageFetching: pages.fetchStatus !== 'idle',
  });
  const detailFresh = offerControlsFresh({
    parentVersion: request.summary.version,
    pageVersion: page?.requestVersion,
    pageError: pages.isError || pageVersionMismatch,
    pageFetching: pages.fetchStatus !== 'idle',
    detailVersion: detail.data?.requestVersion,
    detailError: detail.isError,
    detailFetching: detail.fetchStatus !== 'idle',
    requireDetail: true,
  });
  const editorFresh =
    pageFresh &&
    (!editing?.initial ||
      (detailFresh &&
        detail.data?.canEditDraft === true &&
        editing.initial.offer.summary.version === detail.data.offer.summary.version &&
        editing.initial.requestVersion === detail.data.requestVersion));
  const send = async (command: OfferAdminCommand) => {
    if (
      !financialWritable ||
      locked ||
      !pageFresh ||
      command.requestId !== requestId ||
      (command.kind === 'save' && !editorFresh) ||
      (command.kind !== 'save' && !detailFresh)
    )
      return false;
    return onCommand(freezeCommand({ ...command, reference: request.summary.reference }));
  };
  return (
    <section className="sourcing-offers">
      <div className="section-heading">
        <div>
          <h3>پیشنهاد قیمت و رضایت مشتری</h3>
          <p>
            پذیرش فقط رضایت برای پیگیری تأمین است؛ پرداخت، رزرو و سفارش فروش ایجاد نمی‌کند. جمع
            مبالغ، فقط اقلام پیشنهاد است.
          </p>
        </div>
        {financialWritable && open && (
          <button
            disabled={locked || !pageFresh}
            onClick={() => {
              setEditing({ id: id(), initial: null });
              setSelected(null);
            }}
          >
            پیشنهاد تازه
          </button>
        )}
      </div>
      {!financialWritable && (
        <p className="notice">
          پیشنهادها برای شما فقط خواندنی‌اند؛ تغییر قیمت، انتشار و برداشت به مجوز مالی نیاز دارند.
        </p>
      )}
      <ErrorBox error={pages.error} />
      {pages.isPending ? (
        <Busy />
      ) : (
        <>
          <div className="table-wrap" role="region" aria-label="فهرست پیشنهادهای قیمت" tabIndex={0}>
            <AdminTable>
              <thead>
                <tr>
                  <th>نسخه</th>
                  <th>وضعیت مؤثر</th>
                  <th>جمع اقلام</th>
                  <th>مهلت پذیرش</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.revision.toLocaleString('fa-IR')}
                      {item.isDemo && <small> · نمونهٔ توسعه</small>}
                    </td>
                    <td>{names[item.effectiveState]}</td>
                    <td data-sort-value={item.totalRial}>{money(item.totalRial)}</td>
                    <td data-sort-value={item.acceptUntil}>{date(item.acceptUntil)}</td>
                    <td>
                      <button
                        disabled={locked}
                        onClick={() => {
                          setSelected(item.id);
                          setEditing(null);
                        }}
                      >
                        نمایش پیشنهاد
                      </button>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={5}>هنوز پیشنهادی ثبت نشده است.</td>
                  </tr>
                )}
              </tbody>
            </AdminTable>
          </div>
          {pages.hasNextPage && (
            <button disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
              ۵۰ پیشنهاد بعدی
            </button>
          )}
        </>
      )}
      {editing && (
        <>
          {!editorFresh && (
            <div className="notice">
              <p>
                اطلاعات جاری هم‌نسخه و قابل استفاده نیست؛ وضعیت تازه را دریافت کنید. اگر نسخهٔ
                پیش‌نویس عوض شده است، فرم را ببندید و نسخهٔ تازه را برای ویرایش باز کنید.
              </p>
              <button disabled={locked} onClick={() => setEditing(null)}>
                بستن فرم برای بازبینی نسخهٔ تازه
              </button>
            </div>
          )}
          <OfferEditor
            key={editing.id + ':' + (editing.initial?.offer.summary.version ?? 'new')}
            request={request}
            requestVersion={
              editing.initial?.requestVersion ?? page?.requestVersion ?? request.summary.version
            }
            offerId={editing.id}
            initial={editing.initial}
            locked={locked || !financialWritable || !editorFresh}
            onCancel={() => setEditing(null)}
            onSend={async (command) => {
              if (await send(command)) setEditing(null);
            }}
          />
        </>
      )}
      {selected && !editing && (
        <article className="offer-detail">
          <button disabled={locked} onClick={() => setSelected(null)}>
            بستن جزئیات پیشنهاد
          </button>
          <ErrorBox error={detail.error} />
          {detail.isPending ? (
            <Busy />
          ) : (
            detail.data && (
              <>
                <OfferSnapshot detail={detail.data} />
                <button
                  disabled={locked || detail.isFetching}
                  onClick={() => {
                    void detail.refetch();
                    void events.refetch();
                    void pages.refetch();
                  }}
                >
                  دریافت وضعیت تازهٔ پیشنهاد
                </button>
                {financialWritable && detail.data.canEditDraft && (
                  <button
                    disabled={locked || !detailFresh}
                    onClick={() =>
                      setEditing({ id: detail.data!.offer.summary.id, initial: detail.data! })
                    }
                  >
                    ویرایش پیش‌نویس
                  </button>
                )}
                {financialWritable && (
                  <OfferActions
                    key={
                      detail.data.offer.summary.version +
                      ':' +
                      detail.dataUpdatedAt +
                      ':' +
                      pages.dataUpdatedAt
                    }
                    detail={detail.data}
                    locked={locked || !detailFresh}
                    onSend={send}
                  />
                )}
                <h4>تاریخچهٔ پیشنهاد</h4>
                <ErrorBox error={events.error} />
                {events.isPending ? (
                  <Busy />
                ) : (
                  <ol className="sourcing-events">
                    {events.data?.pages
                      .flatMap((p) => p.items)
                      .map((event) => (
                        <li key={event.id}>
                          <strong>{names[event.stateAfter]}</strong> · نسخه{' '}
                          {event.revision.toLocaleString('fa-IR')} · {date(event.at)}
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
                    ۵۰ رویداد بعدی پیشنهاد
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

function OfferSnapshot({ detail }: { detail: OfferAdminDetail }) {
  const { offer } = detail,
    summary = offer.summary;
  return (
    <>
      <h4>
        {names[summary.effectiveState]} · نسخه {summary.revision.toLocaleString('fa-IR')}
      </h4>
      <dl className="charge-details">
        <dt>شناسهٔ پیشنهاد</dt>
        <dd>
          <bdi>{summary.id}</bdi>
        </dd>
        <dt>نسخهٔ سرور برای پیگیری</dt>
        <dd>
          <bdi>{summary.version}</bdi>
        </dd>
        <dt>جمع اقلام، بدون حمل و مالیات</dt>
        <dd>{money(summary.totalRial)}</dd>
        <dt>پایان پذیرش</dt>
        <dd>{date(summary.acceptUntil)}</dd>
        <dt>پایان اعتبار خرید آینده</dt>
        <dd>{date(summary.purchaseUntil)}</dd>
        <dt>زمان احتمالی تأمین</dt>
        <dd>{summary.expectedAt ? date(summary.expectedAt) : 'تعیین نشده'}</dd>
      </dl>
      <p>
        تاریخ‌ها در نمایش بالا به وقت تهران‌اند. پیشنهاد منتشرشده برای مشتری ثابت می‌ماند؛ تغییر
        مشخصات نیازمند پیشنهاد تازه است.
      </p>
      <h4>شرایط فارسی</h4>
      <p className="offer-terms">{offer.termsFa}</p>
      <h4>English terms</h4>
      <p className="offer-terms" lang="en" dir="ltr">
        {offer.termsEn}
      </p>
      {detail.blockers.length > 0 && (
        <div className="notice">
          {detail.blockers.map((code) => (
            <p key={code}>
              {blockers[code] ??
                'وضعیت فعلی اجازهٔ ادامهٔ این پیشنهاد را نمی‌دهد؛ اطلاعات تازه را بررسی کنید.'}
            </p>
          ))}
        </div>
      )}
      {offer.lines.map((line) => (
        <article className="sourcing-request-line" key={line.lineId}>
          <h4>
            {line.sku.model.nameFa} · {line.sku.labelFa}
          </h4>
          <p>
            <bdi>{line.sku.sku}</bdi> · تعداد {line.quantity.toLocaleString('fa-IR')}
          </p>
          <p>
            هر واحد {money(line.unitPriceRial)} · جمع ردیف {money(line.lineTotalRial)}
          </p>
          <SkuSnapshot sku={line.sku} />
        </article>
      ))}
    </>
  );
}
function SkuSnapshot({ sku }: { sku: OfferSku }) {
  return (
    <details>
      <summary>مشخصات و گارانتی SKU ثبت‌شده</summary>
      <p>
        {sku.model.nameFa} · <bdi>{sku.model.nameEn}</bdi>
      </p>
      <p>
        رنگ: {sku.colorNameFa || 'تعیین نشده'} · <bdi>{sku.colorNameEn}</bdi>
      </p>
      <p>گارانتی: {sku.warrantyFa || 'متن گارانتی در کاتالوگ تعیین نشده است.'}</p>
      <p lang="en" dir="ltr">
        {sku.warrantyEn || 'Warranty text is not configured.'}
      </p>
      <dl className="charge-details">
        {[
          ...sku.model.attributes.map((a) => ({ scope: 'model', a })),
          ...sku.attributes.map((a) => ({ scope: 'variant', a })),
        ].map(({ scope, a }) => (
          <div key={scope + ':' + a.attributeId}>
            <dt>
              {a.labelFa}
              {scope === 'variant' ? ' · تنوع' : ''}
            </dt>
            <dd>
              {sourcingAttributeText(a, 'fa')}
              <small lang="en" dir="ltr">
                {sourcingAttributeText(a, 'en')}
              </small>
            </dd>
          </div>
        ))}
      </dl>
      <p>{sku.model.descriptionFa}</p>
      <p lang="en" dir="ltr">
        {sku.model.descriptionEn}
      </p>
      <small>
        قیمت عمومی ثبت‌شدهٔ کاتالوگ: {money(sku.publicPriceRial)}؛ قیمت پیشنهادی از فیلد جداگانهٔ
        مدیر مالی می‌آید.
      </small>
    </details>
  );
}

function OfferActions({
  detail,
  locked,
  onSend,
}: {
  detail: OfferAdminDetail;
  locked: boolean;
  onSend: (command: OfferAdminCommand) => Promise<boolean>;
}) {
  const [supersedes, setSupersedes] = useState(''),
    [version, setVersion] = useState(''),
    [confirm, setConfirm] = useState(false),
    [withdrawConfirm, setWithdrawConfirm] = useState(false),
    [error, setError] = useState<unknown>();
  async function act(kind: 'publish' | 'withdraw') {
    setError(undefined);
    try {
      const commandId = crypto.randomUUID();
      const base = {
        requestId: commandId,
        requestVersion: detail.requestVersion,
        version: detail.offer.summary.version,
        termsHash: detail.offer.summary.termsHash,
      };
      if (kind === 'publish') {
        if ((supersedes || version) && !confirm)
          throw new Error('جایگزینی پیشنهاد قبلی را صریح تأیید کنید.');
        const body = offerPublishSchema.parse({
          ...base,
          supersedesOfferId: supersedes || null,
          supersedesVersion: version || null,
        });
        await onSend({
          id: commandId,
          kind,
          requestId: detail.requestId,
          offerId: detail.offer.summary.id,
          body,
          phase: 'pending',
        });
      } else {
        if (!withdrawConfirm) return;
        await onSend({
          id: commandId,
          kind,
          requestId: detail.requestId,
          offerId: detail.offer.summary.id,
          body: offerActionSchema.parse(base),
          phase: 'pending',
        });
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? new Error('اطلاعات عملیات معتبر نیست؛ نسخه‌ها و تأیید جایگزینی را بررسی کنید.')
          : failure,
      );
    }
  }
  if (!detail.canPublish && !detail.canWithdraw) return null;
  return (
    <fieldset disabled={locked}>
      <legend>عملیات مالی پیشنهاد</legend>
      <ErrorBox error={error} />
      {detail.canPublish && (
        <div className="offer-publish">
          <p>
            با انتشار، این شرایط و قیمت برای مشتری قابل مشاهده می‌شود. اگر پیشنهاد منتشرشدهٔ دیگری
            فعال است، شناسه و نسخهٔ آن را از جزئیاتش بردارید و جایگزینی را تأیید کنید.
          </p>
          <div className="form-grid">
            <Field label="شناسهٔ پیشنهاد قبلی برای جایگزینی (اختیاری)">
              <input
                dir="ltr"
                maxLength={32}
                value={supersedes}
                onChange={(e) => {
                  setSupersedes(e.target.value.trim().toLowerCase());
                  setConfirm(false);
                }}
              />
            </Field>
            <Field label="نسخهٔ سرور پیشنهاد قبلی">
              <input
                dir="ltr"
                maxLength={12}
                value={version}
                onChange={(e) => {
                  setVersion(e.target.value.trim());
                  setConfirm(false);
                }}
              />
            </Field>
          </div>
          {(supersedes || version) && (
            <Check
              label="پیشنهاد قبلی و نسخهٔ آن را بررسی کرده‌ام و جایگزینی آن را تأیید می‌کنم."
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
          )}
          <button
            className="primary"
            disabled={locked || (!!(supersedes || version) && !confirm)}
            onClick={() => void act('publish')}
          >
            انتشار همین قیمت و شرایط
          </button>
        </div>
      )}
      {detail.canWithdraw && (
        <div className="offer-withdraw">
          <Check
            label="برداشت این پیشنهاد را تأیید می‌کنم؛ شرایط منتشرشده دیگر قابل پذیرش نخواهد بود."
            checked={withdrawConfirm}
            onChange={(e) => setWithdrawConfirm(e.target.checked)}
          />
          <button disabled={locked || !withdrawConfirm} onClick={() => void act('withdraw')}>
            برداشت همین پیشنهاد
          </button>
        </div>
      )}
    </fieldset>
  );
}

function OfferEditor({
  request,
  requestVersion,
  offerId,
  initial,
  locked,
  onCancel,
  onSend,
}: {
  request: SourcingAdminDetail;
  requestVersion: string;
  offerId: string;
  initial: OfferAdminDetail | null;
  locked: boolean;
  onCancel: () => void;
  onSend: (command: OfferAdminCommand) => Promise<void>;
}) {
  const [lines, setLines] = useState<OfferEditorLine[]>(
    () =>
      initial?.offer.lines.map((line) => ({
        lineId: line.lineId,
        listingId: line.listingId,
        quantity: String(line.quantity),
        price: line.unitPriceRial,
        sku: line.sku,
      })) ?? [],
  );
  const [fields, setFields] = useState(() => ({
    termsFa: initial?.offer.termsFa ?? '',
    termsEn: initial?.offer.termsEn ?? '',
    accept: initial ? utcInput(initial.offer.summary.acceptUntil) : '',
    purchase: initial ? utcInput(initial.offer.summary.purchaseUntil) : '',
    expected: initial?.offer.summary.expectedAt ? utcInput(initial.offer.summary.expectedAt) : '',
  }));
  const [error, setError] = useState<unknown>(),
    [reading, setReading] = useState(false),
    [message, setMessage] = useState('');
  let calculation: { lines: ReturnType<typeof offerEditorLines>['lines']; total: string } | null =
    null;
  let problem = '';
  try {
    calculation = offerEditorLines(request.lines, lines);
  } catch (failure) {
    problem = failure instanceof Error ? failure.message : 'انتخاب ردیف‌ها را بررسی کنید.';
  }
  async function recapture(line: OfferEditorLine) {
    setReading(true);
    setError(undefined);
    try {
      const current = offerSkuSchema.parse(
        await api<unknown>(
          offerSkuReadPath(request.summary.id, line.listingId, line.sku.variantId),
        ),
      );
      if (
        current.variantId !== line.sku.variantId ||
        current.productId !==
          request.lines.find((item) => item.listingId === line.listingId)?.model.id
      )
        throw new Error('SKU جاری به همان مدل تعلق ندارد.');
      setLines((old) =>
        old.map((item) => (item.lineId === line.lineId ? { ...item, sku: current } : item)),
      );
      setMessage(
        'مشخصات جاری این SKU دریافت شد؛ گارانتی و گزینه‌ها را پیش از ذخیره دوباره بررسی کنید. قیمت پیشنهادی تغییر نکرد.',
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setReading(false);
    }
  }
  async function submit() {
    setError(undefined);
    try {
      const commandId = crypto.randomUUID();
      const selected = offerEditorLines(request.lines, lines);
      const body = offerSaveSchema.parse({
        requestId: commandId,
        requestVersion,
        version: initial?.offer.summary.version ?? null,
        lines: selected.lines,
        termsFa: fields.termsFa,
        termsEn: fields.termsEn,
        acceptUntil: utcFromInput(fields.accept),
        purchaseUntil: utcFromInput(fields.purchase),
        expectedAt: fields.expected ? utcFromInput(fields.expected) : null,
      });
      if (new TextEncoder().encode(JSON.stringify(body)).length > 65536)
        throw new Error(
          'حجم فرمان از ۶۴ کیلوبایت بیشتر است؛ متن شرایط یا تعداد ردیف‌ها را کاهش دهید.',
        );
      await onSend({
        id: commandId,
        kind: 'save',
        requestId: request.summary.id,
        offerId,
        body,
        phase: 'pending',
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? new Error(
              failure.message.startsWith('[')
                ? 'شرایط، مبلغ و مهلت‌های UTC را بررسی کنید؛ پایان اعتبار خرید نباید قبل از پایان پذیرش باشد.'
                : failure.message,
            )
          : failure,
      );
    }
  }
  return (
    <section className="offer-editor">
      <h4>{initial ? 'ویرایش پیش‌نویس خصوصی' : 'پیشنهاد تازهٔ خصوصی'}</h4>
      <p>
        شناسهٔ ثابت پیشنهاد: <bdi>{offerId}</bdi>
      </p>
      <p className="notice">
        قیمت هر واحد را صریح به ریال وارد کنید؛ قیمت مرجع یا عمومی خودکار کپی نمی‌شود. مهلت‌ها در
        فرم زیر UTC هستند. ذخیرهٔ پیش‌نویس، آن را منتشر نمی‌کند.
      </p>
      <ErrorBox error={error} />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <fieldset disabled={locked || reading}>
        <legend>نگاشت مدل‌ها به SKU واقعی</legend>
        {request.lines.map((line) => {
          const sum = lines
            .filter((row) => row.listingId === line.listingId)
            .reduce(
              (count, row) => count + (/^\d+$/.test(row.quantity) ? Number(row.quantity) : 0),
              0,
            );
          return (
            <p key={line.listingId}>
              {line.model.nameFa}: درخواست {line.quantity.toLocaleString('fa-IR')} · انتخاب فعلی{' '}
              {sum.toLocaleString('fa-IR')}
              {line.configuration && (
                <strong className="sourcing-requested-choice">
                  رم {line.configuration.ramGb.toLocaleString('fa-IR')} / حافظه{' '}
                  {line.configuration.storageGb.toLocaleString('fa-IR')} گیگابایت ·{' '}
                  {line.configuration.colorNameFa}
                </strong>
              )}
            </p>
          );
        })}
        <SkuPicker
          request={request}
          disabled={locked || reading || lines.length >= 64}
          onAdd={(listingId, sku) => {
            if (
              lines.some(
                (line) => line.listingId === listingId && line.sku.variantId === sku.variantId,
              )
            ) {
              setError(new Error('این SKU برای همین مدل قبلاً اضافه شده است.'));
              return;
            }
            const wanted = request.lines.find((line) => line.listingId === listingId)!.quantity;
            const assigned = lines
              .filter((line) => line.listingId === listingId)
              .reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
            setLines((old) => [
              ...old,
              {
                lineId: id(),
                listingId,
                sku,
                quantity: String(Math.max(1, wanted - assigned)),
                price: '',
              },
            ]);
            setMessage('SKU واقعی اضافه شد؛ مبلغ پیشنهادی هر واحد را صریح وارد کنید.');
          }}
        />
        {lines.map((line) => (
          <article className="sourcing-request-line" key={line.lineId}>
            <h4>
              {line.sku.model.nameFa} · {line.sku.labelFa}
            </h4>
            <p>
              <bdi>{line.sku.sku}</bdi>
            </p>
            <div className="form-grid">
              <Field label="تعداد این SKU">
                <input
                  inputMode="numeric"
                  maxLength={7}
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((old) =>
                      old.map((item) =>
                        item.lineId === line.lineId ? { ...item, quantity: e.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="قیمت پیشنهادی هر واحد — ریال صحیح">
                <input
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={19}
                  placeholder="مبلغ را وارد کنید"
                  value={line.price}
                  onChange={(e) =>
                    setLines((old) =>
                      old.map((item) =>
                        item.lineId === line.lineId ? { ...item, price: e.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <SkuSnapshot sku={line.sku} />
            <div className="row-buttons">
              <button type="button" onClick={() => void recapture(line)}>
                دریافت مشخصات جاری برای بازبینی
              </button>
              <button
                type="button"
                onClick={() => setLines((old) => old.filter((item) => item.lineId !== line.lineId))}
              >
                حذف این ردیف از پیش‌نویس
              </button>
            </div>
          </article>
        ))}
      </fieldset>
      <fieldset disabled={locked || reading}>
        <legend>شرایط و مهلت صریح</legend>
        <div className="form-grid">
          <Field label="شرایط فارسی">
            <textarea
              maxLength={4000}
              value={fields.termsFa}
              onChange={(e) => setFields({ ...fields, termsFa: e.target.value })}
              required
            />
          </Field>
          <Field label="English terms">
            <textarea
              dir="ltr"
              lang="en"
              maxLength={4000}
              value={fields.termsEn}
              onChange={(e) => setFields({ ...fields, termsEn: e.target.value })}
              required
            />
          </Field>
          <div className="field">
            <PersianDateField
              label="پایان مهلت پذیرش — UTC"
              encoding="utc"
              value={fields.accept}
              onChange={(next) => setFields({ ...fields, accept: next })}
              required
            />
          </div>
          <div className="field">
            <PersianDateField
              label="پایان اعتبار خرید آینده — UTC"
              encoding="utc"
              value={fields.purchase}
              onChange={(next) => setFields({ ...fields, purchase: next })}
              required
            />
          </div>
          <div className="field">
            <PersianDateField
              label="زمان احتمالی تأمین — UTC، اختیاری"
              encoding="utc"
              value={fields.expected}
              onChange={(next) => setFields({ ...fields, expected: next })}
            />
          </div>
        </div>
      </fieldset>
      {calculation ? (
        <p>
          <strong>جمع اقلام پیشنهادی: {money(calculation.total)}</strong> · حمل و مالیات در این جمع
          محاسبه نشده‌اند.
        </p>
      ) : (
        <p className="notice">{problem}</p>
      )}
      <div className="row-buttons">
        <button
          type="button"
          className="primary"
          disabled={
            locked ||
            reading ||
            !calculation ||
            !fields.termsFa.trim() ||
            !fields.termsEn.trim() ||
            !fields.accept ||
            !fields.purchase
          }
          onClick={() => void submit()}
        >
          ذخیرهٔ پیش‌نویس خصوصی
        </button>
        <button type="button" disabled={locked || reading} onClick={onCancel}>
          بازگشت بدون ذخیرهٔ فرم
        </button>
      </div>
    </section>
  );
}

function SkuPicker({
  request,
  disabled,
  onAdd,
}: {
  request: SourcingAdminDetail;
  disabled: boolean;
  onAdd: (listingId: string, sku: OfferSku) => void;
}) {
  const [listing, setListing] = useState(request.lines[0].listingId),
    [input, setInput] = useState(''),
    [query, setQuery] = useState(''),
    [reading, setReading] = useState(false),
    [error, setError] = useState<unknown>();
  const choices = useInfiniteQuery({
    queryKey: ['admin', 'sourcing-offer-skus', request.summary.id, listing, query],
    queryFn: async ({ pageParam }) =>
      offerSkuPageSchema.parse(
        await api<unknown>(offerSkuLookupPath(request.summary.id, listing, query, pageParam)),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !disabled,
    refetchOnWindowFocus: false,
  });
  const items = Array.from(
      new Map(
        choices.data?.pages.flatMap((p) => p.items).map((item) => [item.variantId, item]) ?? [],
      ).values(),
    ),
    selectedLine = request.lines.find((line) => line.listingId === listing);
  async function choose(variantId: string) {
    setReading(true);
    setError(undefined);
    try {
      const sku = offerSkuSchema.parse(
        await api<unknown>(offerSkuReadPath(request.summary.id, listing, variantId)),
      );
      if (
        sku.variantId !== variantId ||
        sku.productId !== request.lines.find((line) => line.listingId === listing)?.model.id
      )
        throw new Error('SKU با مدل درخواست مطابقت ندارد.');
      onAdd(listing, sku);
    } catch (failure) {
      setError(failure);
    } finally {
      setReading(false);
    }
  }
  return (
    <div className="offer-sku-picker">
      <div className="form-grid">
        <Field label="مدل درخواست برای انتخاب SKU">
          <select
            disabled={disabled || reading}
            value={listing}
            onChange={(e) => {
              setListing(e.target.value);
              setInput('');
              setQuery('');
            }}
          >
            {request.lines.map((line) => (
              <option key={line.listingId} value={line.listingId}>
                {line.model.nameFa}
              </option>
            ))}
          </select>
        </Field>
        <Field label="جست‌وجوی SKU یا نام پیکربندی">
          <input
            disabled={disabled || reading}
            maxLength={120}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </Field>
        <button
          type="button"
          disabled={disabled || reading || choices.isFetching}
          onClick={() => setQuery(input.trim())}
        >
          جست‌وجوی SKUهای همین مدل
        </button>
      </div>
      {selectedLine?.configuration && (
        <p className="notice">
          انتخاب مشتری: رم {selectedLine.configuration.ramGb.toLocaleString('fa-IR')} / حافظه{' '}
          {selectedLine.configuration.storageGb.toLocaleString('fa-IR')} گیگابایت ·{' '}
          {selectedLine.configuration.colorNameFa}. عنوان SKU به‌تنهایی کافی نیست؛ ویژگی‌های
          ثبت‌شدهٔ آن را بازبینی کنید.
        </p>
      )}
      <ErrorBox error={error ?? choices.error} />
      {choices.isPending && !disabled ? (
        <Busy />
      ) : (
        <ul className="offer-sku-choices">
          {items.map((item) => (
            <li key={item.variantId}>
              <div>
                <strong>
                  <bdi>{item.sku}</bdi> · {item.labelFa}
                </strong>
                <small>
                  {item.colorNameFa} · {item.warrantyFa || 'گارانتی تعیین نشده'} · قیمت عمومی{' '}
                  {money(item.publicPriceRial)}
                </small>
              </div>
              <button
                type="button"
                disabled={disabled || reading}
                onClick={() => void choose(item.variantId)}
              >
                افزودن SKU و بازبینی مشخصات
              </button>
            </li>
          ))}
          {!items.length && !choices.isPending && (
            <li className="offer-sku-guidance">
              <strong>SKU عمومی و فعال برای این مدل پیدا نشد.</strong>
              <p>
                در منوی «کالاها و تنوع‌ها»، نام همین مدل را جست‌وجو کنید، «ویرایش کالا» و سپس
                «افزودن تنوع» را بزنید. مدل جدید و تکراری نسازید.
              </p>
              <p>
                SKU واقعی را با رم، حافظه و رنگ انتخاب‌شدهٔ مشتری، قیمت صحیح ریالی، روش خرید و وضعیت
                انتشار ثبت کنید. رم و حافظه باید از ویژگی‌های نوع‌دار همان دسته باشند؛ اگر در فرم
                تنوع نیستند، مدیر کاتالوگ «محور تنوع» آن‌ها را در دسته‌بندی فعال کند.
              </p>
              <p>
                پس از ذخیره، این درخواست را تازه‌سازی و SKU را دوباره جست‌وجو کنید. پیشنهاد تأمین به
                موجودی مثبت نیاز ندارد؛ موجودی واقعی فقط از مسیر انبار ثبت می‌شود و قیمت پیشنهادی را
                مدیر مالی جدا وارد می‌کند.
              </p>
            </li>
          )}
        </ul>
      )}
      {choices.hasNextPage && (
        <button
          type="button"
          disabled={disabled || reading || choices.isFetchingNextPage}
          onClick={() => void choices.fetchNextPage()}
        >
          ۲۰ SKU بعدی همین مدل
        </button>
      )}
    </div>
  );
}

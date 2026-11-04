import { AdminFilterForm } from '../../components/filters/admin-filters';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api, save, ApiError } from '../../api/api';
import {
  adminReviewPage,
  moderateReviewInput,
  type AdminReview,
} from '../../api/contracts/reviews/reviews-contract';
import { reviewProductId, reviewResult } from '@sayman/web-shared/lib/reviews/reviews-contract.ts';
import { Busy, ErrorBox, Field, Modal } from '../../components/ui';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { Flag, Image as ImageIcon, MessageSquare, RefreshCw, Search, Star } from 'lucide-react';
import { date } from '../../features/customers/customer-ui';
import '../../styles/customers/customer-service-workspace.css';
import '../../styles/reviews/review-admin.css';
const names = {
  Pending: 'در انتظار بررسی',
  Approved: 'منتشرشده',
  Rejected: 'ردشده',
  Hidden: 'پنهان‌شده',
};
const stateOptions = [
  ['Pending', names.Pending],
  ['Approved', names.Approved],
  ['Rejected', names.Rejected],
  ['Hidden', names.Hidden],
  ['', 'همهٔ دیدگاه‌ها'],
] as const;

const commandStates = {
  Approve: 'Approved',
  Reject: 'Rejected',
  Hide: 'Hidden',
  Reply: 'Approved',
} as const;
type Command = {
  id: string;
  reviewId: string;
  input: ReturnType<typeof moderateReviewInput.parse>;
};
export function ReviewsPage({ writable, viewerId }: { writable: boolean; viewerId: string }) {
  const [state, setState] = useState('Pending'),
    [selected, setSelected] = useState<AdminReview | null>(null),
    [productDraft, setProductDraft] = useState(''),
    [productId, setProductId] = useState(''),
    [search, setSearch] = useState(''),
    [reported, setReported] = useState(false),
    [filterError, setFilterError] = useState<Error | undefined>();
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['admin', 'reviews', viewerId, state, productId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const p = new URLSearchParams();
      if (state) p.set('state', state);
      if (productId) p.set('productId', productId);
      if (pageParam) p.set('cursor', pageParam);
      const page = adminReviewPage.parse(
        await api('/admin/reviews' + (p.size ? '?' + p : ''), { signal }),
      );
      if (
        page.items.some(
          (row) => (state && row.state !== state) || (productId && row.productId !== productId),
        )
      )
        throw new Error('نتیجه با فیلتر دیدگاه‌ها هم‌خوان نیست.');
      return page;
    },
    gcTime: 0,
    retry: false,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = Array.from(
    new Map((query.data?.pages.flatMap((p) => p.items) ?? []).map((r) => [r.id, r])).values(),
  );
  const normalize = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase('fa-IR')
      .replaceAll('ي', 'ی')
      .replaceAll('ك', 'ک')
      .replaceAll('‌', ' ');
  const terms = normalize(search).split(/\s+/).filter(Boolean);
  const visibleRows = rows.filter((r) => {
    const value = normalize(
      `${r.content.title} ${r.content.body} ${r.content.displayName} ${r.productId}`,
    );
    return (!reported || r.reportCount > 0) && terms.every((term) => value.includes(term));
  });
  function filterProduct(value: string) {
    const clean = value.trim();
    if (clean && !reviewProductId.safeParse(clean).success) {
      setFilterError(new Error('شناسهٔ کالا را با حروف لاتین، عدد، خط تیره یا زیرخط وارد کنید.'));
      return;
    }
    setFilterError(undefined);
    setProductDraft(clean);
    setProductId(clean);
  }
  return (
    <>
      <section className="panel service-workspace review-workspace">
        <div className="section-heading service-workspace-header">
          <div>
            <span className="service-eyebrow">
              <MessageSquare size={16} aria-hidden="true" /> بازخورد مشتری
            </span>
            <h2>دیدگاه‌های مشتریان</h2>
            <p>دیدگاه‌های تازه و گزارش‌شده را بررسی کنید و به دیدگاه منتشرشده پاسخ عمومی بدهید.</p>
          </div>
          <button
            className="service-action"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={16} aria-hidden="true" />
            تازه‌سازی
          </button>
        </div>
        <div
          className="service-view-switch review-queue-tabs"
          role="group"
          aria-label="صف دیدگاه‌ها"
        >
          {stateOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={state === value}
              onClick={() => setState(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="review-queue-tools">
          <label className="review-search">
            <span>جست‌وجو در دیدگاه‌های دریافت‌شده</span>
            <span>
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={search}
                maxLength={120}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="عنوان، نام یا شناسهٔ کالا"
              />
            </span>
          </label>
          <label className="review-reports-only">
            <input
              type="checkbox"
              checked={reported}
              onChange={(e) => setReported(e.target.checked)}
            />{' '}
            فقط گزارش‌دار
          </label>
          <details className="review-product-filter">
            <summary>{productId ? 'فیلتر کالا فعال است' : 'فیلتر بر اساس کالا'}</summary>
            <AdminFilterForm
              label="فیلتر همهٔ دیدگاه‌ها بر اساس کالا"
              live={false}
              onSubmit={(event) => {
                event.preventDefault();
                filterProduct(productDraft);
              }}
              search={
                <Field label="شناسهٔ دقیق کالا">
                  <input
                    type="search"
                    dir="ltr"
                    maxLength={64}
                    value={productDraft}
                    onChange={(event) => setProductDraft(event.target.value)}
                  />
                </Field>
              }
              actions={
                <>
                  <button className="primary" type="submit">
                    اعمال فیلتر
                  </button>
                  {(productDraft || productId) && (
                    <button type="button" onClick={() => filterProduct('')}>
                      پاک‌کردن
                    </button>
                  )}
                </>
              }
              applied={productId ? ['کالا ' + productId] : []}
            />
          </details>
        </div>
        <ErrorBox error={filterError} />
        <ErrorBox error={query.error} />
        {query.isPending ? (
          <Busy />
        ) : !rows.length && !query.error ? (
          <div className="admin-empty-state">
            <MessageSquare size={26} aria-hidden="true" />
            <strong>دیدگاهی در این صف نیست</strong>
            <p>
              {productId
                ? 'این کالا در وضعیت انتخاب‌شده دیدگاهی ندارد.'
                : 'برای دیدن سابقه می‌توانید وضعیت دیگری را انتخاب کنید.'}
            </p>
            {productId && (
              <button type="button" onClick={() => filterProduct('')}>
                نمایش دیدگاه‌های همهٔ کالاها
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="service-result-summary" role="status">
              {visibleRows.length.toLocaleString('fa-IR')} از {rows.length.toLocaleString('fa-IR')}{' '}
              دیدگاه دریافت‌شده
              {rows.some((row) => row.reportCount > 0) &&
                ` · ${rows.filter((row) => row.reportCount > 0).length.toLocaleString('fa-IR')} دارای گزارش`}
            </p>
            {!visibleRows.length && !query.error && (
              <div className="admin-empty-state">
                <Search size={24} aria-hidden="true" />
                <strong>نتیجه‌ای در دیدگاه‌های دریافت‌شده نیست</strong>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setReported(false);
                  }}
                >
                  پاک‌کردن جست‌وجو و گزارش‌دار
                </button>
              </div>
            )}
            <ul className="review-queue" aria-label="دیدگاه‌های مشتریان">
              {visibleRows.map((r) => (
                <li key={r.id} className="review-queue-item" data-reported={r.reportCount > 0}>
                  <div className="review-queue-copy">
                    <div className="review-queue-flags">
                      <span className="service-state" data-state={r.state}>
                        {names[r.state]}
                      </span>
                      {r.isDemo && <span className="review-queue-badge">نمونهٔ آموزشی</span>}
                      {r.reportCount > 0 && (
                        <span className="service-state" data-state="Reported">
                          <Flag size={13} aria-hidden="true" />
                          {r.reportCount.toLocaleString('fa-IR')} گزارش
                        </span>
                      )}
                      {r.hasPhoto && (
                        <span className="review-queue-badge">
                          <ImageIcon size={14} aria-hidden="true" /> عکس دارد
                        </span>
                      )}
                    </div>
                    <h3 dir="auto">{r.content.title}</h3>
                    <p className="service-review-preview" dir="auto">
                      {r.content.body}
                    </p>
                    <div className="review-queue-meta">
                      <bdi>{r.content.displayName}</bdi>
                      <time dateTime={r.content.at}>{date(r.content.at)}</time>
                      <span>{r.content.locale === 'fa' ? 'فارسی' : 'انگلیسی'}</span>
                      <button
                        type="button"
                        className="service-inline-action"
                        onClick={() => filterProduct(r.productId)}
                        aria-label={'فیلتر دیدگاه‌های کالای ' + r.productId}
                      >
                        کالا: <bdi>{r.productId}</bdi>
                      </button>
                    </div>
                  </div>
                  <div className="review-queue-action">
                    <Rating rating={r.content.rating} />
                    <button onClick={() => setSelected(r)}>
                      {writable && (r.state === 'Approved' || r.state === 'Pending')
                        ? 'بررسی دیدگاه'
                        : 'جزئیات دیدگاه'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {query.hasNextPage && (
          <button
            className="service-more"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            دیدگاه‌های بیشتر
          </button>
        )}
      </section>
      {selected && (
        <Moderation
          key={`${selected.id}:${selected.version}:${viewerId}`}
          row={selected}
          writable={writable}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void client.invalidateQueries({ queryKey: ['admin', 'reviews'] });
          }}
        />
      )}
    </>
  );
}
function Rating({ rating }: { rating: number }) {
  return (
    <span
      className="review-admin-stars"
      role="img"
      aria-label={`${rating.toLocaleString('fa-IR')} از ۵ ستاره`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={16} aria-hidden="true" data-filled={n <= rating} />
      ))}
    </span>
  );
}

function StaffPhoto({ id, revision }: { id: string; revision: string }) {
  const [attempt, setAttempt] = useState(0);
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    const authority = adminViewRevision();
    let url = '';
    void api<Blob>(`/admin/reviews/${id}/photos/${revision}`, { signal: controller.signal }, 'blob')
      .then((photo) => {
        if (controller.signal.aborted || adminViewRevision() !== authority) return;
        if (photo.type !== 'image/webp' || !photo.size) throw new Error('invalid photo');
        url = URL.createObjectURL(photo);
        setSrc(url);
      })
      .catch(() => {
        if (!controller.signal.aborted && adminViewRevision() === authority) setError(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [attempt, id, revision]);
  return (
    <div className="review-staff-photo">
      {src ? (
        <img src={src} alt="عکس پیوست این نسخهٔ دیدگاه" />
      ) : attempt && !error ? (
        <span role="status">در حال دریافت عکس…</span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(false);
            setAttempt((n) => n + 1);
          }}
        >
          <ImageIcon size={16} aria-hidden="true" />
          {error ? 'عکس دریافت نشد؛ تلاش دوباره' : 'مشاهدهٔ عکس پیوست'}
        </button>
      )}
    </div>
  );
}

function Moderation({
  row,
  writable,
  onClose,
  onSaved,
}: {
  row: AdminReview;
  writable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState(''),
    [reply, setReply] = useState(row.reply ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false);
  const pending = useRef<Command | null>(null);
  const inFlight = useRef(false);
  async function run(command: Command) {
    if (!writable || inFlight.current) return;
    inFlight.current = true;
    pending.current = command;
    setBusy(true);
    setError(null);
    const authority = adminViewRevision();
    try {
      const result = reviewResult.parse(
        await save(
          `/admin/reviews/${command.reviewId}/commands/${command.id}`,
          command.input,
          'PUT',
        ),
      );
      if (adminViewRevision() !== authority) return;
      if (
        !result.review ||
        result.reported ||
        result.review.id !== row.id ||
        result.review.productId !== row.productId ||
        result.review.content.revisionId !== command.input.revisionId ||
        result.review.state !== commandStates[command.input.action]
      )
        throw new Error('پاسخ دیدگاه با درخواست هم‌خوان نیست.');
      pending.current = null;
      setUncertain(false);
      onSaved();
    } catch (e) {
      if (adminViewRevision() !== authority) return;
      setError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        pending.current = null;
        setUncertain(false);
        setConflict([401, 403, 404, 409].includes(e.status));
      } else setUncertain(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function command(action: 'Approve' | 'Reject' | 'Hide' | 'Reply') {
    if (!writable || uncertain || conflict || inFlight.current) return;
    if (action === 'Reply' && reply.trim() === row.reply) return;
    try {
      const input = moderateReviewInput.parse({
        version: row.version,
        revisionId: row.content.revisionId,
        action,
        reason: reason.trim(),
        reply: action === 'Reply' ? reply.trim() : null,
      });
      void run({ id: crypto.randomUUID().replaceAll('-', ''), reviewId: row.id, input });
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Modal title="بررسی نسخهٔ دیدگاه" onClose={onClose} preventClose={busy || uncertain}>
      <article className="service-review-detail">
        <span className="service-state" data-state={row.state}>
          {names[row.state]}
        </span>
        {row.isDemo && <span className="review-queue-badge">نمونهٔ آموزشی</span>}
        <h3 dir="auto">{row.content.title}</h3>
        <Rating rating={row.content.rating} />
        <p dir="auto" className="review-admin-body">
          {row.content.body}
        </p>
        <p>
          <bdi>{row.content.displayName}</bdi> · {row.reportCount.toLocaleString('fa-IR')} گزارش ·{' '}
          {date(row.content.at)}
        </p>
        <p>
          شناسهٔ کالا <bdi>{row.productId}</bdi>
        </p>
        {row.hasPhoto && <StaffPhoto id={row.id} revision={row.content.revisionId} />}
        {row.reply && !writable && (
          <p>
            <strong>پاسخ عمومی فروشگاه</strong> {row.reply}
          </p>
        )}
      </article>
      <ErrorBox error={error} />
      {uncertain && (
        <div className="notice" role="status">
          <p>نتیجهٔ درخواست دریافت نشد؛ تلاش دوباره دقیقاً همان شناسه، نسخه و بدنه را می‌فرستد.</p>
          <button
            disabled={busy}
            onClick={() => {
              if (pending.current) void run(pending.current);
            }}
          >
            پیگیری همان درخواست
          </button>
          <button
            disabled={busy}
            onClick={() => {
              pending.current = null;
              setUncertain(false);
              onSaved();
            }}
          >
            دریافت صف تازه و بررسی نتیجه
          </button>
        </div>
      )}
      {conflict && (
        <div className="notice">
          <p>وضعیت یا مجوز تغییر کرده است. صف را دوباره دریافت کنید.</p>
          <button type="button" onClick={onSaved}>
            بازگشت به صف تازه
          </button>
        </div>
      )}
      {!writable && <p className="notice">دسترسی شما برای مشاهدهٔ دیدگاه است.</p>}
      {writable && (row.state === 'Pending' || row.state === 'Approved') && (
        <fieldset className="service-review-actions" disabled={busy || uncertain || conflict}>
          <Field label="یادداشت داخلی بررسی؛ برای رد یا پنهان‌کردن حداقل ۵ نویسه">
            <textarea maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {row.state === 'Approved' && (
            <Field label="پاسخ عمومی فروشگاه">
              <textarea maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} />
            </Field>
          )}
          <div className="row-buttons">
            {row.state === 'Pending' && (
              <>
                <button className="primary" onClick={() => command('Approve')}>
                  تأیید و انتشار
                </button>
                <button disabled={reason.trim().length < 5} onClick={() => command('Reject')}>
                  رد دیدگاه
                </button>
              </>
            )}
            {row.state === 'Approved' && (
              <>
                <button
                  className="primary"
                  disabled={!reply.trim() || reply.trim() === row.reply}
                  onClick={() => command('Reply')}
                >
                  ثبت پاسخ عمومی
                </button>
                <button disabled={reason.trim().length < 5} onClick={() => command('Hide')}>
                  پنهان‌کردن دیدگاه
                </button>
              </>
            )}
          </div>
        </fieldset>
      )}
    </Modal>
  );
}

import { AdminTable } from './admin-table';
import { AdminFilters } from './admin-filters';
import { useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api, save, ApiError } from './api';
import { adminReviewPage, moderateReviewInput, type AdminReview } from './reviews-contract';
import { reviewResult } from '../../storefront/lib/reviews-contract';
import { Busy, ErrorBox, Field, Modal } from './ui';
import { adminViewRevision } from './admin-view-authority';
const names = {
  Pending: 'در انتظار بررسی',
  Approved: 'منتشرشده',
  Rejected: 'ردشده',
  Hidden: 'پنهان‌شده',
};
type Command = {
  id: string;
  reviewId: string;
  input: ReturnType<typeof moderateReviewInput.parse>;
};
export function ReviewsPage({ writable, viewerId }: { writable: boolean; viewerId: string }) {
  const [state, setState] = useState('Pending'),
    [selected, setSelected] = useState<AdminReview | null>(null);
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['admin', 'reviews', viewerId, state],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams();
      if (state) p.set('state', state);
      if (pageParam) p.set('cursor', pageParam);
      return adminReviewPage.parse(await api('/admin/reviews?' + p));
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = Array.from(
    new Map((query.data?.pages.flatMap((p) => p.items) ?? []).map((r) => [r.id, r])).values(),
  );
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>بررسی دیدگاه‌های مشتریان</h2>
          <button onClick={() => void query.refetch()} disabled={query.isFetching}>
            تازه‌سازی
          </button>
        </div>
        <p className="notice">
          ثبت و ویرایش مشتری ابتدا به صف بررسی می‌آید. نشان خریدار از سفارش پرداخت‌شده یا تحویل‌شدهٔ
          غیرنمونه خوانده می‌شود و در این پنل قابل ساختن نیست. پاسخ شما به همین نسخهٔ نظر متصل
          می‌ماند.
        </p>
        <AdminFilters
          label="فیلتر دیدگاه‌ها"
          primary={
            <Field label="وضعیت">
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setSelected(null);
                }}
              >
                <option value="">همه</option>
                {Object.entries(names).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          }
          applied={
            state ? [Object.entries(names).find(([key]) => key === state)?.[1] ?? state] : []
          }
        />
        <ErrorBox error={query.error} />
        {query.isPending ? (
          <Busy />
        ) : !rows.length && !query.error ? (
          <p>دیدگاهی با این وضعیت ثبت نشده است.</p>
        ) : (
          <AdminTable aria-label="جدول دیدگاه‌های مشتریان">
            <thead>
              <tr>
                <th>عنوان و متن</th>
                <th>وضعیت</th>
                <th>امتیاز</th>
                <th>گزارش‌ها</th>
                <th>نویسنده</th>
                <th>ثبت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong dir="auto">{r.content.title}</strong>
                    <p className="admin-record-description" dir="auto">
                      {r.content.body}
                    </p>
                    <small>
                      <bdi>{r.productId}</bdi>
                    </small>
                  </td>
                  <td>{names[r.state]}</td>
                  <td data-sort-value={r.content.rating}>
                    {r.content.rating.toLocaleString('fa-IR')} از ۵
                  </td>
                  <td data-sort-value={r.reportCount}>{r.reportCount.toLocaleString('fa-IR')}</td>
                  <td>
                    {r.content.displayName}
                    <small>{r.content.locale}</small>
                  </td>
                  <td data-sort-value={r.content.at}>
                    {new Intl.DateTimeFormat('fa-IR', {
                      dateStyle: 'medium',
                      timeZone: 'Asia/Tehran',
                    }).format(new Date(r.content.at))}
                  </td>
                  <td>
                    <button onClick={() => setSelected(r)}>بررسی و پاسخ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
        {query.hasNextPage && (
          <button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
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
  async function run(command: Command) {
    if (busy) return;
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
      if (!result.review || result.review.id !== row.id || result.reported)
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
        setConflict(true);
      } else setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  function command(action: 'Approve' | 'Reject' | 'Hide' | 'Reply') {
    if (uncertain || conflict || busy) return;
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
      <article>
        <h3 dir="auto">{row.content.title}</h3>
        <p dir="auto" className="review-admin-body">
          {row.content.body}
        </p>
        <p>
          {row.content.displayName} · {row.content.rating} از ۵ · {names[row.state]} ·{' '}
          {row.reportCount} گزارش
        </p>
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
        <p className="notice">
          وضعیت یا مجوز تغییر کرده است. پنجره را ببندید و صف تازه را دریافت کنید.
        </p>
      )}
      <fieldset disabled={!writable || busy || uncertain || conflict}>
        <Field label="دلیل بررسی؛ برای رد یا پنهان‌کردن حداقل ۵ نویسه">
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
              <button className="primary" disabled={!reply.trim()} onClick={() => command('Reply')}>
                ثبت پاسخ عمومی
              </button>
              <button disabled={reason.trim().length < 5} onClick={() => command('Hide')}>
                پنهان‌کردن دیدگاه
              </button>
            </>
          )}
        </div>
      </fieldset>
    </Modal>
  );
}

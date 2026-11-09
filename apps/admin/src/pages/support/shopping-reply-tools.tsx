import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  readProductQuestion,
  staffProductQuestion,
} from '@sayman/web-shared/lib/support/product-questions.ts';
import type { TicketProductSuggestion } from '@sayman/web-shared/components/support/ticket-workspace';
import {
  readTicketResult,
  type TicketCommand,
  type TicketMessage,
  type TicketSummary,
} from '@sayman/web-shared/lib/support/ticket-contract.ts';
import { api, ApiError } from '../../api/api';
import { ErrorBox, Field } from '../../components/ui';
import { ProductPicker } from '../../features/catalog/product-picker';

export function SuggestedProduct({
  selected,
  onSelect,
  disabled,
}: {
  selected: TicketProductSuggestion | null;
  onSelect: (product: TicketProductSuggestion | null) => void;
  disabled: boolean;
}) {
  return (
    <section className="ticket-product-tool">
      <h3>معرفی کالا در پاسخ</h3>
      <p>
        یک کالای منتشرشده را انتخاب کنید تا دکمهٔ دیدن کالا همراه پیامتان برای مشتری فرستاده شود.
      </p>
      {selected ? (
        <div className="row-buttons">
          <strong>پیش‌نمایش دکمه · دیدن {selected.label}</strong>
          <button type="button" disabled={disabled} onClick={() => onSelect(null)}>
            حذف پیشنهاد
          </button>
        </div>
      ) : (
        <p className="muted">
          نمونه برای مشتری · «این آیفون ۱۶ موجود است.» همراه دکمهٔ «دیدن کالای پیشنهادی»
        </p>
      )}
      <ProductPicker
        value={[]}
        onChange={() => {}}
        publishedOnly
        disabled={disabled}
        label={selected ? 'انتخاب کالای دیگر' : 'انتخاب کالا برای معرفی'}
        onPickProduct={(product) =>
          onSelect({ slug: product.slug, label: product.nameFa || product.nameEn || product.slug })
        }
      />
    </section>
  );
}

export function PublicQuestionReply({
  ticket,
  first,
  refresh,
  viewerId,
}: {
  ticket: TicketSummary;
  first: TicketMessage;
  refresh: () => void;
  viewerId: string;
}) {
  const source = first.author === 'customer' ? readProductQuestion(first.body) : null;
  const path = `/admin/support/tickets/${ticket.id}`;
  const discussion = useQuery({
    queryKey: ['admin', 'product-question-thread', viewerId, ticket.id],
    enabled: source !== null,
    queryFn: async ({ signal }) =>
      staffProductQuestion.parse(await api<unknown>(path + '/public-thread', { signal })),
    refetchInterval: 10000,
  });
  const [expanded, expand] = useState(false);
  const [question, setQuestion] = useState(() => source?.question.slice(0, 240) ?? '');
  const [answer, setAnswer] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>();
  const attempt = useRef<{ command: TicketCommand & { kind: 'reply' }; question: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(false);
  const thread = discussion.data?.thread;
  const publicQuestion = thread?.question.question ?? question;
  if (!source) return null;

  async function publish() {
    if (busy || (!retry && (!confirmed || !publicQuestion.trim() || (thread && !answer.trim()))))
      return;
    const current = attempt.current ?? {
      command: {
        id: crypto.randomUUID().replaceAll('-', ''),
        kind: 'reply',
        staff: true,
        ticketId: ticket.id,
        body: {
          version: ticket.version,
          body: ticket.state === 'Closed' ? '' : answer.trim(),
          locale: ticket.locale,
        },
      } as const,
      question: publicQuestion.trim(),
    };
    attempt.current = current;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await api<unknown>(path + '/public-answer/' + current.command.id, {
        method: 'POST',
        body: JSON.stringify({
          version: current.command.body.version,
          question: current.question,
          answer: current.command.body.body,
          confirmed: true,
        }),
      });
      if (current.command.body.body) readTicketResult(result, current.command);
      attempt.current = null;
      setRetry(false);
      setMessage(
        current.command.body.body ? 'پاسخ به گفتگو اضافه شد.' : 'پرسش در صفحهٔ کالا منتشر شد.',
      );
      setAnswer('');
      setConfirmed(false);
      expand(false);
      void discussion.refetch();
      refresh();
    } catch (failure) {
      const known =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 429;
      if (known) attempt.current = null;
      setRetry(!known);
      setError(known ? failure : new Error('نتیجه مشخص نشد. همان انتشار را دوباره پیگیری کنید.'));
      if (known) void discussion.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function moderate(replyId: string, publish: boolean) {
    if (busy || retry) return;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      await api(path + '/public-thread/replies/' + replyId, {
        method: 'PUT',
        body: JSON.stringify({ publish }),
      });
      setMessage(publish ? 'پیام در همان گفتگو منتشر شد.' : 'پیام از نمایش عمومی کنار گذاشته شد.');
      await discussion.refetch();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const canWrite = discussion.isSuccess && (!thread || ticket.state !== 'Closed');
  const threadError = discussion.error;
  return (
    <section className="ticket-product-tool ticket-public-thread">
      <h3>گفت‌وگوی عمومی کالا</h3>
      {discussion.isPending && <p role="status">در حال دریافت گفتگو…</p>}
      {discussion.isError && (
        <>
          <p role="alert">
            {threadError instanceof ApiError && threadError.status === 404
              ? 'این پرسش به کالای منتشرشده‌ای وصل نیست.'
              : 'گفت‌وگوی عمومی دریافت نشد. دوباره تلاش کنید.'}
          </p>
          <button type="button" onClick={() => void discussion.refetch()}>
            دریافت دوبارهٔ گفتگو
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {discussion.isSuccess && !thread && <p>این پرسش هنوز در صفحهٔ کالا منتشر نشده است.</p>}
      {thread && (
        <>
          <p>
            <bdi>{thread.question.displayName || 'کاربر سایمان'}</bdi> · پرسش‌کننده
          </p>
          <p dir="auto">
            <strong>{thread.question.question}</strong>
          </p>
          {thread.replies.length === 0 && <p>هنوز پاسخی در این گفتگو ثبت نشده است.</p>}
          <ol className="ticket-public-replies">
            {thread.replies.map(({ reply, state }) => (
              <li key={reply.id}>
                <div className="row-buttons">
                  <bdi>
                    <strong>
                      {reply.byStore ? 'سایمان' : reply.displayName || 'کاربر سایمان'}
                    </strong>
                  </bdi>
                  <span>
                    {state === 'Published'
                      ? 'منتشرشده'
                      : state === 'Pending'
                        ? 'در انتظار بررسی'
                        : 'کنار گذاشته‌شده'}
                  </span>
                  <time dateTime={reply.at}>
                    {new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(
                      new Date(reply.at),
                    )}
                  </time>
                </div>
                <p dir="auto">{reply.body}</p>
                {!reply.byStore && state !== 'Rejected' && (
                  <div className="row-buttons">
                    {state === 'Pending' && (
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || retry}
                        onClick={() => void moderate(reply.id, true)}
                      >
                        انتشار پیام
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy || retry}
                      onClick={() => void moderate(reply.id, false)}
                    >
                      {state === 'Published' ? 'برداشتن از صفحهٔ کالا' : 'رد پیام'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {error !== undefined && <ErrorBox error={error} />}
      {canWrite && (
        <button
          type="button"
          aria-expanded={expanded}
          disabled={busy || retry}
          onClick={() => expand(!expanded)}
        >
          {expanded ? 'بستن فرم' : thread ? 'افزودن پاسخ فروشگاه' : 'بازبینی و انتشار پرسش'}
        </button>
      )}
      {expanded && canWrite && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <p>پیش از انتشار، متن را از نظر شماره، نشانی و اطلاعات سفارش بازبینی کنید.</p>
          <fieldset disabled={busy || retry}>
            {!thread && (
              <>
                {discussion.data?.displayName && (
                  <p>
                    پرسش‌کننده · <bdi>{discussion.data.displayName}</bdi>
                  </p>
                )}
                <Field label="متن پرسش برای انتشار">
                  <textarea
                    required
                    maxLength={240}
                    rows={3}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </Field>
              </>
            )}
            {ticket.state !== 'Closed' && (
              <Field label={thread ? 'پاسخ فروشگاه' : 'پاسخ فروشگاه، اختیاری'}>
                <textarea
                  required={!!thread}
                  maxLength={1200}
                  rows={4}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </Field>
            )}
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{' '}
              متن را برای انتشار عمومی بازبینی کردم
            </label>
          </fieldset>
          <button
            type="submit"
            className="primary"
            disabled={
              busy ||
              (!retry && (!confirmed || !publicQuestion.trim() || (!!thread && !answer.trim())))
            }
          >
            {retry
              ? 'پیگیری همان انتشار'
              : answer.trim() && ticket.state !== 'Closed'
                ? 'انتشار پاسخ فروشگاه'
                : 'انتشار پرسش بدون پاسخ'}
          </button>
        </form>
      )}
    </section>
  );
}

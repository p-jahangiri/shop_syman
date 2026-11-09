'use client';

import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowDownWideNarrow, CircleHelp, MessageCircle, PencilLine, Search } from 'lucide-react';
import Link from '@/components/navigation/localized-link';
import { useCustomerSession } from '@/components/auth/auth-provider';
import { useI18n } from '@/components/navigation/locale-provider';
import { normalizePersian } from '@sayman/web-shared/lib/shared/commerce.ts';
import { customerTicketJournal as journal } from '@sayman/web-shared/lib/support/ticket-journal.ts';
import {
  ticketCreateSchema,
  ticketCommandPath,
  type TicketCommand,
} from '@sayman/web-shared/lib/support/ticket-contract.ts';
import { ticketCommandRequest } from '@sayman/web-shared/lib/support/ticket-command-request.ts';
import { shoppingRequestContent } from '@sayman/web-shared/components/support/shopping-request-fields';
import {
  communityReplyInput,
  type ProductQuestionReply,
} from '@sayman/web-shared/lib/support/product-questions.ts';
import { Button, Modal } from '@/components/shared/ui';
import '../shared/product-community.css';

type Answer = {
  id?: string;
  question: string;
  answer: string;
  displayName?: string | null;
  publishedAt?: string;
  replies?: ProductQuestionReply[] | null;
  demo?: boolean;
};
type Locale = 'fa' | 'en';
const localized = (locale: Locale, fa: string, en: string) => (locale === 'fa' ? fa : en);
const replyCount = (row: Answer) => row.replies?.length ?? Number(!!row.answer);
const timestamp = (row: Answer) => (row.publishedAt ? Date.parse(row.publishedAt) : 0);
const formatters = {
  fa: new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }),
};

function QuestionReplies({ row, locale }: { row: Answer; locale: Locale }) {
  const text = (fa: string, en: string) => localized(locale, fa, en);
  const replies = row.replies;
  return (
    <>
      {replies?.map((reply) => (
        <div className="product-answer" key={reply.id} data-store={reply.byStore}>
          <div className="product-question-meta">
            <bdi>
              {reply.byStore
                ? text('سایمان', 'Sayman')
                : reply.displayName || text('کاربر سایمان', 'Sayman customer')}
            </bdi>
            {reply.byStore && (
              <span className="question-store-badge">{text('فروشگاه', 'Store')}</span>
            )}
            <time dateTime={reply.at}>{formatters[locale].format(new Date(reply.at))}</time>
          </div>
          <p dir="auto">{reply.body}</p>
        </div>
      ))}
      {!replies && row.answer && (
        <div className="product-answer" data-store="true">
          <div className="product-question-meta">
            <span className="question-store-badge">{text('پاسخ فروشگاه', 'Store reply')}</span>
          </div>
          <p dir="auto">{row.answer}</p>
        </div>
      )}
    </>
  );
}

export function ProductQuestionBoard({
  answers,
  productId,
  name,
  slug,
  connected,
}: {
  answers: Answer[];
  productId: string;
  name: string;
  slug: string;
  connected: boolean;
}) {
  const { locale, digits } = useI18n();
  const auth = useCustomerSession();
  const text = (fa: string, en: string) => localized(locale, fa, en);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<'newest' | 'answered'>('newest');
  const [unanswered, setUnanswered] = useState(false);
  const [limit, setLimit] = useState(8);
  const [target, setTarget] = useState<Answer | null>(null);
  const [sent, setSent] = useState<string>();
  const returnFocus = useRef<HTMLButtonElement>(null);
  const term = normalizePersian(query.trim());
  const visible = answers
    .filter(
      (row) =>
        (!unanswered || replyCount(row) === 0) &&
        normalizePersian(
          [row.question, row.answer, ...(row.replies?.map((reply) => reply.body) ?? [])].join(' '),
        ).includes(term),
    )
    .sort(
      (a, b) =>
        (order === 'answered' ? replyCount(b) - replyCount(a) : 0) || timestamp(b) - timestamp(a),
    );
  const account = '/account?returnTo=' + encodeURIComponent('/product/' + slug + '#product-tabs');
  return (
    <section className="product-question-board" aria-labelledby="product-questions">
      <h2 className="product-community-heading" id="product-questions">
        {text('پرسش‌ها و پاسخ‌ها', 'Questions and answers')}
      </h2>
      <div className="product-question-layout" data-connected={connected}>
        {connected && <QuestionComposer key={slug} name={name} slug={slug} />}
        <div className="product-question-feed">
          {answers.length > 0 && (
            <>
              <label className="product-question-search">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  aria-label={text('جست‌وجو در سؤال‌ها', 'Search questions')}
                  placeholder={text(
                    'جست‌وجو در پرسش‌ها؛ مثلاً گارانتی',
                    'Search questions, e.g. warranty',
                  )}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(8);
                  }}
                />
              </label>
              <div className="product-community-toolbar">
                <div
                  className="product-community-options"
                  aria-label={text('مرتب‌سازی پرسش‌ها', 'Sort questions')}
                  role="group"
                >
                  <ArrowDownWideNarrow size={17} aria-hidden="true" />
                  <button
                    type="button"
                    aria-pressed={order === 'newest'}
                    onClick={() => {
                      setOrder('newest');
                      setLimit(8);
                    }}
                  >
                    {text('جدیدترین', 'Newest')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={order === 'answered'}
                    onClick={() => {
                      setOrder('answered');
                      setUnanswered(false);
                      setLimit(8);
                    }}
                  >
                    {text('بیشترین پاسخ', 'Most answered')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={unanswered}
                    onClick={() => {
                      setUnanswered(!unanswered);
                      setLimit(8);
                    }}
                  >
                    {text('بی‌پاسخ', 'Unanswered')}
                  </button>
                </div>
                <small>
                  {digits(visible.length)} {text('پرسش', 'questions')}
                </small>
              </div>
            </>
          )}
          {visible.length === 0 ? (
            <div className="product-question-empty">
              <CircleHelp aria-hidden="true" />
              <p>
                {term || unanswered
                  ? text('پرسشی با این فیلتر پیدا نشد.', 'No questions match these filters.')
                  : text(
                      'هنوز پرسشی برای این کالا منتشر نشده است.',
                      'No questions have been published for this product yet.',
                    )}
              </p>
            </div>
          ) : (
            <ol className="product-question-list">
              {visible.slice(0, limit).map((row) => (
                <li key={row.id ?? row.question}>
                  <h3 dir="auto">{row.question}</h3>
                  <div className="product-question-meta">
                    <bdi>{row.displayName || text('کاربر سایمان', 'Sayman customer')}</bdi>
                    {row.publishedAt && (
                      <time dateTime={row.publishedAt}>
                        {formatters[locale].format(new Date(row.publishedAt))}
                      </time>
                    )}
                    {row.demo && (
                      <span className="tag">{text('نمونهٔ توسعه', 'Development sample')}</span>
                    )}
                  </div>
                  <QuestionReplies row={row} locale={locale} />
                  <div className="product-question-actions">
                    <span>
                      <MessageCircle size={16} aria-hidden="true" />
                      {replyCount(row)
                        ? `${digits(replyCount(row))} ${text('پاسخ', 'replies')}`
                        : text('هنوز پاسخی ندارد', 'No replies yet')}
                    </span>
                    {connected &&
                      row.id &&
                      (auth.status === 'member' ? (
                        <button
                          className="product-community-link"
                          type="button"
                          onClick={(event) => {
                            returnFocus.current = event.currentTarget;
                            setTarget(row);
                          }}
                        >
                          <PencilLine size={16} aria-hidden="true" />
                          {replyCount(row)
                            ? text('ادامهٔ گفتگو', 'Continue discussion')
                            : text('ثبت پاسخ', 'Write a reply')}
                        </button>
                      ) : (
                        <Link className="product-community-link" href={account}>
                          {text('ورود برای پاسخ', 'Sign in to reply')}
                        </Link>
                      ))}
                  </div>
                  {sent && sent === row.id && (
                    <p role="status" className="notice">
                      {text(
                        'پیام شما ثبت شد و پس از بررسی در همین گفتگو نمایش داده می‌شود.',
                        'Your message will appear in this thread after review.',
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {visible.length > limit && (
            <Button variant="outline" onClick={() => setLimit((n) => n + 8)}>
              {text('پرسش‌های بیشتر', 'More questions')}
            </Button>
          )}
        </div>
      </div>
      {target?.id && auth.status === 'member' && auth.session && (
        <CommunityReplyComposer
          key={`${target.id}:${auth.session.user.id}`}
          productId={productId}
          threadId={target.id}
          row={target}
          restoreFocusRef={returnFocus}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setSent(target.id);
            setTarget(null);
          }}
        />
      )}
    </section>
  );
}
function CommunityReplyComposer({
  productId,
  threadId,
  row,
  restoreFocusRef,
  onClose,
  onSaved,
}: {
  productId: string;
  threadId: string;
  row: Answer;
  restoreFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useI18n();
  const auth = useCustomerSession();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ id: string; input: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || auth.status !== 'member') return;
    if (!attempt.current) {
      const values = new FormData(event.currentTarget);
      const parsed = communityReplyInput.safeParse({
        body: values.get('body'),
      });
      if (!parsed.success) {
        setError(
          text(
            'متن پاسخ را وارد کنید؛ حداکثر ۱۲۰۰ نویسه.',
            'Enter a reply of at most 1,200 characters.',
          ),
        );
        return;
      }
      attempt.current = {
        id: crypto.randomUUID().replaceAll('-', ''),
        input: JSON.stringify(parsed.data),
      };
    }
    setBusy(true);
    setError('');
    try {
      const response = await auth.store.fetch(
        `/api/support/product-questions/${locale}/${productId}/${threadId}/replies/${attempt.current.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: attempt.current.input,
        },
      );
      if (response.status === 204) {
        onSaved();
        return;
      }
      if (response.status < 500 && response.status !== 429) {
        attempt.current = null;
        setError(
          text(
            'پیام پذیرفته نشد. متن و دسترسی حساب را بررسی کنید.',
            'The message was rejected. Check the text and your account access.',
          ),
        );
        return;
      }
      throw new Error('Reply outcome unavailable');
    } catch {
      setError(
        text(
          'نتیجه مشخص نیست. تلاش دوباره همان پیام را پیگیری می‌کند.',
          'The result is unknown. Retry to check the same message.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy && !attempt.current) onClose();
      }}
      title={text('پاسخ به پرسش', 'Reply to question')}
      className="community-dialog"
      restoreFocusRef={restoreFocusRef}
    >
      <div className="community-dialog-context">
        <strong dir="auto">{row.question}</strong>
        <QuestionReplies row={row} locale={locale} />
      </div>
      <form className="product-question-form" onSubmit={(event) => void submit(event)}>
        <label>
          {text('متن پیام', 'Your message')}
          <textarea
            name="body"
            rows={4}
            maxLength={1200}
            required
            disabled={busy || !!attempt.current}
          />
        </label>
        <p className="small-note">
          {text(
            'پاسخ پس از بررسی در همین گفتگو نمایش داده می‌شود.',
            'Your reply appears in this thread after review.',
          )}
        </p>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {attempt.current
            ? text('پیگیری همان پیام', 'Retry the same message')
            : text('ثبت پیام', 'Send message')}
        </Button>
      </form>
    </Modal>
  );
}

function QuestionComposer({ name, slug }: { name: string; slug: string }) {
  const auth = useCustomerSession();
  const { locale } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const owner = auth.status === 'member' ? (auth.session?.user.id ?? null) : null;
  const entry = useSyncExternalStore(
    journal.subscribe,
    () => journal.snapshot(owner),
    () => null,
  );
  const [expanded, expand] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [commandId, setCommandId] = useState<string>();
  const ownedEntry = commandId === entry?.command.id ? entry : null;
  const unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  const context = '/purchase-requests?question=' + encodeURIComponent(slug);

  async function send(id: string, payload?: TicketCommand) {
    if (!owner) return;
    const command = payload ?? journal.retry(owner);
    try {
      const response = await auth.store.fetch(
        ticketCommandPath(command),
        ticketCommandRequest(command),
      );
      const raw = await response.json().catch(() => null);
      if (response.ok) {
        journal.finish(owner, command, raw);
        if (journal.snapshot(owner)?.state === 'done') expand(false);
      } else journal.fail(owner, command, response.status, raw?.title ?? 'ticket_unavailable');
    } catch {
      journal.fail(owner, command, 0, 'ticket_unavailable');
    }
    setCommandId(id);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!owner || unresolved) return;
    const content = shoppingRequestContent(
      new FormData(event.currentTarget),
      { kind: 'product-question', product: name.slice(0, 95), slug },
      locale,
    );
    const parsed = ticketCreateSchema.safeParse(content ? { ...content, locale } : null);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const command = {
      kind: 'create',
      staff: false,
      id: crypto.randomUUID().replaceAll('-', ''),
      body: parsed.data,
    } as const;
    try {
      journal.begin(owner, command);
    } catch {
      return;
    }
    setCommandId(command.id);
    void send(command.id, command);
  }

  const trigger = useRef<HTMLButtonElement>(null);
  const complete = ownedEntry?.state === 'done';
  return (
    <aside className="product-question-compose">
      <h3>{text('دربارهٔ این کالا سؤال دارید؟', 'A question about this product?')}</h3>
      <p>
        {text(
          'پیش از خرید از فروشگاه و کاربران بپرسید.',
          'Ask the store and other customers before you buy.',
        )}
      </p>
      {owner ? (
        <Button
          ref={trigger}
          variant="outline"
          onClick={() => {
            setCommandId(undefined);
            setInvalid(false);
            expand(true);
          }}
          disabled={unresolved && !ownedEntry}
        >
          {text('ثبت پرسش', 'Ask a question')}
        </Button>
      ) : (
        <Link
          className="button button-outline"
          href={'/account?returnTo=' + encodeURIComponent(context)}
        >
          {text('ورود و ثبت پرسش', 'Sign in to ask')}
        </Link>
      )}
      {complete && (
        <p role="status">
          {text('پرسش شما ثبت شد.', 'Your question was submitted.')}{' '}
          {ownedEntry.result?.ticket.id && (
            <Link className="text-link" href={'/support/tickets/' + ownedEntry.result.ticket.id}>
              {text('پیگیری پاسخ', 'Track replies')}
            </Link>
          )}
        </p>
      )}
      {unresolved && !ownedEntry && (
        <Link className="text-link" href="/support/tickets">
          {text('پیگیری درخواست قبلی', 'Check your previous request')}
        </Link>
      )}
      <Modal
        open={expanded && !complete && !!owner}
        onOpenChange={(open) => {
          if (!open && !unresolved) expand(false);
        }}
        title={text('ثبت پرسش', 'Ask a question')}
        className="community-dialog"
        restoreFocusRef={trigger}
      >
        <div className="community-dialog-context">
          <bdi>{name}</bdi>
        </div>
        <form className="product-question-form" onSubmit={submit}>
          <label>
            {text('پرسش شما؛ ۱۰ تا ۲۴۰ نویسه', 'Your question; 10–240 characters')}
            <textarea
              name="body"
              required
              minLength={10}
              maxLength={240}
              rows={4}
              disabled={unresolved}
              placeholder={text(
                'مثلاً این کالا با چه شارژری سازگار است؟',
                'For example, which charger works with this product?',
              )}
            />
          </label>
          <p className="small-note">
            {text(
              'پرسش پس از بررسی منتشر می‌شود. شماره، نشانی و جزئیات سفارش را وارد نکنید.',
              'Your question may be published after review. Leave out contact, address and order details.',
            )}
          </p>
          {(invalid || ownedEntry?.state === 'rejected') && (
            <p role="alert">
              {text(
                'پرسش ثبت نشد. متن ۱۰ تا ۲۴۰ نویسه و وضعیت حساب را بررسی کنید.',
                'Question not submitted. Check the 10–240 character text and your account.',
              )}
            </p>
          )}
          {ownedEntry?.state === 'unknown' ? (
            <Button type="button" onClick={() => void send(ownedEntry.command.id)}>
              {text('پیگیری همان پرسش', 'Retry the same question')}
            </Button>
          ) : (
            <Button type="submit" disabled={unresolved}>
              {unresolved ? text('در حال ثبت…', 'Sending…') : text('ثبت پرسش', 'Send question')}
            </Button>
          )}
        </form>
      </Modal>
    </aside>
  );
}

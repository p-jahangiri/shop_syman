'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { CircleHelp, MessageCircle, Search } from 'lucide-react';
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

type Answer = { question: string; answer: string; publishedAt?: string; demo?: boolean };
export function ProductQuestionBoard({
  answers,
  name,
  slug,
  connected,
}: {
  answers: Answer[];
  name: string;
  slug: string;
  connected: boolean;
}) {
  const { locale, digits } = useI18n();
  const text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const visible = answers.filter((row) =>
    normalizePersian(row.question + ' ' + row.answer).includes(normalizePersian(query)),
  );
  return (
    <section className="product-question-board" aria-labelledby="product-questions">
      <div className="product-question-heading">
        <div>
          <span className="eyebrow">{text('پاسخ‌های فروشگاه', 'Answers from the store')}</span>
          <h2 id="product-questions">
            {text('پرسش‌وپاسخ این کالا', 'Questions about this product')}
          </h2>
          <p>
            {text(
              'سؤال‌های پاسخ‌داده‌شده را ببینید یا سؤال خودتان را بپرسید.',
              'Browse answered questions or ask your own.',
            )}
          </p>
        </div>
        <span className="tag">
          {digits(answers.length)} {text('پرسش', 'questions')}
        </span>
      </div>
      <div className="product-question-layout">
        <div>
          {answers.length > 0 && (
            <label className="product-question-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                aria-label={text('جست‌وجو در سؤال‌ها', 'Search questions')}
                placeholder={text('مثلاً گارانتی یا سازگاری', 'e.g. warranty or compatibility')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(8);
                }}
              />
            </label>
          )}
          {!visible.length ? (
            <div className="product-question-empty">
              <CircleHelp aria-hidden="true" />
              <p>
                {query
                  ? text('پرسشی با این عبارت پیدا نشد.', 'No questions match your search.')
                  : text(
                      'هنوز پاسخی برای این کالا منتشر نشده است.',
                      'No answers have been published for this product yet.',
                    )}
              </p>
            </div>
          ) : (
            <ol className="product-question-list">
              {visible.slice(0, limit).map(({ question, answer, publishedAt, demo }, index) => (
                <li key={index}>
                  <h3>
                    <MessageCircle size={17} aria-hidden="true" />
                    {question}
                  </h3>
                  <div className="product-answer">
                    <div>
                      <strong>{text('پاسخ فروشگاه', 'Store reply')}</strong>
                      {demo && (
                        <span className="tag">{text('نمونهٔ توسعه', 'Development sample')}</span>
                      )}
                      {publishedAt && (
                        <time dateTime={publishedAt}>
                          {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
                            dateStyle: 'medium',
                            timeZone: 'Asia/Tehran',
                          }).format(new Date(publishedAt))}
                        </time>
                      )}
                    </div>
                    <p>{answer}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {visible.length > limit && (
            <button
              className="button button-outline"
              type="button"
              onClick={() => setLimit((n) => n + 8)}
            >
              {text('پرسش‌های بیشتر', 'More questions')}
            </button>
          )}
        </div>
        {connected && <QuestionComposer key={slug} name={name} slug={slug} />}
      </div>
    </section>
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
      if (response.ok) journal.finish(owner, command, raw);
      else journal.fail(owner, command, response.status, raw?.title ?? 'ticket_unavailable');
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

  return (
    <aside className="product-question-compose card-panel">
      <h3>{text('سؤال دیگری دارید؟', 'Have another question?')}</h3>
      <p>
        {text(
          'پاسخ در حساب شما می‌آید. پرسش و پاسخ پس از بررسی ممکن است بدون نام شما در همین صفحه منتشر شود.',
          'The reply goes to your account. After review, the store may publish the question and answer here without your name.',
        )}
      </p>
      {owner ? (
        <>
          {!expanded && (
            <button className="button button-primary" type="button" onClick={() => expand(true)}>
              {text('ثبت پرسش', 'Ask a question')}
            </button>
          )}
          {expanded && ownedEntry?.state !== 'done' && (
            <form onSubmit={submit}>
              <label>
                {text('متن سؤال', 'Your question')}
                <textarea
                  name="body"
                  required
                  maxLength={240}
                  rows={4}
                  disabled={unresolved}
                  placeholder={text(
                    'اطلاعات شخصی را در سؤال ننویسید.',
                    'Leave out personal information.',
                  )}
                />
              </label>
              <button type="submit" className="button button-primary" disabled={unresolved}>
                {text('ارسال پرسش', 'Send question')}
              </button>
            </form>
          )}
          {(invalid || ownedEntry?.state === 'rejected') && (
            <p role="alert">
              {text(
                'پرسش ثبت نشد. متن و وضعیت حساب را بررسی کنید.',
                'Question not submitted. Check the text and your account.',
              )}
            </p>
          )}
          {ownedEntry?.state === 'unknown' && (
            <button
              className="button button-outline"
              type="button"
              onClick={() => void send(ownedEntry.command.id)}
            >
              {text('تلاش دوبارهٔ همان پرسش', 'Retry the same question')}
            </button>
          )}
          {unresolved && !ownedEntry && (
            <Link href="/support/tickets">
              {text('ابتدا درخواست قبلی را پیگیری کنید', 'Check your previous request first')}
            </Link>
          )}
          {ownedEntry?.state === 'done' && (
            <p role="status">
              {text('سؤال شما ثبت شد.', 'Your question was submitted.')}{' '}
              <Link href={'/support/tickets/' + ownedEntry.result?.ticket.id}>
                {text('پیگیری پاسخ', 'Track the reply')}
              </Link>
            </p>
          )}
        </>
      ) : (
        <Link
          className="button button-primary"
          href={'/account?returnTo=' + encodeURIComponent(context)}
        >
          {text('ورود و ثبت پرسش', 'Sign in to ask')}
        </Link>
      )}
    </aside>
  );
}

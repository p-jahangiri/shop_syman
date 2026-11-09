import { useRef, useState } from 'react';
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
}: {
  ticket: TicketSummary;
  first: TicketMessage;
  refresh: () => void;
}) {
  const [slug, questionText] = first.body.split(/\n\n(.*)/s, 2);
  const [expanded, expand] = useState(false);
  const [question, setQuestion] = useState(() => questionText?.slice(0, 240) ?? '');
  const [answer, setAnswer] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>();
  const attempt = useRef<{ command: TicketCommand & { kind: 'reply' }; question: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(false);
  if (
    first.author !== 'customer' ||
    !questionText ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')
  )
    return null;

  async function publish() {
    if (busy || (!retry && (!confirmed || !question.trim() || !answer.trim()))) return;
    const current = attempt.current ?? {
      command: {
        id: crypto.randomUUID().replaceAll('-', ''),
        kind: 'reply',
        staff: true,
        ticketId: ticket.id,
        body: { version: ticket.version, body: answer.trim(), locale: ticket.locale },
      } as const,
      question: question.trim(),
    };
    attempt.current = current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<unknown>(
        `/admin/support/tickets/${ticket.id}/public-answer/${current.command.id}`,
        {
          method: 'POST',
          body: JSON.stringify({
            version: current.command.body.version,
            question: current.question,
            answer: current.command.body.body,
            confirmed: true,
          }),
        },
      );
      readTicketResult(result, current.command);
      attempt.current = null;
      setRetry(false);
      setDone(true);
      refresh();
    } catch (failure) {
      const known =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 429;
      if (known) attempt.current = null;
      setRetry(!known);
      setError(
        known ? failure : new Error('نتیجه مشخص نشد. برای بررسی، همان انتشار را دوباره بفرستید.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ticket-product-tool">
      <h3>پاسخ عمومی در صفحهٔ کالا</h3>
      {done ? (
        <p role="status">پرسش و پاسخ در صفحهٔ کالا منتشر شد و پاسخ برای مشتری هم ارسال شد.</p>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => expand(!expanded)}
            disabled={busy || retry}
          >
            {expanded ? 'بستن ویرایش پاسخ عمومی' : 'نوشتن پاسخ عمومی'}
          </button>
          {expanded && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void publish();
              }}
            >
              <p>
                متن زیر برای همه بازدیدکنندگان دیده می‌شود. نام، شماره، اطلاعات سفارش و سایر جزئیات
                شخصی را حذف کنید.
              </p>
              <fieldset disabled={busy || retry}>
                <Field label="متن سؤال برای انتشار">
                  <textarea
                    required
                    maxLength={240}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </Field>
                <Field label="پاسخ فروشگاه">
                  <textarea
                    required
                    maxLength={1200}
                    rows={4}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{' '}
                  متن را برای انتشار عمومی بازبینی کردم
                </label>
              </fieldset>
              <ErrorBox error={error} />
              <button
                type="submit"
                className="primary"
                disabled={busy || (!retry && (!confirmed || !question.trim() || !answer.trim()))}
              >
                {retry ? 'بررسی دوبارهٔ همان انتشار' : 'ارسال پاسخ و انتشار در صفحهٔ کالا'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

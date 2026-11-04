'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { RmaJournal } from '../../lib/orders/rma-journal';
import { rmaErrorText } from '../../lib/orders/rma-client';
export function RmaReceiptPanel({
  journal,
  actor,
  request,
  locale = 'fa',
  onResolved,
}: {
  journal: RmaJournal;
  actor: string;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  locale?: 'fa' | 'en';
  onResolved?: () => void;
}) {
  const entry = useSyncExternalStore(
    journal.subscribe,
    () => journal.snapshot(actor),
    () => null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false);
  const copy = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  async function recover() {
    if (locked.current || !entry) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const command = entry.command;
    try {
      const raw = await request(command.receiptPath, { method: 'GET', cache: 'no-store' });
      if (journal.finish(actor, command.commandId, raw)) onResolved?.();
    } catch (e) {
      journal.fail(actor, command.commandId, 0, 'rma_unavailable');
      if (journal.snapshot(actor)?.command.commandId === command.commandId)
        setError(rmaErrorText(e, locale));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!entry) return null;
  return (
    <section className="notice" aria-label={copy('رسید مرجوعی', 'Return command receipt')}>
      <p>
        {copy('شناسهٔ فرمان', 'Command ID')}: <code dir="ltr">{entry.command.commandId}</code>
      </p>
      {entry.state === 'done' ? (
        <p role="status">{copy('ثبت فرمان تأیید شد.', 'The command was confirmed.')}</p>
      ) : entry.state === 'rejected' ? (
        <p role="alert">{rmaErrorText({ code: entry.code }, locale)}</p>
      ) : (
        <>
          <p>
            {copy(
              'تا روشن‌شدن نتیجه، فرم تازه بسته است. پیدانشدن رسید به‌تنهایی به معنی ثبت‌نشدن نیست.',
              'New commands are blocked until the result is resolved. A missing receipt alone does not prove that nothing was saved.',
            )}
          </p>
          <button
            className="button button-outline"
            type="button"
            disabled={busy || entry.state === 'pending'}
            onClick={() => void recover()}
          >
            {busy
              ? copy('در حال پیگیری…', 'Checking…')
              : copy('دریافت رسید همین شناسه', 'Check this command’s receipt')}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {['done', 'rejected'].includes(entry.state) && (
        <button
          className="button button-outline"
          type="button"
          onClick={() => {
            journal.clear(actor);
            setError('');
            onResolved?.();
          }}
        >
          {copy('بستن رسید و دریافت وضعیت تازه', 'Close receipt and refresh')}
        </button>
      )}
    </section>
  );
}

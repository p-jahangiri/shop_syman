'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCustomerSession } from './auth-provider';
import { useSourcing, useSourcingCommand } from './sourcing-provider';
import { useShop } from './shop-context';
import { useSourcingText } from './sourcing';
import Link from './localized-link';
import { Button } from './ui';
import { recoverSourcingView, type SourcingRecoveryResult } from '@/lib/sourcing-client';
import { CartError } from '@/lib/cart-client';
import {
  finishSourcingJournal,
  readSourcingJournal,
  sourcingRecoveryMayApply,
} from '@/lib/sourcing-journal';
import type { SourcingMutation } from '@/lib/sourcing-contract';
export function SourcingRecovery({
  viewedId,
  onRecovered,
}: {
  viewedId?: string;
  onRecovered?: (value: SourcingRecoveryResult) => void;
}) {
  const auth = useCustomerSession(),
    journal = useSourcingCommand(),
    cart = useSourcing(),
    shop = useShop(),
    text = useSourcingText(),
    [operation, setOperation] = useState<'submit' | 'cancel'>('submit'),
    [requestId, setRequestId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<SourcingMutation | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult(null);
    setError('');
    setRequestId('');
    setBusy(false);
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [journal.owner]);
  useEffect(() => {
    if (
      journal.pending &&
      !journal.pending.result &&
      (journal.pending.command.kind === 'submit' || journal.pending.command.kind === 'cancel')
    ) {
      setOperation(journal.pending.command.kind);
      setRequestId(journal.pending.command.body.requestId);
    }
  }, [journal.pending]);
  async function find(event: FormEvent) {
    event.preventDefault();
    const owner = journal.owner;
    if (!owner || busy || inFlight.current) return;
    if (
      !sourcingRecoveryMayApply(
        readSourcingJournal(owner),
        operation,
        requestId.trim().toLowerCase(),
      )
    ) {
      setError('mismatch');
      return;
    }
    const abort = new AbortController();
    inFlight.current = abort;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const command = requestId.trim().toLowerCase(),
        recovered = await recoverSourcingView(
          auth.store.fetch,
          operation,
          command,
          viewedId,
          abort.signal,
        ),
        value = recovered.receipt;
      if (abort.signal.aborted || auth.store.snapshot().session?.user.id !== owner) return;
      const pending = readSourcingJournal(owner);
      if (!sourcingRecoveryMayApply(pending, operation, command, value.id)) {
        setError('mismatch');
        return;
      }
      if (
        pending &&
        !pending.result &&
        pending.command.kind === operation &&
        pending.command.body.requestId.replaceAll('-', '').toLowerCase() ===
          command.replaceAll('-', '') &&
        (pending.command.kind !== 'cancel' || pending.command.id === value.id)
      )
        finishSourcingJournal(owner, pending.command.body.requestId, value);
      setResult(value);
      onRecovered?.(recovered);
      cart?.refresh();
      shop.retry();
    } catch (error) {
      if (!abort.signal.aborted && auth.store.snapshot().session?.user.id === owner)
        setError(error instanceof CartError && error.status === 404 ? 'missing' : 'unavailable');
    } finally {
      if (inFlight.current === abort) {
        inFlight.current = null;
        if (!abort.signal.aborted) setBusy(false);
      }
    }
  }
  if (auth.status !== 'member') return null;
  return (
    <details className="sourcing-recovery">
      <summary>
        {text('پیگیری نتیجهٔ ثبت یا لغو درخواست', 'Track a submission or cancellation')}
      </summary>
      <p className="small-note">
        {text(
          'اگر پاسخ دریافت نکردید، با شناسهٔ پیگیری زیر نتیجهٔ ثبت یا لغو را بررسی کنید. پس از بازکردن دوبارهٔ صفحه هم می‌توانید همین شناسه را وارد کنید.',
          'If no response arrived, use your tracking ID to check the submission or cancellation. You can enter the same ID after reopening this page.',
        )}
      </p>
      <form onSubmit={find}>
        <div className="field">
          <label htmlFor="sourcing-recovery-kind">{text('نوع پیگیری', 'Track')}</label>
          <select
            id="sourcing-recovery-kind"
            value={operation}
            disabled={busy}
            onChange={(event) => {
              setOperation(event.target.value as 'submit' | 'cancel');
              setResult(null);
            }}
          >
            <option value="submit">{text('ثبت درخواست', 'Submit request')}</option>
            <option value="cancel">{text('لغو درخواست', 'Cancel request')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="sourcing-recovery-id">{text('شناسهٔ پیگیری', 'Tracking ID')}</label>
          <input
            id="sourcing-recovery-id"
            value={requestId}
            onChange={(event) => {
              setRequestId(event.target.value);
              setResult(null);
            }}
            maxLength={36}
            dir="ltr"
            disabled={busy}
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? text('در حال پیگیری…', 'Looking up…') : text('بررسی نتیجه', 'Check result')}
        </Button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error === 'mismatch'
            ? text(
                'فرمان دیگری هنوز نتیجهٔ قطعی ندارد. همان فرمان در انتظار را پیگیری کنید؛ رسید یک فرمان دیگر وضعیت این صفحه را عوض نمی‌کند.',
                'Another command is unresolved. Track that pending command; another command’s receipt cannot replace this view.',
              )
            : error === 'missing'
              ? text(
                  'هنوز نتیجه‌ای پیدا نشد؛ ممکن است درخواست قبلی همچنان در حال پردازش باشد. با همین شناسه دوباره پیگیری کنید.',
                  'No result was found yet. The earlier request may still be processing. Check again with the same tracking ID.',
                )
              : text(
                  'نتیجه دریافت نشد؛ شناسهٔ پیگیری و ورود به حساب را بررسی کنید.',
                  'The result could not be read. Check the tracking ID and your sign-in.',
                )}
        </p>
      )}
      {result && (
        <p role="status">
          {text(
            'نتیجه پیدا شد. برای دیدن وضعیت فعلی، صفحهٔ درخواست را باز کنید.',
            'The result was found. Open the request page to see its current status.',
          )}{' '}
          <Link className="text-link" href={`/sourcing/${result.id}`}>
            {result.reference}
          </Link>
        </p>
      )}
    </details>
  );
}

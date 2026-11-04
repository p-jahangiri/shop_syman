'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { RmaJournal } from '../../lib/orders/rma-journal';
import { RmaReceiptPanel } from './rma-receipt-panel';
export function RmaCommandGuard({
  journal,
  actor,
  locale = 'fa',
  onOpen,
  unverified = false,
  request,
}: {
  journal: RmaJournal;
  actor: string | null;
  locale?: 'fa' | 'en';
  onOpen?: () => void;
  unverified?: boolean;
  request?: (path: string, init?: RequestInit) => Promise<unknown>;
}) {
  const entry = useSyncExternalStore(
    journal.subscribe,
    () => (unverified ? null : journal.snapshot(actor)),
    () => null,
  );
  const unverifiedUnresolved = useSyncExternalStore(
    journal.subscribe,
    () => unverified && journal.hasUnresolved(),
    () => false,
  );
  const [recoverActor, setRecoverActor] = useState<string | null>(null);
  const unresolved =
    unverifiedUnresolved || entry?.state === 'pending' || entry?.state === 'unknown';
  const showingReceipt =
    !unverified && actor !== null && recoverActor === actor && !!request && !!entry;
  useEffect(() => {
    if (!unresolved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);
  if (unverifiedUnresolved)
    return (
      <div className="notice" role="status">
        <p>
          {locale === 'fa'
            ? 'نتیجهٔ یک درخواست قبلی هنوز مشخص نیست. پس از تأیید دوبارهٔ حساب، رسید آن را پیگیری کنید؛ تا آن زمان درخواست تازه نفرستید.'
            : 'A previous request still has an unknown result. Verify your account again to check its receipt before submitting another request.'}
        </p>
      </div>
    );
  if ((!unresolved && !showingReceipt) || !entry || actor === null) return null;
  return (
    <div className="notice" role="status">
      {unresolved && (
        <>
          <p>
            {locale === 'fa'
              ? 'نتیجهٔ فرمان مرجوعی هنوز قطعی نیست. فقط رسید همین شناسه را پیگیری کنید؛ درخواست تازه نفرستید.'
              : 'The return command is not confirmed. Check this command’s receipt before submitting another request.'}
          </p>
          <code dir="ltr">{entry.command.commandId}</code>
          <p>
            {locale === 'fa'
              ? 'اگر ذخیره‌سازی همین تب در دسترس باشد، فقط شناسه و مسیر فرمان برای بازیابی نگهداری می‌شود. شناسه را برای پیگیری حفظ کنید؛ متن خصوصی با خروج پاک می‌شود.'
              : 'When tab storage is available, only the command ID and route are retained for recovery. Keep the command ID for tracking. Private text is cleared on sign-out.'}
          </p>
        </>
      )}
      {onOpen && (
        <button className="button button-outline" type="button" onClick={onOpen}>
          {locale === 'fa' ? 'پیگیری درخواست' : 'Track request'}
        </button>
      )}
      {request && !showingReceipt && (
        <button
          className="button button-outline"
          type="button"
          onClick={() => setRecoverActor(actor)}
        >
          {locale === 'fa' ? 'پیگیری رسید همین درخواست' : 'Track this request’s receipt'}
        </button>
      )}
      {showingReceipt && request && (
        <RmaReceiptPanel
          journal={journal}
          actor={actor}
          request={request}
          locale={locale}
          onResolved={() => {
            if (!journal.snapshot(actor)) setRecoverActor(null);
          }}
        />
      )}
    </div>
  );
}

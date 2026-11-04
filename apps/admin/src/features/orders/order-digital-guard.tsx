import { useEffect, useSyncExternalStore } from 'react';
import { orderDigitalJournal } from '../../state/orders/order-digital-journal';

// Mounted at the account shell, outside the section/error boundary. Navigating
// away from Orders must not remove the warning for an unresolved RAM command.
export function DigitalCommandGuard({
  viewerId,
  onOpen,
}: {
  viewerId: string;
  onOpen?: () => void;
}) {
  const entry = useSyncExternalStore(
    orderDigitalJournal.subscribe,
    () => orderDigitalJournal.snapshot(viewerId),
    () => null,
  );
  const unresolved = entry?.state === 'pending' || entry?.state === 'unknown';
  useEffect(() => {
    if (!unresolved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unresolved]);
  if (!unresolved || !entry) return null;
  return (
    <div className="notice" role="status">
      نتیجهٔ تحویل دیجیتال سفارش <code dir="ltr">{entry.metadata.orderId}</code>{' '}
      {entry.state === 'pending' ? 'در حال دریافت است' : 'هنوز مشخص نیست'}. شناسه و مشخصات فرمان در
      حافظهٔ همین حساب محفوظ‌اند؛ متن خصوصی نگهداری نشده است. پیش از بستن صفحه، از بخش سفارش‌ها رسید
      همان شناسه را پیگیری کنید.
      {onOpen && (
        <button type="button" onClick={onOpen}>
          پیگیری رسید تحویل دیجیتال
        </button>
      )}
    </div>
  );
}

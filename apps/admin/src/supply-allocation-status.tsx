import { useEffect, useState } from 'react';
import { supplyAllocationHeld } from '../../storefront/lib/supply-allocation';
import type { SupplyAdminDetail } from './supply-contract';
type Allocation = SupplyAdminDetail['task']['allocation'];
const date = (value: string) =>
  new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(new Date(value));
export function SupplyAllocationStatus({
  allocation,
  reserved,
}: {
  allocation: Allocation;
  reserved: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const hasAllocation = !!allocation;
  useEffect(() => {
    setNow(Date.now());
    if (!hasAllocation) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasAllocation, allocation?.id, allocation?.version]);
  if (!allocation)
    return (
      <p className="notice">
        تخصیص فعال موجودی برای این درخواست ثبت نشده است. ثبت دریافت به‌تنهایی موجودی را نگه
        نمی‌دارد.
      </p>
    );
  const held = supplyAllocationHeld(reserved, allocation, now);
  return (
    <div className="notice" role="status">
      <strong>
        {held ? 'سهم موجودی این درخواست نگه‌داری شده است' : 'مهلت نگه‌داری این تخصیص گذشته است'}
      </strong>
      <p>
        مهلت نگه‌داری: <time dateTime={allocation.expiresAt}>{date(allocation.expiresAt)}</time> ·{' '}
        {allocation.quantity.toLocaleString('fa-IR')} واحد · وقت تهران
      </p>
      {!held && <p>برای بررسی وضعیت تازه و اقدام بعدی، اطلاعات را بازخوانی کنید.</p>}
      <p>تخصیص، خرید یا پرداخت ایجاد نمی‌کند؛ تبدیل به خرید هنوز در این مرحله در دسترس نیست.</p>
    </div>
  );
}

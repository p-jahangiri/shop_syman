'use client';
import { useState } from 'react';
import { Button } from './ui';
import { useI18n } from './locale-provider';
import { useShop } from './shop-context';
export function CartCommandNotice() {
  const { cartCommand, sendCartCommand } = useShop(),
    { locale } = useI18n(),
    [busy, setBusy] = useState(false),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  if (!cartCommand || !sendCartCommand) return null;
  const run = async (mode: 'send' | 'receipt' | 'refresh') => {
    if (busy) return;
    setBusy(true);
    try {
      await sendCartCommand(cartCommand.command, mode);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card-panel notice" role="status">
      <strong>
        {cartCommand.known
          ? text(
              'ثبت فرمان سبد تأیید شد؛ وضعیت تازه لازم است',
              'Cart command confirmed; current state is required',
            )
          : text(
              'فرمان سبد در انتظار نتیجهٔ قطعی است',
              'Cart command awaiting a confirmed outcome',
            )}
      </strong>
      <p>
        {text('شناسهٔ همین فرمان', 'This command ID')}:{' '}
        <code dir="ltr">{cartCommand.command.body.requestId}</code>
      </p>
      <p>
        {text(
          'فرمان و شرایط اولیه فقط در حافظهٔ همین نشست و برای همین حساب حفظ می‌شوند. بستن یا تازه‌سازی کامل تب این حافظه را پاک می‌کند.',
          'The original command is kept in this session’s memory for this account. Closing or fully reloading the tab clears that memory.',
        )}
      </p>
      <div className="order-action-row">
        {cartCommand.known ? (
          <Button disabled={busy} onClick={() => void run('refresh')}>
            {text('دریافت وضعیت سبد — بدون ارسال دوباره', 'Load cart state — without resending')}
          </Button>
        ) : (
          <>
            <Button disabled={busy} onClick={() => void run('receipt')}>
              {text('پیگیری رسید همین فرمان', 'Find this command receipt')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void run('send')}>
              {text('تلاش دوباره با همان شناسه و شرایط', 'Retry the same ID and conditions')}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

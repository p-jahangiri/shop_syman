'use client';
import { useEffect, useState } from 'react';
import { useI18n, useStorefront } from '../navigation/locale-provider';
import {
  readRmaPublicPolicy,
  type RmaPublicPolicy,
} from '@sayman/web-shared/lib/orders/rma-contract.ts';
import { rmaRequest } from '@sayman/web-shared/lib/orders/rma-client.ts';
import { ReturnFinancialNotice } from '@sayman/web-shared/components/orders/rma-case-detail';
import Link from '../navigation/localized-link';
export function ReturnsPolicy() {
  const { locale } = useI18n();
  const connected = useStorefront().dataSource === 'api';
  const [policy, setPolicy] = useState<RmaPublicPolicy | null>(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  const copy = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  useEffect(() => {
    if (!connected) return;
    const abort = new AbortController();
    setError(false);
    setPolicy(null);
    void rmaRequest(fetch, '/api/returns/policy', { signal: abort.signal, credentials: 'omit' })
      .then(readRmaPublicPolicy)
      .then((p) => {
        if (!abort.signal.aborted) setPolicy(p);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [connected, attempt]);
  if (!connected) return null;
  return (
    <section
      className="card-panel"
      aria-label={copy('شرایط مرجوعی و مشکل دیجیتال', 'Returns and digital-item policy')}
    >
      <h2>{copy('شرایط مرجوعی و مشکل کالای دیجیتال', 'Returns and digital-item issues')}</h2>
      {!policy && !error && (
        <p role="status">{copy('در حال دریافت شرایط معتبر…', 'Loading current policy…')}</p>
      )}
      {error && (
        <>
          <p role="alert">
            {copy(
              'شرایط فعلی دریافت نشد؛ مهلت یا پذیرش درخواست را نمی‌توان تأیید کرد.',
              'The current policy is unavailable. No request window or eligibility can be confirmed.',
            )}
          </p>
          <button
            className="button button-outline"
            type="button"
            onClick={() => setAttempt((v) => v + 1)}
          >
            {copy('تلاش دوباره', 'Retry')}
          </button>
        </>
      )}
      {policy &&
        (!policy.configured ? (
          <p>
            {copy('شرایط درخواست هنوز تنظیم نشده است.', 'Request policy has not been configured.')}
          </p>
        ) : (
          <>
            <p className="preserve-lines">
              {locale === 'fa' ? policy.conditionsFa : policy.conditionsEn}
            </p>
            {policy.windowMode === 'deliveryDays' && (
              <p>
                {copy(
                  `مهلت درخواست: ${policy.windowDays} روز از تحویل ثبت‌شدهٔ کالا یا آماده‌شدن محتوای دیجیتال. مشاهدهٔ محتوا مبدأ مهلت نیست.`,
                  `Request window: ${policy.windowDays} days from recorded physical delivery or digital availability. Viewing content does not start the window.`,
                )}
              </p>
            )}
            {policy.windowMode === 'manualReview' && (
              <p>
                {copy(
                  'شرایط و مهلت هر درخواست به بررسی مدیر نیاز دارد.',
                  'Each request’s terms and timing require staff review.',
                )}
              </p>
            )}
            <p>
              {policy.enabled
                ? copy(
                    `درخواست‌های فعال: ${policy.physicalReturns ? 'مرجوعی فیزیکی' : ''}${policy.physicalReturns && policy.digitalComplaints ? '، ' : ''}${policy.digitalComplaints ? 'مشکل دیجیتال' : ''}.`,
                    `Available requests: ${policy.physicalReturns ? 'physical return' : ''}${policy.physicalReturns && policy.digitalComplaints ? ', ' : ''}${policy.digitalComplaints ? 'digital complaint' : ''}.`,
                  )
                : copy(
                    'ثبت درخواست تازه غیرفعال است؛ پیگیری درخواست‌های قبلی برقرار است.',
                    'New requests are disabled. Existing requests remain available.',
                  )}
            </p>
            <Link href="/orders">
              {copy('ثبت یا پیگیری از جزئیات سفارش', 'Create or track from order details')}
            </Link>
          </>
        ))}
      <ReturnFinancialNotice locale={locale} />
    </section>
  );
}

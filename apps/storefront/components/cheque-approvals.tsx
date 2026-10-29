'use client';
import { advanceRequestGeneration } from '../lib/request-generation';
import { useEffect, useRef, useState } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n } from './locale-provider';
import { approvalPageSchema } from '../lib/cheque-approval-contract';
import type { z } from '@/lib/schema-runtime';
import { ChequeApprovalItems } from './cheque-approval-copy';
export function CustomerChequeApprovals({ orderId }: { orderId: string }) {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en),
    owner = auth.status === 'member' ? auth.session!.user.id : null,
    [value, setValue] = useState<{
      owner: string;
      page: z.infer<typeof approvalPageSchema>;
    } | null>(null),
    [failed, setFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
    generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current,
      c = new AbortController();
    setValue(null);
    setFailed(false);
    if (owner)
      void auth.store
        .fetch('/api/credit/orders/' + orderId + '/cheque-approvals', { signal: c.signal })
        .then(async (response) => {
          if (!response.ok) throw Error('Upfront unavailable');
          const page = approvalPageSchema.parse(await response.json()),
            now = auth.store.snapshot();
          if (page.orderId !== orderId) throw Error('Unrelated order');
          if (
            !c.signal.aborted &&
            ticket === generation.current &&
            now.status === 'member' &&
            now.session?.user.id === owner
          )
            setValue({ owner, page });
        })
        .catch(() => {
          if (!c.signal.aborted && ticket === generation.current) setFailed(true);
        });
    return () => {
      advanceRequestGeneration(generation);
      c.abort();
    };
  }, [owner, orderId, auth.store, refresh]);
  if (!owner) return null;
  const page = value?.owner === owner ? value.page : null;
  return (
    <section className="card-panel credit-upfront-panel">
      <h2>{text('وضعیت تأیید چک‌ها', 'Manual cheque approvals')}</h2>
      <p>
        {text(
          'تأیید هر چک به نسخهٔ جاری همان سند وابسته است.',
          'Each approval is tied to the current version of its cheque.',
        )}
      </p>
      <button onClick={() => setRefresh((n) => n + 1)}>
        {text('بررسی تأیید چک‌ها', 'Refresh cheque approvals')}
      </button>
      {failed ? (
        <p role="alert">
          {text(
            'وضعیت تأیید چک‌ها دریافت نشد؛ دوباره تلاش کنید.',
            'Cheque approvals could not be loaded. Retry.',
          )}
        </p>
      ) : !page ? (
        <p role="status">{text('در حال دریافت…', 'Loading…')}</p>
      ) : (
        <ChequeApprovalItems page={page} locale={locale} />
      )}
    </section>
  );
}

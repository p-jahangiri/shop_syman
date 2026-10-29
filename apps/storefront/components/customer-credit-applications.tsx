'use client';
import { customerCreditScopeJournal } from '../lib/credit-purchase-scope-journal';
import { downloadPrivateCreditDocument } from '../lib/credit-document-download';
import type { CreditDocumentDownload } from '../lib/credit-document-contract';
import { customerCreditSubmissionJournal } from '../lib/credit-submission-journal';
import { customerCreditDocumentJournal } from '../lib/credit-document-journal';
import { useCallback, useMemo } from 'react';
import { useCustomerSession } from './auth-provider';
import { useI18n, useStorefront } from './locale-provider';
import Link from './localized-link';
import { CreditApplicationsWorkspace } from './credit-applications-workspace';
import { customerCreditConsentJournal } from '../lib/credit-requirements-journal';
import { customerCreditApplicationJournal } from '../lib/credit-application-journal';
import { isPurchaseKindEnabled } from '../lib/purchasing';
export function CustomerCreditApplications() {
  const auth = useCustomerSession(),
    { locale } = useI18n(),
    { dataSource, purchaseMethods } = useStorefront(),
    text = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const transport = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const owner = auth.store.snapshot().session?.user.id,
        response = await auth.store.fetch(path, init),
        raw = await response.json().catch(() => null),
        current = auth.store.snapshot();
      if (current.status !== 'member' || current.session?.user.id !== owner)
        throw Object.assign(Error('Session changed'), { status: 0, code: 'session_changed' });
      if (!response.ok)
        throw Object.assign(Error('Credit request unavailable'), {
          status: response.status,
          code: typeof raw?.title === 'string' ? raw.title : 'credit_application_unavailable',
        });
      return raw;
    },
    [auth.store],
  );
  const downloadOwner = auth.session?.user.id ?? null,
    downloadRevision = auth.store.viewRevision();
  const download = useMemo<CreditDocumentDownload>(
    () => (path, id, file, signal) =>
      downloadPrivateCreditDocument(
        (path, init) => auth.store.fetch(path, init),
        () => {
          const current = auth.store.snapshot();
          return (
            !!downloadOwner &&
            current.status === 'member' &&
            current.session?.user.id === downloadOwner &&
            auth.store.viewRevision() === downloadRevision
          );
        },
        path,
        id,
        file,
        signal,
      ),
    [auth.store, downloadOwner, downloadRevision],
  );
  return (
    <div className="container support-tickets-page">
      <div className="page-top">
        <Link href="/account">{text('حساب کاربری', 'My account')}</Link>
        <Link href="/credit/purchases">
          {text('محاسبات و سفارش‌های چکی', 'Cheque calculations and orders')}
        </Link>
      </div>
      <h1>{text('درخواست‌های خرید چکی', 'Cheque applications')}</h1>
      {dataSource !== 'api' ? (
        <p>
          {text(
            'درخواست خصوصی در این نسخه در دسترس نیست.',
            'Private applications are unavailable in this preview.',
          )}
        </p>
      ) : auth.status === 'member' && auth.session ? (
        <CreditApplicationsWorkspace
          canCreate={isPurchaseKindEnabled(purchaseMethods, 'cheque')}
          recoveryLink={
            <Link href="/checkout">{text('بررسی نتیجهٔ سفارش', 'Check order outcome')}</Link>
          }
          key={auth.session.user.id}
          owner={auth.session.user.id}
          locale={locale}
          transport={transport}
          journal={customerCreditApplicationJournal}
          consentJournal={customerCreditConsentJournal}
          submissionJournal={customerCreditSubmissionJournal}
          documentJournal={customerCreditDocumentJournal}
          scopeJournal={customerCreditScopeJournal}
          download={download}
        />
      ) : auth.status === 'restoring' ? (
        <p role="status">{text('در حال بررسی حساب…', 'Checking your account…')}</p>
      ) : (
        <section className="card-panel">
          <p>
            {text(
              'برای دیدن و ذخیرهٔ پیش‌نویس خصوصی، وارد حساب خود شوید.',
              'Sign in to view and save private application drafts.',
            )}
          </p>
          {auth.status === 'unavailable' && (
            <button type="button" onClick={() => void auth.store.restore()}>
              {text('بررسی دوبارهٔ حساب', 'Recheck account')}
            </button>
          )}
          <Link href="/account">{text('ورود به حساب', 'Sign in')}</Link>
        </section>
      )}
    </div>
  );
}

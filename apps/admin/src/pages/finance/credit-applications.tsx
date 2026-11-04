import { adminCreditScopeJournal } from '@sayman/web-shared/lib/credit/credit-purchase-scope-journal.ts';
import { adminCreditReviewJournal } from '@sayman/web-shared/lib/credit/credit-review-journal.ts';
import { downloadPrivateCreditDocument } from '@sayman/web-shared/lib/credit/credit-document-download.ts';
import type { CreditDocumentDownload } from '@sayman/web-shared/lib/credit/credit-document-contract.ts';
import { useCallback, useMemo } from 'react';
import { api } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import { isCreditApplicationPath } from '@sayman/web-shared/lib/credit/credit-application-path.ts';
import { CreditApplicationsWorkspace } from '@sayman/web-shared/components/credit/credit-applications-workspace';
import type { CreditReviewExpiryField } from '@sayman/web-shared/components/credit/credit-review-panel';
import { PersianDateField } from '../../components/forms/persian-date-field';
import '../../styles/finance/cheque-finance.css';
const reviewExpiryField: CreditReviewExpiryField = (props) => (
  <PersianDateField {...props} label="انقضای تأیید" encoding="utc" precision="minute" required />
);
export function CreditApplicationsPage({ viewerId }: { viewerId: string }) {
  const transport = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!isCreditApplicationPath(path, init.method ?? 'GET', true))
      throw Error('Invalid private credit path');
    const revision = adminViewRevision(),
      value = await api<unknown>(path.slice(4), init);
    if (revision !== adminViewRevision()) throw Error('Credit authorization changed');
    return value;
  }, []);
  const binding = adminViewRevision();
  const download = useMemo<CreditDocumentDownload>(
    () => (path, id, file, signal) =>
      downloadPrivateCreditDocument(
        (path, init) => api<Response>(path.slice(4), init, 'response'),
        () => binding === adminViewRevision(),
        path,
        id,
        file,
        signal,
        true,
      ),
    [binding],
  );
  return (
    <CreditApplicationsWorkspace
      key={viewerId}
      owner={viewerId}
      staff
      reviewJournal={adminCreditReviewJournal}
      scopeJournal={adminCreditScopeJournal}
      reviewExpiryField={reviewExpiryField}
      locale="fa"
      transport={transport}
      download={download}
    />
  );
}

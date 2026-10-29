import { adminCreditScopeJournal } from '../../storefront/lib/credit-purchase-scope-journal';
import { adminCreditReviewJournal } from '../../storefront/lib/credit-review-journal';
import { downloadPrivateCreditDocument } from '../../storefront/lib/credit-document-download';
import type { CreditDocumentDownload } from '../../storefront/lib/credit-document-contract';
import { useCallback, useMemo } from 'react';
import { api } from './api';
import { adminViewRevision } from './admin-view-authority';
import { isCreditApplicationPath } from '../../storefront/lib/credit-application-path';
import { CreditApplicationsWorkspace } from '../../storefront/components/credit-applications-workspace';
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
      owner={viewerId}
      staff
      reviewJournal={adminCreditReviewJournal}
      scopeJournal={adminCreditScopeJournal}
      locale="fa"
      transport={transport}
      download={download}
    />
  );
}

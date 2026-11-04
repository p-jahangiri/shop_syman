import { isCreditClearancePath } from '@sayman/web-shared/lib/credit/credit-clearance-contract.ts';
import { proxyCreditClearance } from '@/lib/credit/credit-clearance-proxy';
import { isChequeApprovalPath } from '@sayman/web-shared/lib/credit/cheque-approval-contract.ts';
import { proxyChequeApproval } from '@/lib/credit/cheque-approval-proxy';
import { proxyCreditUpfront } from '@/lib/credit/credit-upfront-proxy';
import { isCreditUpfrontPath } from '@sayman/web-shared/lib/credit/credit-upfront-contract.ts';
import { proxyCreditSchedules } from '@/lib/credit/credit-schedule-proxy';
import { proxyChequeLedger } from '@/lib/credit/cheque-ledger-proxy';
import { isChequeLedgerPath } from '@sayman/web-shared/lib/credit/cheque-ledger-contract.ts';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const u = new URL(request.url),
    environment = {
      SHOP_API_URL: process.env.SHOP_API_URL,
      SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL,
      SHOP_DATA_MODE: process.env.SHOP_DATA_MODE,
    };
  return isCreditClearancePath(u.pathname + u.search)
    ? proxyCreditClearance(request, environment)
    : isChequeApprovalPath(u.pathname + u.search)
      ? proxyChequeApproval(request, environment)
      : isCreditUpfrontPath(u.pathname + u.search)
        ? proxyCreditUpfront(request, environment)
        : isChequeLedgerPath(u.pathname + u.search)
          ? proxyChequeLedger(request, environment)
          : proxyCreditSchedules(request, environment);
}

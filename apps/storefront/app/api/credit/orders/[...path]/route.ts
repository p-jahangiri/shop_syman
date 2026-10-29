import { isCreditClearancePath } from '@/lib/credit-clearance-contract';
import { proxyCreditClearance } from '@/lib/credit-clearance-proxy';
import { isChequeApprovalPath } from '@/lib/cheque-approval-contract';
import { proxyChequeApproval } from '@/lib/cheque-approval-proxy';
import { proxyCreditUpfront } from '@/lib/credit-upfront-proxy';
import { isCreditUpfrontPath } from '@/lib/credit-upfront-contract';
import { proxyCreditSchedules } from '@/lib/credit-schedule-proxy';
import { proxyChequeLedger } from '@/lib/cheque-ledger-proxy';
import { isChequeLedgerPath } from '@/lib/cheque-ledger-contract';
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

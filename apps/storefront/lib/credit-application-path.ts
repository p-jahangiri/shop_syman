import { isCreditPurchaseScopePath } from './credit-purchase-scope-contract.ts';
import { isCreditReviewPath } from './credit-review-contract.ts';
import { isCreditSubmissionPath } from './credit-submission-contract.ts';
import { isCreditDocumentPath } from './credit-document-contract.ts';
import { isCreditRequirementsPath } from './credit-requirements-path.ts';
export function isCreditApplicationPath(value: string, method = 'GET', staff = false) {
  if (isCreditPurchaseScopePath(value, method, staff)) return true;
  if (isCreditReviewPath(value, method, staff)) return true;
  if (isCreditSubmissionPath(value, method, staff)) return true;
  if (isCreditDocumentPath(value, method, staff)) return true;
  if (isCreditRequirementsPath(value, method, staff)) return true;
  const base = staff ? '/api/admin/credit/' : '/api/credit/';
  if (!value.startsWith(base)) return false;
  const url = new URL(value, 'http://localhost');
  if (url.origin !== 'http://localhost' || url.hash || url.pathname !== value.split('?')[0])
    return false;
  const path = url.pathname.slice(base.length),
    id = '[a-f0-9]{32}';
  let allowed: string[] = [];
  if (method === 'GET') {
    if (path === 'applications') allowed = ['state', 'cursor'];
    else if (!staff && path === 'plans') allowed = ['after'];
    else if (
      !new RegExp('^applications/' + id + '$').test(path) &&
      !(!staff && new RegExp('^commands/' + id + '$').test(path))
    )
      return false;
  } else if (
    staff ||
    url.search ||
    !(
      (method === 'POST' && new RegExp('^applications/commands/' + id + '$').test(path)) ||
      (method === 'PUT' && new RegExp('^applications/' + id + '/cancel/' + id + '$').test(path))
    )
  )
    return false;
  const names = [...url.searchParams.keys()];
  if (names.length !== new Set(names).size || names.some((x) => !allowed.includes(x))) return false;
  for (const [k, v] of url.searchParams)
    if (
      k === 'state'
        ? !['Draft', 'Submitted', 'Cancelled', 'Approved', 'Declined'].includes(v)
        : k === 'after'
          ? !/^[A-Za-z0-9_-]{1,64}$/.test(v)
          : v.length < 1 || v.length > 180 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)
    )
      return false;
  return !/(?:^|\/)0{32}(?:\/|$)/.test(path);
}

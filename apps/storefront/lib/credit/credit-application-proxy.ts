import {
  isCreditPurchaseScopePath,
  creditScopeRevokeBodySchema,
  creditPurchaseScopeResultSchema,
  readCreditPurchaseScopePage,
  readCreditScopeResult,
  type CreditScopeCommand,
} from '@sayman/web-shared/lib/credit/credit-purchase-scope-contract.ts';
import {
  isCreditReviewPath,
  readCreditReviewPage,
  readCreditReviewDetail,
} from '@sayman/web-shared/lib/credit/credit-review-contract.ts';
import {
  isCreditSubmissionPath,
  creditSubmissionBodySchema,
  creditSubmissionResultSchema,
  readCreditSubmissionResult,
  readCreditSubmissionCapabilities,
  readCreditSubmissionDetail,
  readCreditSubmissionPage,
  type CreditSubmissionCommand,
} from '@sayman/web-shared/lib/credit/credit-submission-contract.ts';
import { isCreditDocumentPath } from '@sayman/web-shared/lib/credit/credit-document-contract.ts';
import { proxyCreditDocument } from './credit-document-proxy.ts';
import { isCreditRequirementsPath } from '@sayman/web-shared/lib/credit/credit-requirements-path.ts';
import {
  acceptCreditRequirementsSchema,
  creditRequirementsCurrentSchema,
  acceptCreditRequirementsResultSchema,
  readCreditCaseRequirements,
  readCreditRequirementsResult,
  type CreditRequirementsCommand,
} from '@sayman/web-shared/lib/credit/credit-requirements-contract.ts';
import { isCreditApplicationPath } from '@sayman/web-shared/lib/credit/credit-application-path.ts';
import {
  creditApplicationCreateSchema,
  creditApplicationCancelSchema,
  creditApplicationResultSchema,
  creditPlansSchema,
  readCreditApplicationResult,
  readCreditApplicationDetail,
  readCreditApplicationPage,
  type CreditApplicationCommand,
} from '@sayman/web-shared/lib/credit/credit-application-contract.ts';
import { publicOrigin } from '../seo/seo.ts';
import type { OrderProxyEnvironment } from '../orders/order-proxy.ts';
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
class CreditCapacityError extends Error {}
async function bounded(stream: ReadableStream<Uint8Array> | null, maximum: number) {
  if (!stream) return '';
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new CreditCapacityError('Private credit capacity');
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export async function proxyCreditApplications(
  request: Request,
  path: string[],
  environment: OrderProxyEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const full = '/api/credit/' + path.join('/'),
    url = new URL(request.url),
    method = request.method;
  if (url.pathname === full && isCreditDocumentPath(full + url.search, method))
    return proxyCreditDocument(request, environment, fetcher);
  if (url.pathname !== full || !isCreditApplicationPath(full + url.search, method))
    return new Response(null, { status: 404, headers });
  const origin = publicOrigin(environment);
  let api: URL;
  try {
    api = new URL(environment.SHOP_API_URL ?? '');
    if (
      environment.SHOP_DATA_MODE !== 'api' ||
      !origin ||
      !['http:', 'https:'].includes(api.protocol) ||
      api.username ||
      api.password ||
      api.search ||
      api.hash ||
      !['', '/'].includes(api.pathname)
    )
      throw Error();
  } catch {
    return Response.json({ title: 'credit_application_unavailable' }, { status: 503, headers });
  }
  const supplied = request.headers.get('Origin');
  if ((supplied && supplied !== origin) || (method !== 'GET' && supplied !== origin))
    return new Response(null, { status: 403, headers });
  const bearer = request.headers.get('Authorization');
  if (!bearer || !/^Bearer [A-Za-z0-9._-]{20,8185}$/.test(bearer))
    return new Response(null, { status: 401, headers });
  let scopeCommand: CreditScopeCommand | undefined;
  const purchaseScope = isCreditPurchaseScopePath(full + url.search, method);
  let body: string | undefined,
    command: CreditApplicationCommand | undefined,
    requirementsCommand: CreditRequirementsCommand | undefined,
    submissionCommand: CreditSubmissionCommand | undefined;
  const requirements = isCreditRequirementsPath(full + url.search, method),
    submission = isCreditSubmissionPath(full + url.search, method);
  if (method !== 'GET') {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
      return new Response(null, { status: 415, headers });
    if (Number(request.headers.get('Content-Length')) > 8192)
      return new Response(null, { status: 413, headers });
    try {
      const raw = JSON.parse(await bounded(request.body, 8192));
      if (purchaseScope) {
        scopeCommand = {
          kind: 'Revoke',
          staff: false,
          id: path[4],
          applicationId: path[1],
          body: creditScopeRevokeBodySchema.parse(raw),
        };
        body = JSON.stringify(scopeCommand.body);
      } else if (submission) {
        submissionCommand = {
          id: path[4],
          applicationId: path[1],
          body: creditSubmissionBodySchema.parse(raw),
        };
        body = JSON.stringify(submissionCommand.body);
      } else if (requirements) {
        requirementsCommand = {
          kind: 'consent',
          id: path[3],
          applicationId: path[1],
          body: acceptCreditRequirementsSchema.parse(raw),
        };
        body = JSON.stringify(requirementsCommand.body);
      } else {
        command =
          method === 'POST'
            ? { kind: 'create', id: path[2], body: creditApplicationCreateSchema.parse(raw) }
            : {
                kind: 'cancel',
                id: path[3],
                applicationId: path[1],
                body: creditApplicationCancelSchema.parse(raw),
              };
        body = JSON.stringify(command.body);
      }
    } catch (error) {
      return Response.json(
        { title: 'invalid_credit_application' },
        { status: error instanceof CreditCapacityError ? 413 : 400, headers },
      );
    }
  }
  try {
    const response = await fetcher(api.origin + full + url.search, {
      method,
      headers: {
        Authorization: bearer,
        'Content-Type': 'application/json',
        Origin: origin!,
        'X-Sayman-Client': 'storefront',
      },
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (Number(response.headers.get('Content-Length')) > 262144) {
      await response.body?.cancel();
      throw Error('Credit response capacity');
    }
    const raw = await bounded(response.body, 262144);
    if (!response.ok) {
      let title = 'credit_application_unavailable';
      try {
        const value = JSON.parse(raw);
        if (typeof value.title === 'string' && /^[a-z_]{1,100}$/.test(value.title))
          title = value.title;
      } catch {
        /* Preserve the status-based error when the optional response body is invalid. */
      }
      return Response.json(
        { title },
        {
          status: [400, 401, 403, 404, 409, 413, 415, 429, 503].includes(response.status)
            ? response.status
            : 503,
          headers,
        },
      );
    }
    if (
      response.status !== 200 ||
      response.headers.has('Set-Cookie') ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')
    )
      throw Error('Private credit response');
    const rawValue = JSON.parse(raw);
    let value: unknown;
    if (scopeCommand) value = readCreditScopeResult(rawValue, scopeCommand);
    else if (purchaseScope) {
      if (path.length === 3) value = readCreditPurchaseScopePage(rawValue, path[1]);
      else {
        const r = creditPurchaseScopeResultSchema.parse(rawValue);
        if (
          !r.replayed ||
          r.commandId !== path[4] ||
          r.application.id !== path[1] ||
          r.kind !== 'Revoke' ||
          r.scope.revocation?.actorKind !== 'Owner'
        )
          throw Error('Wrong scope receipt');
        value = r;
      }
    } else if (isCreditReviewPath(full + url.search, method)) {
      value =
        path.length === 3
          ? readCreditReviewPage(rawValue, path[1])
          : readCreditReviewDetail(rawValue, path[1], path[3]);
    } else if (submissionCommand) value = readCreditSubmissionResult(rawValue, submissionCommand);
    else if (submission) {
      if (path[2] === 'submission') value = readCreditSubmissionCapabilities(rawValue, path[1]);
      else if (path.length === 3) value = readCreditSubmissionPage(rawValue, path[1]);
      else if (path[3] === 'commands') {
        const r = creditSubmissionResultSchema.parse(rawValue);
        if (!r.replayed || r.commandId !== path[4] || r.application.id !== path[1])
          throw Error('Wrong submission receipt');
        value = r;
      } else value = readCreditSubmissionDetail(rawValue, path[1], path[3]);
    } else if (requirementsCommand)
      value = readCreditRequirementsResult(rawValue, requirementsCommand);
    else if (requirements) {
      if (path[0] === 'requirements') value = creditRequirementsCurrentSchema.parse(rawValue);
      else if (path[2] === 'requirements') value = readCreditCaseRequirements(rawValue, path[1]);
      else {
        const receipt = acceptCreditRequirementsResultSchema.parse(rawValue);
        if (
          !receipt.replayed ||
          receipt.commandId !== path[3] ||
          receipt.application.id !== path[1]
        )
          throw Error('Wrong consent receipt');
        value = receipt;
      }
    } else if (command) value = readCreditApplicationResult(rawValue, command);
    else if (path[0] === 'plans') value = creditPlansSchema.parse(rawValue);
    else if (path[0] === 'commands') {
      const receipt = creditApplicationResultSchema.parse(rawValue);
      if (receipt.commandId !== path[1]) throw Error('Wrong credit receipt');
      value = receipt;
    } else
      value =
        path.length === 1
          ? readCreditApplicationPage(rawValue, url.searchParams.get('state'))
          : readCreditApplicationDetail(rawValue, path[1]);
    return Response.json(value, { headers });
  } catch {
    return Response.json({ title: 'credit_application_unavailable' }, { status: 503, headers });
  }
}

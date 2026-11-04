import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '@sayman/web-shared/lib/orders/rma-contract.ts';
import * as client from '@sayman/web-shared/lib/orders/rma-client.ts';
import { RmaJournal, rmaCommand } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import {
  rmaContext,
  rmaDetail,
  rmaCreateBody,
  rmaOrderId,
  rmaCommandId,
  rmaResult,
  rmaPublicPolicy,
} from '@sayman/web-shared/testing/rma.test-fixtures.ts';
const file = (path: string) => fileURLToPath(new URL(import.meta.resolve(path)));
const stateNames = {
  submitted: ['ثبت‌شده', 'Submitted'],
  reviewing: ['در حال بررسی', 'Under review'],
  reviewed: ['بررسی‌شده', 'Reviewed'],
  withdrawn: ['منصرف‌شده', 'Withdrawn'],
};
function customerSetup(locale: 'fa' | 'en' = 'fa') {
  const journal = new RmaJournal();
  journal.bind('OWNER');
  const calls: { path: string; init?: RequestInit }[] = [];
  let owner = 'OWNER';
  let response: (path: string, init?: RequestInit) => Promise<unknown> = async () => rmaResult();
  const h = digitalUiHarness(file('../components/orders/customer-returns.tsx'), {
    '../auth/auth-provider': { useCustomerSession: () => ({}) },
    '../navigation/locale-provider': { useI18n: () => ({ locale }) },
    '../shared/ui': { Button: 'Button' },
    '@sayman/web-shared/lib/orders/rma-contract.ts': contract,
    '@sayman/web-shared/lib/orders/rma-journal.ts': { customerRmaJournal: journal, rmaCommand },
    '@sayman/web-shared/lib/orders/rma-client.ts': client,
    '@sayman/web-shared/components/orders/rma-receipt-panel': { RmaReceiptPanel: 'Receipt' },
    '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
    '@sayman/web-shared/components/orders/rma-case-detail': {
      ReturnFinancialNotice: 'FinancialNotice',
      ReturnCaseDetail: 'Detail',
      returnStateNames: stateNames,
    },
  });
  const props = {
    context: rmaContext(),
    actor: 'OWNER',
    locale,
    request: async (path: string, init?: RequestInit) => {
      calls.push({ path, init: structuredClone(init) });
      return response(path, init);
    },
    current: () => owner === 'OWNER',
    onSaved() {},
  };
  function change(name: string, value: unknown, checked = false) {
    const n = uiElements(h.tree()).find((n) => n.props.name === name);
    assert.ok(n, name);
    (n.props.onChange as (e: unknown) => void)({
      target: checked ? { checked: value } : { value },
    });
    h.rerender();
  }
  function submit() {
    const n = uiElements(h.tree()).find((n) => n.type === 'form');
    assert.ok(n);
    return (n.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
  }
  return {
    h,
    journal,
    calls,
    props,
    change,
    submit,
    setOwner(v: string) {
      owner = v;
    },
    respond(fn: typeof response) {
      response = fn;
    },
  };
}
for (const locale of ['fa', 'en'] as const)
  test(`actual ${locale} customer form limits historical quantity, resets cross-kind selection and sends acknowledged PUT once`, async () => {
    const s = customerSetup(locale);
    s.h.mount('CustomerReturnCreateForm', s.props);
    s.change('return-quantity-physical', '2');
    assert.equal(
      uiElements(s.h.tree()).find((n) => n.props.name === 'return-quantity-physical')!.props.value,
      0,
    );
    s.change('return-quantity-physical', '1');
    s.change('return-reason', '  دلیل خصوصی مشتری  ');
    s.change('return-ack', true, true);
    assert.equal(
      uiElements(s.h.tree()).find((n) => n.props.type === 'submit')!.props.disabled,
      false,
    );
    s.change('return-kind', 'digitalComplaint');
    assert.equal(
      uiElements(s.h.tree()).some((n) => n.props.name === 'return-quantity-physical'),
      false,
    );
    assert.equal(
      uiElements(s.h.tree()).find((n) => n.props.name === 'return-quantity-digital')!.props.value,
      0,
    );
    assert.equal(
      uiElements(s.h.tree()).find((n) => n.props.type === 'submit')!.props.disabled,
      true,
    );
    s.change('return-kind', 'physicalReturn');
    s.change('return-quantity-physical', '1');
    s.change('return-ack', true, true);
    let resolve!: (x: unknown) => void;
    s.respond(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = s.submit();
    s.submit();
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].init?.method, 'PUT');
    const body = JSON.parse(s.calls[0].init!.body as string);
    assert.equal(body.reason, 'دلیل خصوصی مشتری');
    assert.deepEqual(body.lines, [{ lineKey: 'physical', quantity: 1 }]);
    assert.equal(body.policyRevisionId, s.props.context.policy.current!.id);
    assert.equal(body.orderVersion, s.props.context.orderVersion);
    assert.equal(body.acknowledgeNoFinancialAction, true);
    s.h.rerender();
    assert.equal(
      uiElements(s.h.tree()).find((n) => n.props.name === 'return-reason')!.props.value,
      '',
    );
    const commandId = s.journal.snapshot('OWNER')!.command.commandId;
    resolve({ ...rmaResult(), commandId });
    await pending;
    await s.h.settle();
    assert.equal(s.journal.snapshot('OWNER')!.state, 'done');
    s.h.unmount();
  });
test('actual customer form rejects after owner changes and old async response cannot populate another owner journal', async () => {
  const s = customerSetup();
  s.h.mount('CustomerReturnCreateForm', s.props);
  s.change('return-quantity-physical', '1');
  s.change('return-reason', 'دلیل خصوصی مشتری');
  s.change('return-ack', true, true);
  s.setOwner('OTHER');
  await s.submit();
  assert.equal(s.calls.length, 0);
  s.setOwner('OWNER');
  let resolve!: (x: unknown) => void;
  s.respond(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = s.submit();
  s.journal.bind('OTHER');
  s.setOwner('OTHER');
  resolve(rmaResult());
  await pending;
  await s.h.settle();
  assert.equal(s.journal.snapshot('OTHER'), null);
  s.h.unmount();
});
test('actual receipt panel performs only GET for an unknown UUID, 404 keeps ambiguity and mismatched receipt never unlocks command', async () => {
  const journal = new RmaJournal();
  journal.bind('OWNER');
  journal.begin(
    'OWNER',
    rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId),
  );
  journal.interrupt();
  const calls: RequestInit[] = [];
  let response: unknown = null;
  const h = digitalUiHarness(file('@sayman/web-shared/components/orders/rma-receipt-panel'), {
    '../../lib/orders/rma-journal': { RmaJournal },
    '../../lib/orders/rma-client': client,
  });
  h.mount('RmaReceiptPanel', {
    journal,
    actor: 'OWNER',
    locale: 'en',
    request: async (_path: string, init: RequestInit) => {
      calls.push(init);
      if (response === null) throw new client.RmaError('rma_not_found', 404);
      return response;
    },
  });
  await h.settle();
  const click = () => {
    const b = uiElements(h.tree()).find(
      (n) => n.type === 'button' && uiText(n).includes('Check this command'),
    );
    assert.ok(b);
    (b.props.onClick as () => void)();
  };
  click();
  await h.settle();
  assert.equal(journal.snapshot('OWNER')!.state, 'unknown');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(uiText(h.tree()), /does not prove/);
  response = { ...rmaResult(), commandId: '55555555555555555555555555555555' };
  click();
  await h.settle();
  assert.equal(journal.snapshot('OWNER')!.state, 'unknown');
  response = rmaResult();
  click();
  await h.settle();
  assert.equal(journal.snapshot('OWNER')!.state, 'done');
  assert.equal(
    calls.every((c) => c.method === 'GET' && !c.body),
    true,
  );
  h.unmount();
});
test('actual global guard survives section navigation, clears warning on logout, and exposes no private reason', async () => {
  const journal = new RmaJournal();
  journal.bind('OWNER');
  journal.begin(
    'OWNER',
    rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId),
  );
  journal.interrupt();
  const handlers = new Map<string, unknown>();
  const h = digitalUiHarness(
    file('@sayman/web-shared/components/orders/rma-command-guard'),
    {
      '../../lib/orders/rma-journal': { RmaJournal },
      './rma-receipt-panel': { RmaReceiptPanel: 'ReceiptPanel' },
    },
    {
      window: {
        addEventListener: (k: string, v: unknown) => handlers.set(k, v),
        removeEventListener: (k: string) => handlers.delete(k),
      },
    },
  );
  h.mount('RmaCommandGuard', { journal, actor: 'OWNER', locale: 'en', onOpen() {} });
  await h.settle();
  assert.equal(handlers.has('beforeunload'), true);
  assert.equal(uiText(h.tree()).includes('دلیل خصوصی'), false);
  h.rerender({ journal, actor: 'OWNER', locale: 'en', onOpen() {} });
  await h.settle();
  assert.equal(handlers.has('beforeunload'), true);
  journal.bind(null);
  h.rerender({ journal, actor: null, locale: 'en' });
  await h.settle();
  assert.equal(handlers.has('beforeunload'), false);
  assert.equal(uiText(h.tree()), '');
  h.unmount();
});
test('actual public policy fetch uses server window/disabled status and unavailable response never invents terms', async () => {
  let response: Response = Response.json(
    { ...rmaPublicPolicy(), windowDays: 7, enabled: false },
    { headers: { 'X-Sayman-Returns-Contract': 'rma-v1' } },
  );
  const calls: RequestInit[] = [];
  const h = digitalUiHarness(
    file('../components/orders/returns-policy.tsx'),
    {
      '../navigation/locale-provider': {
        useI18n: () => ({ locale: 'en' }),
        useStorefront: () => ({ dataSource: 'api' }),
      },
      '@sayman/web-shared/lib/orders/rma-contract.ts': contract,
      '@sayman/web-shared/lib/orders/rma-client.ts': client,
      '@sayman/web-shared/components/orders/rma-case-detail': { ReturnFinancialNotice: 'Notice' },
      '../navigation/localized-link': { default: 'Link' },
    },
    {
      fetch: async (_p: string, init: RequestInit) => {
        calls.push(init);
        return response;
      },
    },
  );
  h.mount('ReturnsPolicy', {});
  await h.settle();
  assert.match(uiText(h.tree()), /7 days/);
  assert.match(uiText(h.tree()), /New requests are disabled/);
  assert.equal(calls[0].cache, 'no-store');
  h.unmount();
  response = new Response('broken', { status: 503 });
  const g = digitalUiHarness(
    file('../components/orders/returns-policy.tsx'),
    {
      '../navigation/locale-provider': {
        useI18n: () => ({ locale: 'en' }),
        useStorefront: () => ({ dataSource: 'api' }),
      },
      '@sayman/web-shared/lib/orders/rma-contract.ts': contract,
      '@sayman/web-shared/lib/orders/rma-client.ts': client,
      '@sayman/web-shared/components/orders/rma-case-detail': { ReturnFinancialNotice: 'Notice' },
      '../navigation/localized-link': { default: 'Link' },
    },
    { fetch: async () => response },
  );
  g.mount('ReturnsPolicy', {});
  await g.settle();
  assert.match(uiText(g.tree()), /No request window/);
  assert.equal(uiText(g.tree()).includes('3 days'), false);
  g.unmount();
});
test('historical detail renders escaped plain text, exact retained policy and no customer staff-note exposure', () => {
  const d = rmaDetail(true);
  d.reason = '<img src=x onerror=alert(1)>';
  d.policy.conditionsEn = 'HISTORICAL CONDITIONS';
  d.events[0].staffNote = 'PRIVATE';
  const h = digitalUiHarness(file('@sayman/web-shared/components/orders/rma-case-detail'), {});
  h.mount('ReturnCaseDetail', { detail: d, locale: 'en', staff: false });
  assert.match(uiText(h.tree()), /HISTORICAL CONDITIONS/);
  assert.equal(uiText(h.tree()).includes('PRIVATE'), false);
  assert.equal(
    uiElements(h.tree()).some((n) => n.type === 'img' || 'dangerouslySetInnerHTML' in n.props),
    false,
  );
  h.unmount();
});

test('actual customer withdrawal uses original case CAS, explicit confirmation and one receipt-bound command', async () => {
  const s = customerSetup('en'),
    detail = rmaDetail();
  s.h.mount('CustomerReturnWithdrawForm', { ...s.props, detail });
  s.change('withdraw-reason', '  close this request  ');
  s.change('withdraw-confirm', true, true);
  s.respond(async (path) => {
    const commandId = path.split('/').at(-1)!;
    return {
      ...rmaResult(),
      commandId,
      case: {
        ...detail,
        case: {
          ...detail.case,
          state: 'withdrawn',
          isOpen: false,
          version: 'AAAAAAAAAAM=',
          changedAt: '2026-10-30T11:00:00Z',
        },
        canWithdraw: false,
        events: [
          ...detail.events,
          {
            sequence: '2',
            action: 'withdrawn',
            state: 'withdrawn',
            outcome: null,
            author: 'customer',
            at: '2026-10-30T11:00:00Z',
            message: 'close this request',
          },
        ],
      },
    };
  });
  s.submit();
  s.submit();
  await s.h.settle();
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].path, /\/withdrawals\//);
  const body = JSON.parse(s.calls[0].init!.body as string);
  assert.equal(body.version, detail.case.version);
  assert.equal(body.reason, 'close this request');
  assert.equal(body.confirmed, true);
  assert.equal(s.journal.snapshot('OWNER')!.state, 'done');
  s.h.unmount();
});

test('unverified global guard keeps only a generic boolean warning and beforeunload protection without UUID/private fields', async () => {
  const journal = new RmaJournal();
  journal.bind('OWNER');
  journal.begin(
    'OWNER',
    rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId),
  );
  journal.interrupt();
  const handlers = new Map<string, unknown>();
  const h = digitalUiHarness(
    file('@sayman/web-shared/components/orders/rma-command-guard'),
    {
      '../../lib/orders/rma-journal': { RmaJournal },
      './rma-receipt-panel': { RmaReceiptPanel: 'ReceiptPanel' },
    },
    {
      window: {
        addEventListener: (k: string, v: unknown) => handlers.set(k, v),
        removeEventListener: (k: string) => handlers.delete(k),
      },
    },
  );
  h.mount('RmaCommandGuard', {
    journal,
    actor: null,
    unverified: true,
    locale: 'en',
    request() {
      throw Error('No unverified request is allowed');
    },
  });
  await h.settle();
  assert.equal(journal.hasUnresolved(), true);
  assert.equal(handlers.has('beforeunload'), true);
  const visible = uiText(h.tree());
  assert.match(visible, /Verify your account again/);
  for (const privateValue of [rmaCommandId, rmaOrderId, 'OWNER', 'دلیل خصوصی مشتری'])
    assert.equal(visible.includes(privateValue), false);
  assert.equal(
    uiElements(h.tree()).some(
      (n) => n.type === 'code' || n.type === 'button' || n.type === 'ReceiptPanel',
    ),
    false,
  );
  journal.bind(null);
  h.rerender();
  await h.settle();
  assert.equal(journal.hasUnresolved(), false);
  assert.equal(handlers.has('beforeunload'), false);
  assert.equal(uiText(h.tree()), '');
  h.unmount();
});

test('authenticated global guard opens actual receipt recovery after section navigation and sends only the retained UUID GET', async () => {
  const journal = new RmaJournal();
  journal.bind('OWNER');
  journal.begin(
    'OWNER',
    rmaCommand('create', rmaCreateBody(), { orderId: rmaOrderId }, rmaCommandId),
  );
  journal.interrupt();
  const calls: { path: string; init?: RequestInit }[] = [];
  const request = async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return rmaResult();
  };
  const handlers = new Map<string, unknown>();
  const guard = digitalUiHarness(
    file('@sayman/web-shared/components/orders/rma-command-guard'),
    {
      '../../lib/orders/rma-journal': { RmaJournal },
      './rma-receipt-panel': { RmaReceiptPanel: 'ReceiptPanel' },
    },
    {
      window: {
        addEventListener: (k: string, v: unknown) => handlers.set(k, v),
        removeEventListener: (k: string) => handlers.delete(k),
      },
    },
  );
  guard.mount('RmaCommandGuard', { journal, actor: 'OWNER', locale: 'en', request });
  await guard.settle();
  guard.rerender({ journal, actor: 'OWNER', locale: 'en', request });
  await guard.settle();
  assert.equal(calls.length, 0);
  const track = uiElements(guard.tree()).find(
    (n) => n.type === 'button' && uiText(n).includes('Track this request'),
  );
  assert.ok(track);
  (track.props.onClick as () => void)();
  await guard.settle();
  const child = uiElements(guard.tree()).find((n) => n.type === 'ReceiptPanel');
  assert.ok(child);
  const receipt = digitalUiHarness(file('@sayman/web-shared/components/orders/rma-receipt-panel'), {
    '../../lib/orders/rma-journal': { RmaJournal },
    '../../lib/orders/rma-client': client,
  });
  receipt.mount('RmaReceiptPanel', child.props);
  await receipt.settle();
  const check = uiElements(receipt.tree()).find(
    (n) => n.type === 'button' && uiText(n).includes('Check this command'),
  );
  assert.ok(check);
  (check.props.onClick as () => void)();
  await receipt.settle();
  guard.rerender();
  await guard.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/returns/commands/${rmaCommandId}`);
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(journal.snapshot('OWNER')!.state, 'done');
  assert.equal(handlers.has('beforeunload'), false);
  assert.ok(uiElements(guard.tree()).some((n) => n.type === 'ReceiptPanel'));
  const close = uiElements(receipt.tree()).find(
    (n) => n.type === 'button' && uiText(n).includes('Close receipt'),
  );
  assert.ok(close);
  (close.props.onClick as () => void)();
  guard.rerender();
  await guard.settle();
  assert.equal(journal.snapshot('OWNER'), null);
  assert.equal(uiText(guard.tree()), '');
  receipt.unmount();
  guard.unmount();
});

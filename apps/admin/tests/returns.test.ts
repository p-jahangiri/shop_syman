import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '@sayman/web-shared/lib/orders/rma-contract.ts';
import { RmaJournal, rmaCommand } from '@sayman/web-shared/lib/orders/rma-journal.ts';
import { advanceRequestGeneration } from '@sayman/web-shared/lib/data/request-generation.ts';
import { rmaDetail, rmaPolicy, rmaResult } from '@sayman/web-shared/testing/rma.test-fixtures.ts';
const file = fileURLToPath(new URL('../src/pages/orders/returns.tsx', import.meta.url));
function setup() {
  const journal = new RmaJournal();
  journal.bind('STAFF');
  let revision = 1;
  let handler: (p: string, i?: RequestInit) => Promise<unknown> = async () => rmaResult(true);
  const calls: { path: string; init?: RequestInit }[] = [];
  const h = digitalUiHarness(file, {
    '../../styles/orders/sales-order-workspace.css': {},
    '../../api/api': {
      api: async (p: string, i?: RequestInit) => {
        calls.push({ path: p, init: structuredClone(i) });
        return handler(p, i);
      },
    },
    '../../components/tables/admin-table': { AdminTable: 'Table' },
    '../../components/ui': { Busy: 'Busy', ErrorBox: 'Error', Field: 'Field', Check: 'Check' },
    '../../auth/admin-view-authority': { adminViewRevision: () => revision },
    '@sayman/web-shared/lib/orders/rma-journal.ts': { adminRmaJournal: journal, rmaCommand },
    '@sayman/web-shared/lib/data/request-generation.ts': { advanceRequestGeneration },
    '@sayman/web-shared/lib/orders/rma-contract.ts': contract,
    '@sayman/web-shared/components/orders/rma-receipt-panel': { RmaReceiptPanel: 'Receipt' },
    '@sayman/web-shared/components/orders/rma-case-detail': {
      ReturnCaseDetail: 'Detail',
      ReturnFinancialNotice: 'Notice',
      returnStateNames: {
        submitted: ['ثبت‌شده', 'Submitted'],
        reviewing: ['در حال بررسی', 'Under review'],
        reviewed: ['بررسی‌شده', 'Reviewed'],
        withdrawn: ['منصرف‌شده', 'Withdrawn'],
      },
    },
  });
  function change(name: string, v: unknown, checked = false) {
    const n = uiElements(h.tree()).find((n) => n.props.name === name);
    assert.ok(n, name);
    (n.props.onChange as (e: unknown) => void)({ target: checked ? { checked: v } : { value: v } });
    h.rerender();
  }
  function submit() {
    const n = uiElements(h.tree()).find((n) => n.type === 'form');
    assert.ok(n);
    (n.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  }
  return {
    h,
    journal,
    calls,
    change,
    submit,
    setRevision() {
      revision++;
    },
    respond(fn: typeof handler) {
      handler = fn;
    },
  };
}
test('actual admin policy edit preserves CAS, strips irrelevant window days, distinguishes return cap and creates one immutable PUT', async () => {
  const s = setup();
  s.h.mount('RmaPolicyForm', {
    policy: {
      schemaVersion: 1,
      current: rmaPolicy(),
      canRefund: false,
      refundAvailability: 'provider_unconfigured',
    },
    viewerId: 'STAFF',
    onSaved() {},
  });
  s.change('rma-window-mode', 'manualReview');
  assert.equal(
    uiElements(s.h.tree()).some((n) => n.props.name === 'rma-window-days'),
    false,
  );
  s.change('rma-open-cap', '5');
  s.change('rma-policy-note', '  private policy note  ');
  s.change('rma-policy-confirm', true, true);
  let resolve!: (x: unknown) => void;
  s.respond(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  s.submit();
  s.submit();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].init?.method, 'PUT');
  const body = JSON.parse(s.calls[0].init!.body as string);
  assert.equal(body.version, rmaPolicy().version);
  assert.equal(body.windowDays, null);
  assert.equal(body.maxOpenPerOwner, 5);
  assert.equal(body.note, 'private policy note');
  assert.match(uiText(s.h.tree()), /نسخهٔ جدید/);
  assert.equal(s.journal.snapshot('STAFF')!.state, 'pending');
  const commandId = s.journal.snapshot('STAFF')!.command.commandId;
  resolve({
    schemaVersion: 1,
    commandId,
    replayed: false,
    policy: {
      schemaVersion: 1,
      current: {
        ...rmaPolicy(),
        revision: 2,
        version: 'AAAAAAAAAAI=',
        windowMode: 'manualReview',
        windowDays: null,
        maxOpenPerOwner: 5,
      },
      canRefund: false,
      refundAvailability: 'provider_unconfigured',
    },
  });
  await s.h.settle();
  assert.equal(s.journal.snapshot('STAFF')!.state, 'done');
  assert.equal(s.journal.snapshot('STAFF')!.command.body, null);
  s.h.unmount();
});
test('actual admin review maps start/complete outcome, owner/CAS/private and customer fields; authorization switch prevents mutation', async () => {
  const s = setup(),
    detail = rmaDetail(true);
  s.h.mount('RmaReviewForm', { detail, viewerId: 'STAFF', onSaved() {} });
  s.change('rma-private-note', '  note for staff  ');
  s.change('rma-customer-message', '  customer sees this  ');
  s.change('rma-review-ack', true, true);
  s.setRevision();
  s.submit();
  assert.equal(s.calls.length, 0);
  s.h.unmount();
  const t = setup();
  t.h.mount('RmaReviewForm', { detail, viewerId: 'STAFF', onSaved() {} });
  t.change('rma-private-note', 'note for staff');
  t.change('rma-customer-message', 'customer sees this');
  t.change('rma-review-ack', true, true);
  t.respond(async () => {
    throw { status: 503, code: 'rma_unavailable' };
  });
  t.submit();
  await t.h.settle();
  assert.equal(t.calls.length, 1);
  const body = JSON.parse(t.calls[0].init!.body as string);
  assert.equal(body.action, 'startReview');
  assert.equal(body.outcome, null);
  assert.equal(body.ownerId, 'CUSTOMER');
  assert.equal(body.version, detail.case.version);
  assert.equal(body.note, 'note for staff');
  assert.equal(body.customerMessage, 'customer sees this');
  assert.equal(t.journal.snapshot('STAFF')!.state, 'unknown');
  t.submit();
  assert.equal(t.calls.length, 1);
  t.h.unmount();
  const u = setup();
  const reviewing = { ...detail, case: { ...detail.case, state: 'reviewing' } };
  u.h.mount('RmaReviewForm', { detail: reviewing, viewerId: 'STAFF', onSaved() {} });
  u.change('rma-outcome', 'declined');
  u.change('rma-private-note', 'reviewed note');
  u.change('rma-review-ack', true, true);
  u.respond(async () => {
    throw { status: 409, code: 'rma_version_conflict' };
  });
  u.submit();
  await u.h.settle();
  const completed = JSON.parse(u.calls[0].init!.body as string);
  assert.equal(completed.action, 'completeReview');
  assert.equal(completed.outcome, 'declined');
  assert.equal(completed.customerMessage, null);
  assert.equal(u.journal.snapshot('STAFF')!.state, 'rejected');
  u.h.unmount();
});
test('actual admin page provides server state filter, retained loaded-row table controls and blocks private detail for read-only staff', async () => {
  const s = setup();
  s.respond(async (path) =>
    path === '/admin/returns/policy'
      ? {
          schemaVersion: 1,
          current: rmaPolicy(),
          canRefund: false,
          refundAvailability: 'provider_unconfigured',
        }
      : path.startsWith('/admin/returns/policy/history')
        ? { schemaVersion: 1, items: [rmaPolicy()], nextBefore: null }
        : { schemaVersion: 1, items: [rmaDetail(true).case], nextCursor: null },
  );
  s.h.mount('default', { viewerId: 'STAFF', writable: false });
  await s.h.settle();
  assert.match(uiText(s.h.tree()), /راهنمای مدیر/);
  assert.match(uiText(s.h.tree()), /RMA-1/);
  const table = uiElements(s.h.tree()).find((n) => n.type === 'Table');
  assert.ok(table);
  assert.equal(table.props.pageable, true);
  const detailButton = uiElements(s.h.tree()).find(
    (n) => n.type === 'button' && uiText(n) === 'جزئیات و بررسی',
  );
  assert.ok(detailButton);
  assert.equal(detailButton.props.disabled, true);
  s.change('rma-state', 'reviewing');
  await s.h.settle();
  assert.equal(
    s.calls.some((c) => c.path === '/admin/returns?state=reviewing'),
    true,
  );
  assert.equal(s.calls.filter((c) => c.path === '/admin/returns/policy').length, 1);
  assert.equal(s.calls.filter((c) => c.path === '/admin/returns/policy/history').length, 1);
  assert.equal(
    s.calls.some((c) => c.path.includes('/CUSTOMER/')),
    false,
  );
  s.h.unmount();
});

test('a return-policy read failure leaves the operations queue available', async () => {
  const s = setup();
  s.respond(async (path) => {
    if (path === '/admin/returns/policy') throw Error('Temporary policy failure');
    if (path.startsWith('/admin/returns/policy/history'))
      return { schemaVersion: 1, items: [], nextBefore: null };
    return { schemaVersion: 1, items: [rmaDetail(true).case], nextCursor: null };
  });
  s.h.mount('default', { viewerId: 'STAFF', writable: true });
  await s.h.settle();
  assert.match(uiText(s.h.tree()), /RMA-1/);
  const detailButton = uiElements(s.h.tree()).find(
    (n) => n.type === 'button' && uiText(n) === 'جزئیات و بررسی',
  );
  assert.equal(detailButton?.props.disabled, false);
  s.h.unmount();
});

test('actual admin review accepts only matching resulting state/action/private note and customer message', async () => {
  const s = setup(),
    detail = rmaDetail(true);
  s.h.mount('RmaReviewForm', { detail, viewerId: 'STAFF', onSaved() {} });
  s.change('rma-private-note', 'private review note');
  s.change('rma-customer-message', 'we are reviewing');
  s.change('rma-review-ack', true, true);
  s.respond(async (path) => ({
    ...rmaResult(true),
    commandId: path.split('/').at(-1)!,
    case: {
      ...detail,
      case: {
        ...detail.case,
        state: 'reviewing',
        version: 'AAAAAAAAAAM=',
        changedAt: '2026-10-30T11:00:00Z',
      },
      events: [
        ...detail.events,
        {
          sequence: '2',
          action: 'startReview',
          state: 'reviewing',
          outcome: null,
          author: 'staff',
          at: '2026-10-30T11:00:00Z',
          message: 'we are reviewing',
          staffNote: 'private review note',
        },
      ],
    },
  }));
  s.submit();
  await s.h.settle();
  assert.equal(s.journal.snapshot('STAFF')!.state, 'done');
  assert.equal(s.journal.snapshot('STAFF')!.command.body, null);
  s.h.unmount();
});

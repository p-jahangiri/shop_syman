import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
  type TestElement,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '../src/api/contracts/settings/sms-workspace-contract.ts';
import * as attempts from '../src/state/settings/sms-settings-attempt.ts';
import type { SmsWorkspace } from '../src/api/contracts/settings/sms-workspace-contract.ts';
const connection = 'd6900000000000000000000000000001',
  template = 'd6900000000000000000000000000002';
function workspace(): SmsWorkspace {
  return {
    schemaVersion: 1,
    version: 'AAAAAAAAAAE=',
    otp: {
      lifetimeSeconds: 300,
      resendSeconds: 60,
      maxAttempts: 5,
      phoneHourlyLimit: 5,
      phoneDailyLimit: 20,
      globalHourlyLimit: 100,
      globalDailyLimit: 1000,
      notificationHourlyLimit: 100,
      notificationDailyLimit: 1000,
      genericName: 'کاربر سایمان',
    },
    connections: [
      {
        id: connection,
        name: 'اصلی',
        provider: 'smsIr',
        mode: 'live',
        enabled: true,
        keyConfigured: true,
      },
    ],
    templates: [
      {
        id: template,
        name: 'ورود',
        kind: 'otp',
        connectionId: connection,
        providerTemplate: '170274',
        approved: true,
        previewText: 'سلام #NAME# کد #CODE#',
        parameters: [
          { name: 'CODE', source: 'code', constant: null },
          { name: 'NAME', source: 'genericName', constant: null },
        ],
      },
    ],
    routes: contract.smsEvents.map((event) => ({
      event,
      enabled: event === 'otp',
      templateId: event === 'otp' ? template : null,
      enabledSince: event === 'otp' ? '2026-11-01T00:00:00Z' : null,
    })),
  };
}
test('workspace metadata is strict and never admits keys or unknown sources', () => {
  assert.deepEqual(contract.readSmsWorkspace(workspace()), workspace());
  assert.throws(() => contract.readSmsWorkspace({ ...workspace(), apiKey: 'synthetic-secret' }));
  const value = workspace();
  (value.connections[0] as unknown as Record<string, unknown>).apiKey = 'synthetic-secret';
  assert.throws(() => contract.readSmsWorkspace(value));
});
test('a new route can be enabled in a draft without forging its server activation time', () => {
  const value = workspace();
  value.routes[0].enabled = false;
  value.routes[0].enabledSince = null;
  const command = contract.smsWorkspaceCommand(
    {
      ...value,
      routes: value.routes.map((r) => (r.event === 'otp' ? { ...r, enabled: true } : r)),
    },
    'd6900000000000000000000000000003',
    {},
    {},
  );
  assert.equal(command.routes[0].enabled, true);
  assert.ok(!('enabledSince' in command.routes[0]));
});
test('key replacement is transient and omission preserves stored keys', () => {
  const kept = contract.smsWorkspaceCommand(
    workspace(),
    'd6900000000000000000000000000003',
    {},
    {},
  );
  assert.ok(!('apiKey' in kept.connections[0]));
  assert.throws(() =>
    contract.smsWorkspaceCommand(
      workspace(),
      'd6900000000000000000000000000003',
      { [connection]: 'replace' },
      {},
    ),
  );
  const replaced = contract.smsWorkspaceCommand(
    workspace(),
    'd6900000000000000000000000000003',
    { [connection]: 'replace' },
    { [connection]: 'synthetic-new-key' },
  );
  assert.equal(replaced.connections[0].apiKey, 'synthetic-new-key');
});
test('receipt matching checks actual metadata and key action without key readback', () => {
  const command = contract.smsWorkspaceCommand(
    workspace(),
    'd6900000000000000000000000000003',
    {},
    {},
  );
  assert.doesNotThrow(() =>
    contract.readSmsWorkspaceReceipt(
      { ...workspace(), version: 'AAAAAAAAAAI=' },
      command,
      workspace(),
    ),
  );
  assert.throws(() =>
    contract.readSmsWorkspaceReceipt(
      { ...workspace(), version: 'AAAAAAAAAAI=', connections: [] },
      command,
      workspace(),
    ),
  );
});
test('preview resolves only known variable bindings and never mutates approved provider templates', () => {
  const value = workspace();
  assert.equal(
    contract.smsSamplePreview(value.templates[0], 'نام عمومی', 300),
    'سلام نام عمومی کد 123456',
  );
  assert.equal(value.templates[0].previewText, 'سلام #NAME# کد #CODE#');
  assert.equal(
    contract.smsSamplePreview(
      {
        ...value.templates[0],
        previewText: '#EXPIRY#',
        parameters: [{ name: 'EXPIRY', source: 'expiryMinutes', constant: null }],
      },
      'نام عمومی',
      61,
    ),
    '1.02',
  );
  assert.ok(!contract.smsAllowedSources('otp').includes('customerName'));
  assert.ok(!contract.smsAllowedSources('chequeReminder').includes('orderStatus'));
  assert.ok(contract.smsAllowedSources('orderShipped').includes('trackingCode'));
});
let serial = 0;
function form(initial = workspace()) {
  let revision = 0,
    saved = 0;
  const viewerId = 'workspace-viewer-' + ++serial,
    requests: { path: string; init: { body: string; method: string } }[] = [];
  let transport = async (_path: string, init: { body: string }) => {
    const command = JSON.parse(init.body);
    return {
      ...workspace(),
      version: 'AAAAAAAAAAI=',
      otp: command.otp,
      connections: command.connections.map(
        ({ keyAction: _action, apiKey: _key, ...c }: Record<string, unknown>) => ({
          ...c,
          keyConfigured: true,
        }),
      ),
      templates: command.templates,
      routes: command.routes.map((r: Record<string, unknown>) => ({
        ...r,
        enabledSince: r.enabled ? '2026-11-01T00:00:00Z' : null,
      })),
    };
  };
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/pages/settings/sms-workspace.tsx', import.meta.url)),
    {
      '@tanstack/react-query': { useQuery: () => ({ isPending: true }) },
      '../../api/api': {
        api: (path: string, init: { body: string; method: string }) => {
          requests.push({ path, init });
          return transport(path, init);
        },
        ApiError: class extends Error {},
      },
      '../../auth/admin-view-authority': { adminViewRevision: () => revision },
      '../../components/ui': { Busy: 'Busy', Check: 'Check', ErrorBox: 'ErrorBox', Field: 'Field' },
      '../../api/contracts/settings/sms-workspace-contract': contract,
      '../../state/settings/sms-settings-attempt': attempts,
      '../../styles/settings/sms-workspace.css': {},
    },
    { structuredClone },
  );
  h.mount('SmsWorkspaceForm', {
    initial,
    viewerId,
    blocked: false,
    onOutcome() {},
    onSaved() {
      saved++;
    },
  });
  const node = (type: unknown, label?: string): TestElement => {
    const item = uiElements(h.tree()).find(
      (n) =>
        n.type === type &&
        (!label ||
          uiText(n) === label ||
          n.props.label === label ||
          n.props['aria-label'] === label),
    );
    assert.ok(item, String(type) + ':' + label);
    return item;
  };
  const control = (label: string) => {
    const item = uiElements(node('Field', label).props.children).find((n) =>
      ['input', 'select', 'textarea'].includes(String(n.type)),
    );
    assert.ok(item);
    return item;
  };
  const change = async (label: string, value: string) => {
    (control(label).props.onChange as (e: unknown) => void)({ target: { value } });
    await h.settle();
  };
  const click = async (label: string) => {
    (node('button', label).props.onClick as () => void)();
    await h.settle();
  };
  const submit = async () => {
    (node('form').props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
    await h.settle();
  };
  return {
    h,
    node,
    control,
    change,
    click,
    submit,
    requests,
    viewerId,
    get saved() {
      return saved;
    },
    setTransport(value: typeof transport) {
      transport = value;
    },
    changeRevision() {
      revision++;
    },
  };
}
test('actual workspace form exposes both providers and editable OTP windows', async () => {
  const s = form();
  assert.match(uiText(s.control('سرویس‌دهنده')), /SMS.irکاوه‌نگار/);
  await s.click('قواعد ورود');
  assert.equal(s.control('اعتبار کد (ثانیه)').props.value, 300);
  await s.change('اعتبار کد (ثانیه)', '240');
  await s.submit();
  assert.equal(s.requests.length, 1);
  assert.equal(JSON.parse(s.requests[0].init.body).otp.lifetimeSeconds, 240);
  assert.equal(s.saved, 1);
  s.h.unmount();
});
test('transient secret is cleared after save and never copied into attempt metadata', async () => {
  const s = form();
  await s.change('عملیات کلید', 'replace');
  const input = s.control('کلید تازه'),
    element = { value: 'synthetic-private-key' };
  (input.props.ref as (n: unknown) => void)(element);
  (input.props.onChange as (e: unknown) => void)({ target: element });
  await s.submit();
  assert.equal(s.requests.length, 1);
  assert.equal(element.value, '');
  assert.ok(
    !JSON.stringify(attempts.smsSettingsAttempt(s.viewerId)).includes('synthetic-private-key'),
  );
  assert.equal(s.saved, 1);
  s.h.unmount();
});
test('uncertain save never automatically repeats or retains its key body', async () => {
  const s = form();
  s.setTransport(async () => {
    throw new TypeError('network failed');
  });
  await s.change('نام اتصال', 'تغییر');
  await s.submit();
  assert.equal(s.requests.length, 1);
  assert.equal(attempts.smsSettingsAttempt(s.viewerId)?.outcome, 'unknown');
  assert.equal(s.saved, 0);
  s.h.unmount();
});
test('stale viewer cannot submit a settings command', async () => {
  const s = form();
  await s.change('نام اتصال', 'تغییر');
  s.changeRevision();
  await s.submit();
  assert.equal(s.requests.length, 0);
  s.h.unmount();
});
test('Kavenegar preview supports its actual percent markers without prefix collisions or recursive substitution', () => {
  const t = workspace().templates[0];
  t.previewText = '%token / %token10 / %token200 / #UNKNOWN#';
  t.parameters = [
    { name: 'token', source: 'code', constant: null },
    { name: 'token10', source: 'constant', constant: '#CODE# ثابت' },
  ];
  assert.equal(
    contract.smsSamplePreview(t, 'نام عمومی', 300),
    '123456 / #CODE# ثابت / %token200 / #UNKNOWN#',
  );
});
test('changing template kind preserves constant bindings and clears incompatible active routes', async () => {
  const initial = workspace();
  initial.templates[0].parameters.push({ name: 'BRAND', source: 'constant', constant: 'Sayman' });
  const s = form(initial);
  await s.click('قالب‌ها و متغیرها');
  await s.change('کاربرد', 'orderCreated');
  const constant = uiElements(s.h.tree()).find(
    (n) => n.type === 'input' && n.props.value === 'Sayman',
  );
  assert.ok(constant);
  await s.submit();
  assert.equal(s.requests.length, 1);
  const command = JSON.parse(s.requests[0].init.body);
  assert.equal(
    command.templates[0].parameters.find((p: { name: string }) => p.name === 'BRAND').constant,
    'Sayman',
  );
  assert.deepEqual(
    command.routes.find((r: { event: string }) => r.event === 'otp'),
    { event: 'otp', enabled: false, templateId: null },
  );
  s.h.unmount();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  digitalUiHarness,
  uiElements,
  uiText,
  type TestElement,
} from '@sayman/web-shared/testing/digital-ui.test-harness.ts';
import * as contract from '../src/api/contracts/settings/sms-settings-contract.ts';
import * as attempts from '../src/state/settings/sms-settings-attempt.ts';
import type { SmsSettings } from '../src/api/contracts/settings/sms-settings-contract.ts';

function settings(): SmsSettings {
  return {
    schemaVersion: 1,
    version: 'AAAAAAAAAAE=',
    provider: 'smsIr',
    enabled: true,
    mode: 'live',
    templateId: 170274,
    codeParameterName: 'CODE',
    nameParameterName: 'NAME',
    genericName: 'کاربر سایمان',
    keyConfigured: true,
    otpLifetimeSeconds: 300,
    resendAfterSeconds: 60,
    maxAttempts: 5,
    availability: 'configured',
  };
}
class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code = '') {
    super('Unsafe synthetic detail must never appear');
    this.status = status;
    this.code = code;
  }
}
type Query = {
  queryKey: unknown[];
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
  gcTime: number;
  retry: boolean;
  staleTime: number;
};
let serial = 0;
function setup(component: 'SmsSettingsForm' | 'SmsSettingsPage' = 'SmsSettingsForm') {
  let revision = 0,
    option: Query,
    saved = 0,
    outcomes = 0;
  const viewerId = 'sms-owner-' + ++serial;
  const requests: {
    path: string;
    init: { method?: string; body?: string; signal?: AbortSignal };
  }[] = [];
  const views = new Map<string, Record<string, unknown>>();
  let transport: (
    path: string,
    init: { method?: string; body?: string; signal?: AbortSignal },
  ) => Promise<unknown> = async (_path, init) => {
    if (!init.body) return settings();
    const input = JSON.parse(init.body);
    const keyConfigured = input.apiKeyAction !== 'clear';
    return {
      ...settings(),
      enabled: input.enabled,
      mode: input.mode,
      templateId: input.templateId,
      codeParameterName: input.codeParameterName,
      nameParameterName: input.nameParameterName,
      genericName: input.genericName,
      keyConfigured,
      availability: !keyConfigured
        ? 'unconfigured'
        : !input.enabled
          ? 'disabled'
          : input.mode === 'sandbox'
            ? 'sandbox'
            : 'configured',
    };
  };
  const props = {
    initial: settings(),
    viewerId,
    blocked: false,
    onSaved() {
      saved++;
    },
    onOutcome() {
      outcomes++;
    },
  };
  const h = digitalUiHarness(
    fileURLToPath(new URL('../src/features/settings/sms-settings.tsx', import.meta.url)),
    {
      '@tanstack/react-query': {
        useQuery(value: Query) {
          option = value;
          return views.get(JSON.stringify(value.queryKey)) ?? { isPending: true, isFetching: true };
        },
      },
      '../../api/api': {
        api: (path: string, init: { method?: string; body?: string; signal?: AbortSignal }) => {
          requests.push({ path, init });
          return transport(path, init);
        },
        ApiError,
      },
      '../../auth/admin-view-authority': { adminViewRevision: () => revision },
      '../../api/contracts/settings/sms-settings-contract': contract,
      '../../state/settings/sms-settings-attempt': attempts,
      '../../styles/settings/sms-settings.css': {},
      '../../components/ui': { Busy: 'Busy', Check: 'Check', ErrorBox: 'ErrorBox', Field: 'Field' },
    },
  );
  h.mount(component, props);
  const node = (type: unknown, label?: string): TestElement => {
    const found = uiElements(h.tree()).find(
      (v) =>
        v.type === type &&
        (!label ||
          uiText(v) === label ||
          v.props.label === label ||
          v.props['aria-label'] === label),
    );
    assert.ok(found, String(type) + ': ' + label);
    return found;
  };
  const control = (label: string) => {
    const found = uiElements(node('Field', label).props.children).find(
      (v) => v.type === 'input' || v.type === 'select',
    );
    assert.ok(found);
    return found;
  };
  const change = async (label: string, value: string) => {
    (control(label).props.onChange as (e: unknown) => void)({ target: { value } });
    await h.settle();
  };
  const submit = () => {
    (node('form').props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  };
  const secret = async () => {
    await change('عملیات کلید', 'replace');
    const input = control('کلید جدید API');
    const element = { value: 'synthetic-key-not-a-real-credential' };
    (input.props.ref as { current: unknown }).current = element;
    (input.props.onChange as (e: unknown) => void)({ target: element });
    return { input, element };
  };
  return {
    h,
    props,
    viewerId,
    requests,
    node,
    control,
    change,
    submit,
    secret,
    options: () => option,
    saved: () => saved,
    outcomes: () => outcomes,
    epoch: () => revision++,
    transport: (next: typeof transport) => {
      transport = next;
    },
    show: async (view: Record<string, unknown>) => {
      views.set(JSON.stringify(option.queryKey), view);
      h.rerender(props);
      await h.settle();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('actual SMS form is compact, has an empty uncontrolled secret and keep never carries a key', async () => {
  const s = setup();
  await s.h.settle();
  assert.equal(uiElements(s.h.tree()).filter((v) => v.type === 'form').length, 1);
  assert.equal(uiElements(s.h.tree()).filter((v) => v.type === 'table').length, 0);
  assert.match(uiText(s.h.tree()), /کدهای ورود در انتظار را باطل/);
  assert.match(uiText(s.h.tree()), /تأیید اتصال/);
  assert.match(uiText(s.h.tree()), /وضعیت تأیید قالب را در پنل SMS.ir بررسی کنید/);
  assert.equal(uiText(s.h.tree()).includes('رد شده است'), false);
  await s.change('شناسهٔ قالب تأییدشده', '170275');
  assert.match(uiText(s.h.tree()), /وضعیت تأیید قالب را در پنل SMS.ir بررسی کنید/);
  s.submit();
  await s.h.settle();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].path, '/admin/sms/settings');
  assert.equal(s.requests[0].init.method, 'PUT');
  assert.equal('apiKey' in JSON.parse(s.requests[0].init.body!), false);
  assert.equal(s.saved(), 1);
  const t = setup();
  await t.h.settle();
  const { input } = await t.secret();
  assert.equal(input.props.type, 'password');
  assert.equal(input.props.autoComplete, 'off');
  assert.equal('value' in input.props, false);
  assert.equal('defaultValue' in input.props, false);
  assert.equal(uiText(t.h.tree()).includes('synthetic-key-not-a-real-credential'), false);
});
test('replacement sends only once, clears the input after settlement and retains no secret command in recovery metadata', async () => {
  const s = setup();
  await s.h.settle();
  const { element } = await s.secret(),
    wait = deferred<unknown>();
  s.transport(async () => wait.promise);
  s.submit();
  s.submit();
  await s.h.settle();
  assert.equal(s.requests.length, 1);
  const command = JSON.parse(s.requests[0].init.body!);
  assert.equal(command.apiKey, 'synthetic-key-not-a-real-credential');
  assert.equal(
    JSON.stringify(attempts.smsSettingsAttempt(s.viewerId)).includes(command.apiKey),
    false,
  );
  wait.resolve(settings());
  await s.h.settle();
  assert.equal(element.value, '');
  assert.equal(attempts.smsSettingsAttempt(s.viewerId)?.outcome, 'confirmed');
  assert.equal(s.saved(), 1);
});
test('clear requires explicit acknowledgement and changing key action or mode erases entered key', async () => {
  const s = setup();
  await s.h.settle();
  const { element } = await s.secret();
  await s.change('حالت سرویس', 'sandbox');
  assert.equal(element.value, '');
  assert.equal(s.control('شناسهٔ قالب تأییدشده').props.value, '123456');
  assert.equal(s.control('نام پارامتر کد').props.value, 'Code');
  await s.change('عملیات کلید', 'clear');
  s.submit();
  await s.h.settle();
  assert.equal(s.requests.length, 0);
  (
    s.node('Check', 'حذف کلید و قطع ارسال وابسته به آن را تأیید می‌کنم').props.onChange as (
      event: unknown,
    ) => void
  )({ target: { checked: true } });
  await s.h.settle();
  s.submit();
  await s.h.settle();
  const input = JSON.parse(s.requests[0].init.body!);
  assert.equal(input.apiKeyAction, 'clear');
  assert.equal('apiKey' in input, false);
  assert.equal(input.nameParameterName, null);
  assert.equal(input.genericName, '');
  assert.equal(s.saved(), 1);
});
test('live sandbox template fails locally without a request or leaking the entered key', async () => {
  const s = setup();
  await s.h.settle();
  const { element } = await s.secret();
  await s.change('شناسهٔ قالب تأییدشده', '123456');
  s.submit();
  await s.h.settle();
  assert.equal(s.requests.length, 0);
  assert.equal(element.value, '');
  assert.match((s.node('ErrorBox').props.error as Error).message, /شناسهٔ قالب/);
});
test('conflict and network uncertainty never retry a key and require a fresh metadata read', async () => {
  for (const failure of [
    new ApiError(409, 'sms_settings_conflict'),
    new Error('provider echoed synthetic-key-not-a-real-credential'),
  ]) {
    const s = setup();
    await s.h.settle();
    const { element } = await s.secret();
    s.transport(async () => {
      throw failure;
    });
    s.submit();
    await s.h.settle();
    assert.equal(s.requests.length, 1);
    assert.equal(element.value, '');
    assert.equal(s.saved(), 0);
    const attempt = attempts.smsSettingsAttempt(s.viewerId)!;
    assert.equal(attempt.needsRefresh, true);
    assert.equal(attempt.outcome, failure instanceof ApiError ? 'conflict' : 'unknown');
    assert.equal(
      (s.node('ErrorBox').props.error as Error).message.includes(
        'synthetic-key-not-a-real-credential',
      ),
      false,
    );
    s.h.rerender({ ...s.props, blocked: true });
    s.submit();
    await s.h.settle();
    assert.equal(s.requests.length, 1);
  }
});
test('unmount or a changed session cannot accept a late successful write', async () => {
  for (const mode of ['unmount', 'epoch']) {
    const s = setup();
    await s.h.settle();
    const { element } = await s.secret(),
      wait = deferred<unknown>();
    s.transport(async () => wait.promise);
    s.submit();
    await s.h.settle();
    if (mode === 'unmount') s.h.unmount();
    else s.epoch();
    wait.resolve(settings());
    await s.h.settle();
    assert.equal(element.value, '');
    assert.equal(s.saved(), 0);
    assert.equal(attempts.smsSettingsAttempt(s.viewerId)?.outcome, 'unknown');
  }
});
test('the latest blocked prop prevents stale submit even before a native disabled fieldset can act', async () => {
  const s = setup();
  await s.h.settle();
  const submit = s.node('form').props.onSubmit as (e: unknown) => void;
  s.h.rerender({ ...s.props, blocked: true });
  submit({ preventDefault() {} });
  await s.h.settle();
  assert.equal(s.requests.length, 0);
});
test('the page has private abortable zero-retention reads; authoritative 403 cannot render settings', async () => {
  const s = setup('SmsSettingsPage');
  await s.h.settle();
  const query = s.options();
  assert.equal(query.gcTime, 0);
  assert.equal(query.staleTime, Infinity);
  assert.equal(query.retry, false);
  const signal = new AbortController().signal;
  await query.queryFn({ signal });
  assert.equal(s.requests[0].init.signal, signal);
  await s.show({ isPending: false, isFetching: false, error: new ApiError(403) });
  assert.ok(s.node('ErrorBox'));
  assert.equal(
    uiElements(s.h.tree()).some(
      (v) => typeof v.type === 'function' && v.type.name === 'SmsSettingsForm',
    ),
    false,
  );
  assert.ok(s.node('button', 'دریافت دوبارهٔ تنظیمات پیامک'));
});
test('a stale generation, changed owner, aborted signal or changed session cannot accept a late read', async () => {
  for (const mode of ['refresh', 'owner', 'abort', 'epoch', 'unmount']) {
    const s = setup('SmsSettingsPage');
    await s.h.settle();
    const wait = deferred<unknown>();
    s.transport(async () => wait.promise);
    const stop = new AbortController(),
      pending = s.options().queryFn({ signal: stop.signal });
    const rejected = assert.rejects(pending, /نشست فعلی/);
    if (mode === 'refresh') {
      await s.show({ isPending: false, isFetching: false, data: settings() });
      (s.node('button', 'بازخوانی تنظیمات جاری').props.onClick as () => void)();
      await s.h.settle();
    } else if (mode === 'owner') s.h.rerender({ ...s.props, viewerId: 'other-owner' });
    else if (mode === 'abort') stop.abort();
    else if (mode === 'epoch') s.epoch();
    else s.h.unmount();
    wait.resolve(settings());
    await rejected;
  }
});
test('a background or earlier read cannot unlock an uncertain key write; explicit refresh preserves unknown outcome', async () => {
  const s = setup('SmsSettingsPage');
  await s.h.settle();
  attempts.beginSmsSettingsAttempt({
    viewerId: s.viewerId,
    requestId: 'c'.repeat(32),
    baseVersion: settings().version,
    action: 'replace',
  });
  attempts.finishSmsSettingsAttempt(s.viewerId, 'c'.repeat(32), 'unknown');
  await s.show({ isPending: false, isFetching: false, data: settings() });
  assert.equal(attempts.smsSettingsAttempt(s.viewerId)?.needsRefresh, true);
  assert.match(uiText(s.h.tree()), /نتیجهٔ ذخیره قطعی نیست/);
  (s.node('button', 'بازخوانی تنظیمات جاری').props.onClick as () => void)();
  await s.h.settle();
  await s.show({ isPending: false, isFetching: false, data: settings() });
  assert.equal(attempts.smsSettingsAttempt(s.viewerId)?.needsRefresh, false);
  assert.equal(attempts.smsSettingsAttempt(s.viewerId)?.outcome, 'unknown');
  assert.match(uiText(s.h.tree()), /رسید قطعی درخواست قبلی نیست/);
});

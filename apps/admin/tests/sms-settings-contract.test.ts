import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSmsSettings,
  readSmsSettingsReceipt,
  smsSettingsCommand,
  smsSettingsCommandSchema,
  smsSettingsDraft,
  smsSettingsSchema,
  type SmsSettings,
} from '../src/api/contracts/settings/sms-settings-contract.ts';

export function settings(overrides: Partial<SmsSettings> = {}): SmsSettings {
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
    ...overrides,
  };
}
const id = 'a'.repeat(32);
test('SMS metadata is exact and rejects secret or extra fields at the public boundary', () => {
  assert.deepEqual(readSmsSettings(settings()), settings());
  for (const raw of [
    null,
    [],
    { ...settings(), apiKey: 'synthetic-only' },
    { ...settings(), protectedApiKey: 'opaque' },
    { ...settings(), provider: 'other' },
    { ...settings(), otpLifetimeSeconds: 60 },
    { ...settings(), version: 'AAAAAAAAAAF=' },
    { ...settings(), version: undefined },
  ]) {
    assert.equal(smsSettingsSchema.safeParse(raw).success, false);
    assert.throws(
      () => readSmsSettings(raw),
      (e: unknown) =>
        e instanceof Error &&
        /تنظیمات پیامک/.test(e.message) &&
        !e.message.includes('synthetic-only'),
    );
  }
});
test('availability is configuration-only and follows key, enabled and sandbox priority', () => {
  for (const [keyConfigured, enabled, mode, availability] of [
    [false, false, 'live', 'unconfigured'],
    [false, true, 'sandbox', 'unconfigured'],
    [true, false, 'sandbox', 'disabled'],
    [true, true, 'sandbox', 'sandbox'],
    [true, true, 'live', 'configured'],
  ] as const) {
    const raw = settings({
      keyConfigured,
      enabled,
      mode,
      availability,
      ...(mode === 'sandbox'
        ? {
            templateId: 123456,
            codeParameterName: 'Code',
            nameParameterName: null,
            genericName: '',
          }
        : {}),
    });
    assert.equal(smsSettingsSchema.safeParse(raw).success, true);
    assert.equal(
      smsSettingsSchema.safeParse({
        ...raw,
        availability: availability === 'disabled' ? 'configured' : 'disabled',
      }).success,
      false,
    );
  }
});
test('sandbox is fixed and a live provider sandbox template is rejected', () => {
  const sandbox = settings({
    mode: 'sandbox',
    templateId: 123456,
    codeParameterName: 'Code',
    nameParameterName: null,
    genericName: '',
    availability: 'sandbox',
  });
  assert.equal(smsSettingsSchema.safeParse(sandbox).success, true);
  for (const raw of [
    { ...sandbox, templateId: 170274 },
    { ...sandbox, codeParameterName: 'CODE' },
    { ...sandbox, nameParameterName: 'NAME', genericName: 'User' },
    settings({ templateId: 123456 }),
  ])
    assert.equal(smsSettingsSchema.safeParse(raw).success, false);
});
test('write-only key is admitted only for replace; canonical CAS and nonzero request identity are required', () => {
  const draft = smsSettingsDraft(settings());
  const keep = smsSettingsCommand(draft, settings().version, id, 'keep', 'must-not-be-carried');
  assert.equal('apiKey' in keep, false);
  assert.equal(
    'apiKey' in smsSettingsCommand(draft, settings().version, id, 'clear', 'must-not-be-carried'),
    false,
  );
  assert.equal(
    smsSettingsCommand(draft, settings().version, id, 'replace', 'synthetic-only').apiKeyAction,
    'replace',
  );
  for (const raw of [
    { ...keep, apiKey: '' },
    { ...keep, apiKey: null },
    { ...keep, apiKeyAction: 'replace' },
    { ...keep, apiKeyAction: 'replace', apiKey: 'bad key' },
    { ...keep, requestId: '0'.repeat(32) },
    { ...keep, version: 'AAAAAAAAAAF=' },
    { ...keep, unexpected: true },
  ])
    assert.equal(smsSettingsCommandSchema.safeParse(raw).success, false);
});
test('draft preserves public settings, normalizes Persian template digits and supports absent NAME', () => {
  const draft = smsSettingsDraft(settings());
  const command = smsSettingsCommand(
    { ...draft, templateId: '۱۷۰۲۷۴', useName: false },
    null,
    id,
    'keep',
    '',
  );
  assert.equal(command.templateId, 170274);
  assert.equal(command.nameParameterName, null);
  assert.equal(command.genericName, '');
  for (const changed of [
    { templateId: '1e5' },
    { templateId: '2147483648' },
    { templateId: '123456' },
    { codeParameterName: 'CODE.' },
    { nameParameterName: 'code' },
    { genericName: ' x' },
    { genericName: 'x\u200f' },
    { genericName: 'x'.repeat(26) },
  ])
    assert.throws(
      () => smsSettingsCommand({ ...draft, ...changed }, null, id, 'keep', ''),
      /شناسهٔ قالب/,
    );
});
test('receipt confirms only exact public settings and the intended key operation, without inferring delivery', () => {
  const original = settings(),
    command = smsSettingsCommand(smsSettingsDraft(original), original.version, id, 'keep', '');
  assert.deepEqual(readSmsSettingsReceipt(original, command, true), original);
  for (const raw of [
    { ...original, version: null },
    { ...original, templateId: 25 },
    { ...original, keyConfigured: false, availability: 'unconfigured' },
    { ...original, enabled: false, availability: 'disabled' },
  ])
    assert.throws(() => readSmsSettingsReceipt(raw, command, true), /پاسخ ذخیرهٔ پیامک/);
  const clear = smsSettingsCommand(smsSettingsDraft(original), original.version, id, 'clear', '');
  assert.equal(
    readSmsSettingsReceipt(
      settings({ keyConfigured: false, availability: 'unconfigured' }),
      clear,
      true,
    ).keyConfigured,
    false,
  );
  assert.throws(() => readSmsSettingsReceipt(original, clear, true));
});

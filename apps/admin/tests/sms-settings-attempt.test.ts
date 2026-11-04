import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginSmsSettingsAttempt,
  finishSmsSettingsAttempt,
  interruptSmsSettingsAttempt,
  refreshSmsSettingsAttempt,
  smsSettingsAttempt,
} from '../src/state/settings/sms-settings-attempt.ts';
test('settings recovery retains only explicit non-secret RAM metadata and isolates owners and commands', () => {
  const value = {
    viewerId: 'owner',
    requestId: 'a'.repeat(32),
    baseVersion: null,
    action: 'replace' as const,
    apiKey: 'synthetic-only',
    body: { secret: 'synthetic-only' },
  };
  beginSmsSettingsAttempt(value);
  assert.deepEqual(smsSettingsAttempt('owner'), {
    viewerId: value.viewerId,
    requestId: value.requestId,
    baseVersion: null,
    action: 'replace',
    outcome: 'pending',
    needsRefresh: false,
  });
  assert.equal(smsSettingsAttempt('other'), null);
  const copy = smsSettingsAttempt('owner')!;
  copy.outcome = 'confirmed';
  assert.equal(smsSettingsAttempt('owner')?.outcome, 'pending');
  interruptSmsSettingsAttempt('owner');
  assert.equal(smsSettingsAttempt('owner')?.outcome, 'unknown');
  assert.equal(smsSettingsAttempt('owner')?.needsRefresh, true);
  refreshSmsSettingsAttempt('owner');
  assert.equal(smsSettingsAttempt('owner')?.outcome, 'unknown');
  assert.equal(smsSettingsAttempt('owner')?.needsRefresh, false);
  beginSmsSettingsAttempt({
    viewerId: 'other',
    requestId: 'b'.repeat(32),
    baseVersion: null,
    action: 'keep',
  });
  finishSmsSettingsAttempt('owner', value.requestId, 'confirmed');
  assert.equal(smsSettingsAttempt('owner'), null);
  assert.equal(smsSettingsAttempt('other')?.outcome, 'pending');
  finishSmsSettingsAttempt('other', value.requestId, 'confirmed');
  assert.equal(smsSettingsAttempt('other')?.outcome, 'pending');
  finishSmsSettingsAttempt('other', 'b'.repeat(32), 'conflict');
  assert.equal(smsSettingsAttempt('other')?.needsRefresh, true);
});

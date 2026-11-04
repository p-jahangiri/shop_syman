import type { SmsKeyAction } from '../../api/contracts/settings/sms-settings-contract.ts';

export type SmsSettingsAttempt = {
  viewerId: string;
  requestId: string;
  baseVersion: string | null;
  action: SmsKeyAction;
  outcome: 'pending' | 'unknown' | 'conflict' | 'rejected' | 'confirmed';
  needsRefresh: boolean;
};
// Only non-secret recovery metadata survives page navigation in this tab's RAM.
// Never retain command bodies, keys, fingerprints of keys or browser storage.
let attempt: SmsSettingsAttempt | null = null;
export function smsSettingsAttempt(viewerId: string): SmsSettingsAttempt | null {
  return attempt?.viewerId === viewerId ? { ...attempt } : null;
}
export function beginSmsSettingsAttempt(
  value: Pick<SmsSettingsAttempt, 'viewerId' | 'requestId' | 'baseVersion' | 'action'>,
) {
  attempt = {
    viewerId: value.viewerId,
    requestId: value.requestId,
    baseVersion: value.baseVersion,
    action: value.action,
    outcome: 'pending',
    needsRefresh: false,
  };
}
export function finishSmsSettingsAttempt(
  viewerId: string,
  requestId: string,
  outcome: SmsSettingsAttempt['outcome'],
) {
  if (attempt?.viewerId !== viewerId || attempt.requestId !== requestId) return;
  attempt = { ...attempt, outcome, needsRefresh: outcome === 'unknown' || outcome === 'conflict' };
}
export function interruptSmsSettingsAttempt(viewerId: string) {
  if (attempt?.viewerId === viewerId && attempt.outcome === 'pending')
    finishSmsSettingsAttempt(viewerId, attempt.requestId, 'unknown');
}
export function refreshSmsSettingsAttempt(viewerId: string) {
  if (attempt?.viewerId === viewerId) attempt = { ...attempt, needsRefresh: false };
}

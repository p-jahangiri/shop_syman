import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMfaCode,
  normalizeRecoveryCode,
  recoveryBatchSchema,
  recoveryChallengeSchema,
  recoveryStatusSchema,
} from '../src/api/contracts/staff/mfa-recovery-contract.ts';

const codes = Array.from(
  { length: 10 },
  (_, i) => `${i.toString(16).toUpperCase().padStart(8, '0')}-AAAAAAAA-BBBBBBBB-CCCCCCCC`,
);
test('recovery codes accept case and original grouping but reject altered separators and confusables', () => {
  assert.equal(
    normalizeRecoveryCode(' ' + codes[0].toLowerCase() + ' '),
    codes[0].replaceAll('-', ''),
  );
  assert.equal(normalizeRecoveryCode(codes[1].replaceAll('-', '')), codes[1].replaceAll('-', ''));
  for (const code of [
    '',
    '123456',
    codes[0].replace('-', ' '),
    codes[0].replace('A', 'Ａ'),
    'A'.repeat(65),
  ])
    assert.equal(normalizeRecoveryCode(code), undefined);
  assert.equal(normalizeMfaCode('۱۲٣۴۵٦'), '123456');
});
test('status exposes only bounded count and never codes, hashes or unknown private fields', () => {
  assert.deepEqual(recoveryStatusSchema.parse({ schemaVersion: 1, remainingCodes: 0 }), {
    schemaVersion: 1,
    remainingCodes: 0,
  });
  for (const value of [
    { schemaVersion: 1, remainingCodes: 11 },
    { schemaVersion: 1, remainingCodes: '10' },
    { schemaVersion: 1, remainingCodes: 10, codes },
    { schemaVersion: 1, remainingCodes: 10, codeHash: 'secret' },
  ])
    assert.equal(recoveryStatusSchema.safeParse(value).success, false);
});
test('one-time batch must contain ten unique full entropy formatted codes and an instant', () => {
  const batch = { schemaVersion: 1, codes, generatedAt: '2026-10-23T09:00:00+00:00' };
  assert.equal(recoveryBatchSchema.parse(batch).codes.length, 10);
  for (const value of [
    { ...batch, codes: codes.slice(1) },
    { ...batch, codes: Array(10).fill(codes[0]) },
    { ...batch, codes: codes.map((c) => c.toLowerCase()) },
    { ...batch, codeHash: 'secret' },
    { ...batch, generatedAt: 'yesterday' },
  ])
    assert.equal(recoveryBatchSchema.safeParse(value).success, false);
});
test('recovery result must require enrollment with no permissions, refresh token or completed session', () => {
  const result = {
    accessToken: 'unit-only-pending-not-a-valid-token',
    expiresIn: 300,
    requiresMfa: true,
    requiresEnrollment: true,
    requiresRecovery: false,
    user: { id: 'unit', displayName: 'Unit', userName: 'unit' },
  };
  assert.equal(recoveryChallengeSchema.parse(result).requiresEnrollment, true);
  for (const value of [
    { ...result, requiresMfa: false },
    { ...result, requiresEnrollment: false },
    { ...result, requiresRecovery: true },
    { ...result, refreshToken: 'forbidden' },
    { ...result, user: { ...result.user, permissions: ['catalog.write'] } },
    { ...result, expiresIn: 600 },
  ])
    assert.equal(recoveryChallengeSchema.safeParse(value).success, false);
});

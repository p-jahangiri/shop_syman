import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountingLinkSchema,
  accountingPageSchema,
  holooStatusSchema,
  accountingListPath,
  accountingRecoveryMatches,
  type AccountingLinkInput,
} from '../src/api/contracts/accounting/accounting-contract.ts';
test('accounting identity remains an opaque string and the company filter is encoded', () => {
  const raw = {
    id: 'a'.repeat(32),
    companyKey: 'Company-A',
    externalItemId: '000۱۲',
    externalCode: 'Code-A',
    variantId: 'v-1',
    sku: 'SKU-A',
    productId: 'p1',
    nameFa: 'نمونه',
    nameEn: 'Sample',
    isActive: true,
    version: 'AAAAAAAAAAE=',
  };
  assert.equal(accountingLinkSchema.parse(raw).externalItemId, '000۱۲');
  assert.equal(accountingLinkSchema.safeParse({ ...raw, externalItemId: 12 }).success, false);
  const url = new URL(accountingListPath('Co&Main', '0012', 'true', null), 'http://localhost');
  assert.equal(url.searchParams.get('companyKey'), 'Co&Main');
  assert.equal(url.searchParams.get('query'), '0012');
  assert.equal(url.searchParams.get('enabled'), 'true');
});
test('the unconfigured Holoo contract cannot become a fake connected state', () => {
  const raw = {
    schemaVersion: 1,
    provider: 'holoo',
    liveConfigured: false,
    canReceive: false,
    canWrite: false,
    reason: 'holoo_contract_required',
    mappingAvailable: true,
  };
  assert.equal(holooStatusSchema.parse(raw).canReceive, false);
  assert.equal(holooStatusSchema.safeParse({ ...raw, canReceive: true }).success, false);
  assert.equal(holooStatusSchema.safeParse({ ...raw, token: 'must-not-be-here' }).success, false);
});
test('real final-page wire shape omits nullable cursor and external code', () => {
  const wire = JSON.parse(
    '{"schemaVersion":1,"pageSize":50,"items":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","companyKey":"Company-A","externalItemId":"000۱۲","variantId":"v-1","sku":"SKU-A","productId":"p1","nameFa":"نمونه","nameEn":"Sample","isActive":true,"version":"AAAAAAAAAAE="}]}',
  );
  const page = accountingPageSchema.parse(wire);
  assert.equal(page.nextCursor, null);
  assert.equal(page.items[0].externalCode, null);
  assert.deepEqual(accountingPageSchema.parse({ schemaVersion: 1, pageSize: 50, items: [] }), {
    schemaVersion: 1,
    pageSize: 50,
    items: [],
    nextCursor: null,
  });
  assert.equal(accountingPageSchema.parse({ ...wire, nextCursor: null }).nextCursor, null);
  assert.equal(
    accountingPageSchema.parse({ ...wire, nextCursor: 'opaque-next-page' }).nextCursor,
    'opaque-next-page',
  );
  assert.equal(accountingPageSchema.safeParse({ ...wire, nextCursor: 12 }).success, false);
  assert.equal(accountingPageSchema.safeParse({ ...wire, unexpected: true }).success, false);
});
const current = accountingLinkSchema.parse({
  id: 'a'.repeat(32),
  companyKey: 'Company-A',
  externalItemId: '000۱۲',
  externalCode: 'Code-A',
  variantId: 'v-1',
  sku: 'SKU-A',
  productId: 'p1',
  nameFa: 'نمونه',
  nameEn: 'Sample',
  isActive: true,
  version: 'AAAAAAAAAAI=',
});
const command: AccountingLinkInput = {
  companyKey: 'Company-A',
  externalItemId: '000۱۲',
  externalCode: 'Code-A',
  variantId: 'v-1',
  isActive: true,
  version: 'AAAAAAAAAAE=',
};
test('recovery acknowledges a create only when the requested identity and full state match', () => {
  assert.equal(accountingRecoveryMatches(current.id, { ...command, version: null }, current), true);
  for (const changed of [
    { id: 'b'.repeat(32) },
    { companyKey: 'company-a' },
    { externalItemId: '۱۲' },
    { externalCode: null },
    { externalCode: 'Code-B' },
    { variantId: 'v-2' },
    { isActive: false },
  ]) {
    assert.equal(
      accountingRecoveryMatches(
        current.id,
        { ...command, version: null },
        { ...current, ...changed },
      ),
      false,
      JSON.stringify(changed),
    );
  }
});
test('an existing old mapping cannot acknowledge an update that never reached SQL', () => {
  assert.equal(accountingRecoveryMatches(current.id, command, current), true);
  assert.equal(
    accountingRecoveryMatches(current.id, command, { ...current, version: command.version! }),
    false,
  );
  assert.equal(
    accountingRecoveryMatches(current.id, command, { ...current, variantId: 'previous-variant' }),
    false,
  );
  assert.equal(
    accountingRecoveryMatches(current.id, command, { ...current, externalCode: 'previous-code' }),
    false,
  );
});
test('recovery preserves opaque scripts, case, nullable code and inactive state', () => {
  const inactive = { ...command, externalCode: null, isActive: false };
  assert.equal(
    accountingRecoveryMatches(current.id, inactive, {
      ...current,
      externalCode: null,
      isActive: false,
    }),
    true,
  );
  assert.equal(
    accountingRecoveryMatches(current.id, inactive, {
      ...current,
      externalCode: '',
      isActive: false,
    }),
    false,
  );
  assert.equal(
    accountingRecoveryMatches(current.id, command, { ...current, externalItemId: '00012' }),
    false,
  );
  assert.equal(
    accountingRecoveryMatches(current.id, command, { ...current, companyKey: 'COMPANY-A' }),
    false,
  );
});

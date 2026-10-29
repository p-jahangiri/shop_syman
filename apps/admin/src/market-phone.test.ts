import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marketPhoneScope,
  newMarketPhoneDetails,
  newMarketPhoneModel,
} from './market-phone-defaults.ts';
import {
  phoneConfigurationInputSchema,
  phoneConfigurationsSchema,
  phoneConfigurationPath,
  phoneConfigurationReceiptPath,
  readPhoneConfigurationResult,
  type PhoneConfigurationCommand,
} from './market-phone-contract.ts';
import {
  clearMarketPhoneJournal,
  finishMarketPhoneCommand,
  keepMarketPhoneCommand,
  markMarketPhoneUncertain,
  readMarketPhoneJournal,
} from './market-phone-journal.ts';
import type { Catalog } from './types.ts';
const version = 'AAAAAAAAAAA=',
  listingId = 'a'.repeat(32),
  configurationId = 'b'.repeat(32),
  requestId = '11111111-1111-4111-8111-111111111111';
const configuration = {
  enabled: true,
  ramGb: 8,
  storageGb: 256,
  colorKey: 'graphite',
  colorNameFa: 'گرافیتی',
  colorNameEn: 'Graphite',
  colorHex: '#ABCDEF',
  imageUrl: null,
  linkedVariantId: null,
};
const catalog: Catalog = {
  categories: [
    {
      id: 'other',
      slug: 'laptops',
      imageUrl: '',
      sortOrder: 0,
      isActive: true,
      translations: [],
      attributes: [],
      version,
    },
    {
      id: 'phone-id',
      slug: 'phones',
      imageUrl: '',
      sortOrder: 1,
      isActive: true,
      translations: [],
      attributes: [],
      version,
    },
  ],
  brands: [
    { id: 'other-brand', slug: 'apple', name: 'Apple', logoUrl: '', isActive: true, version },
    { id: 'samsung-id', slug: 'samsung', name: 'Samsung', logoUrl: '', isActive: true, version },
  ],
  attributes: [],
  products: [],
};
test('new phone models select metadata Samsung/phones rather than the first category or brand', () => {
  const selected = newMarketPhoneModel(catalog);
  assert.equal(selected.categoryId, 'phone-id');
  assert.equal(selected.brandId, 'samsung-id');
  assert.equal(selected.version, null);
  assert.equal(selected.attributes.length, 0);
  assert.equal(marketPhoneScope(catalog).ready, true);
  const missing = {
    ...catalog,
    brands: catalog.brands.filter((value) => value.slug !== 'samsung'),
  };
  assert.equal(marketPhoneScope(missing).ready, false);
  assert.equal(newMarketPhoneModel(missing).brandId, '');
  assert.equal(
    marketPhoneScope({
      ...catalog,
      categories: catalog.categories.map((value) => ({ ...value, isActive: false })),
    }).ready,
    false,
  );
});
test('a new phone needs no supplier, source URL, stock assertion or reference amount', () => {
  const details = newMarketPhoneDetails('explicit-local-identity');
  assert.equal(details.status, 'Draft');
  assert.equal(details.sourceItemKey, 'explicit-local-identity');
  assert.equal(details.availability, 'unknown');
  assert.equal(details.sourceUrl, null);
  assert.equal(details.referencePriceRial, null);
  assert.equal(details.observedAt, null);
  assert.equal(details.validUntil, null);
  assert.equal(details.isDemo, false);
});
test('phone choices use bounded integer capacities and never accept price or stock fields', () => {
  assert.equal(phoneConfigurationInputSchema.parse(configuration).colorHex, '#abcdef');
  for (const value of [
    { ...configuration, ramGb: 0 },
    { ...configuration, ramGb: 129 },
    { ...configuration, ramGb: '8' },
    { ...configuration, storageGb: 32769 },
    { ...configuration, colorHex: '#fff' },
    { ...configuration, priceRial: '123' },
    { ...configuration, stock: 2 },
  ])
    assert.equal(phoneConfigurationInputSchema.safeParse(value).success, false);
  assert.equal(
    phoneConfigurationsSchema.safeParse({
      schemaVersion: 1,
      listingId,
      listingVersion: version,
      configurations: [
        { ...configuration, id: configurationId, version },
        { ...configuration, id: configurationId, version },
      ],
    }).success,
    false,
  );
});
test('configuration routes and receipts bind the same parent, selection and actor command', () => {
  const command: PhoneConfigurationCommand = {
    listingId,
    configurationId,
    requestId,
    input: {
      listingVersion: version,
      configurationVersion: null,
      configuration: phoneConfigurationInputSchema.parse(configuration),
    },
  };
  const result = {
    schemaVersion: 1 as const,
    requestId,
    listingId,
    configurationId,
    listingVersion: version,
    configurationVersion: version,
    replayed: true,
  };
  assert.equal(
    phoneConfigurationPath(listingId),
    '/admin/market/' + listingId + '/phone-configurations',
  );
  assert.equal(
    phoneConfigurationReceiptPath(requestId),
    '/admin/market/phone-configuration-commands/' + requestId,
  );
  assert.equal(readPhoneConfigurationResult(result, command).configurationId, configurationId);
  for (const value of [
    { ...result, listingId: 'other' },
    { ...result, configurationId: 'c'.repeat(32) },
    { ...result, requestId: '22222222-2222-4222-8222-222222222222' },
    { ...result, configurationVersion: 1 },
  ])
    assert.throws(() => readPhoneConfigurationResult(value, command));
});
test('configuration journals keep one exact uncertain command and ignore wrong-owner or late replies', () => {
  clearMarketPhoneJournal();
  const command: PhoneConfigurationCommand = {
    listingId,
    configurationId,
    requestId,
    input: {
      listingVersion: version,
      configurationVersion: null,
      configuration: phoneConfigurationInputSchema.parse(configuration),
    },
  };
  const result = {
    schemaVersion: 1 as const,
    requestId,
    listingId,
    configurationId,
    listingVersion: version,
    configurationVersion: version,
    replayed: true,
  };
  keepMarketPhoneCommand('owner', command);
  markMarketPhoneUncertain('owner', command);
  keepMarketPhoneCommand('owner', structuredClone(command));
  assert.equal(readMarketPhoneJournal('owner')!.uncertain, true);
  assert.throws(() =>
    keepMarketPhoneCommand('owner', {
      ...command,
      input: {
        ...command.input,
        configuration: { ...command.input.configuration, storageGb: 512 },
      },
    }),
  );
  assert.equal(readMarketPhoneJournal('other'), null);
  assert.equal(finishMarketPhoneCommand('other', command, result), false);
  assert.equal(
    finishMarketPhoneCommand('owner', command, { ...result, configurationId: 'c'.repeat(32) }),
    false,
  );
  assert.equal(finishMarketPhoneCommand('owner', command, result), true);
  clearMarketPhoneJournal();
  assert.equal(finishMarketPhoneCommand('owner', command, result), false);
});

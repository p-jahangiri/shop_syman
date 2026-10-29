// Contract fixtures only; these are not seed data or a development provider.
export const phoneTestId = 'a'.repeat(32),
  phoneTestOtherId = 'b'.repeat(32),
  phoneTestOwner = 'c'.repeat(32),
  phoneTestVersion = 'AAAAAAAAAAE=';
export const phoneTestCommandId = '01234567-89ab-4cde-8012-3456789abcde';
export const phoneTestModel = {
  id: 'phone-model',
  slug: 'phone-model',
  categoryId: 'phones',
  brandId: 'samsung',
  brand: 'Samsung',
  name: 'گوشی آزمون',
  englishName: 'Contract test phone',
  description: '',
  image: '/products/phone.svg',
  images: ['/products/phone.svg'],
  attributes: {},
};
export const phoneTestChoice = {
  id: phoneTestId,
  ramGb: 8,
  storageGb: 256,
  colorKey: 'black',
  colorNameFa: 'مشکی',
  colorNameEn: 'Black',
  colorHex: '#000000',
  imageUrl: null,
  version: phoneTestVersion,
  availableInStore: false,
  storeSlug: null,
  variantId: null,
  canRequest: true,
  canNotify: true,
};
export const phoneTestSnapshot = {
  id: phoneTestId,
  modelId: phoneTestModel.id,
  ramGb: 8,
  storageGb: 256,
  colorKey: 'black',
  colorNameFa: 'مشکی',
  colorNameEn: 'Black',
  colorHex: '#000000',
  imageUrl: null,
  version: phoneTestVersion,
  linkedVariantId: null,
  fingerprint: 'A'.repeat(64),
};
export const phoneTestItem = {
  id: 'phone-listing',
  model: phoneTestModel,
  isDemo: true,
  specifications: [{ key: 'phone-refresh-rate', label: 'نرخ نوسازی نمایشگر', value: '۱۲۰ هرتز' }],
  configurations: [phoneTestChoice],
};
export const phoneTestPage = {
  schemaVersion: 1,
  locale: 'fa',
  items: [phoneTestItem],
  total: 1,
  page: 1,
  pageSize: 12,
  totalPages: 1,
  facets: {
    brands: [{ id: 'samsung', name: 'Samsung', count: 1 }],
    ramGb: [{ value: 8, count: 1 }],
    storageGb: [{ value: 256, count: 1 }],
    colors: [{ key: 'black', nameFa: 'مشکی', nameEn: 'Black', hex: '#000000', count: 1 }],
    truncated: false,
  },
};
export const phoneTestInterest = {
  id: 'd'.repeat(32),
  listingId: phoneTestItem.id,
  modelNameFa: phoneTestModel.name,
  modelNameEn: phoneTestModel.englishName,
  configuration: phoneTestSnapshot,
  state: 'Active',
  generation: 1,
  version: phoneTestVersion,
  createdAt: '2026-10-28T12:00:00+00:00',
  changedAt: '2026-10-28T12:00:00+00:00',
};
export const phoneTestResult = {
  schemaVersion: 1,
  requestId: phoneTestCommandId,
  interest: phoneTestInterest,
  replayed: false,
  canPay: false,
};
export const phoneTestInterestPage = {
  schemaVersion: 1,
  items: [phoneTestInterest],
  nextCursor: null,
};
export const phoneTestCommand = {
  owner: phoneTestOwner,
  listingId: phoneTestItem.id,
  requestId: phoneTestCommandId,
  input: { configurationId: phoneTestId, active: true, version: null },
};

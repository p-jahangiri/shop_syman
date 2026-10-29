export const supplyTestRequest = 'a'.repeat(32),
  supplyTestTask = 'b'.repeat(32),
  supplyTestOffer = 'c'.repeat(32),
  supplyTestAcceptance = 'd'.repeat(32),
  supplyTestLine = 'e'.repeat(32),
  supplyTestVersion = 'AAAAAAAAAAE=',
  supplyTestDate = '2030-01-01T10:00:00+00:00';
export const supplyTestSummary = {
  id: supplyTestTask,
  offerId: supplyTestOffer,
  acceptanceId: supplyTestAcceptance,
  state: 'SupplierOrderRecorded',
  receiptProgress: 'Partial',
  effectiveState: 'PartiallyReceived',
  version: supplyTestVersion,
  lineCount: 1,
  requiredQuantity: 3,
  receivedQuantity: 1,
  remainingQuantity: 2,
  createdAt: supplyTestDate,
  changedAt: supplyTestDate,
  expectedAt: null,
  purchaseUntil: '2030-01-03T10:00:00+00:00',
  isOpen: true,
  requiresNewOffer: false,
  isDemo: true,
};
export const supplyTestItem = {
  offerLineId: supplyTestLine,
  variantId: 'qa-real-sku',
  sku: 'QA-REAL-SKU',
  nameFa: 'گوشی نمونهٔ SQL',
  nameEn: 'SQL sample phone',
  labelFa: 'نسخهٔ واقعی نمونه',
  labelEn: 'Actual sample variant',
  requiredQuantity: 3,
  receivedQuantity: 1,
  remainingQuantity: 2,
};
export const supplyTestDetail = {
  schemaVersion: 1,
  requestId: supplyTestRequest,
  requestReference: 'SR-1',
  requestVersion: supplyTestVersion,
  task: supplyTestSummary,
  lines: [supplyTestItem],
  publicMessageFa: 'یک دستگاه واقعاً دریافت شده است.',
  publicMessageEn: 'One actual device has been received.',
  reservedForRequest: false,
  canCheckout: false,
  canPay: false,
};
export const supplyTestPage = {
  schemaVersion: 1,
  requestId: supplyTestRequest,
  requestReference: 'SR-1',
  requestVersion: supplyTestVersion,
  pageSize: 20,
  items: [supplyTestSummary],
  nextCursor: null,
  startCandidate: null,
  reservedForRequest: false,
  canCheckout: false,
  canPay: false,
};
export const supplyTestEvent = {
  id: '9007199254740993',
  stateBefore: 'SupplierRequested',
  stateAfter: 'SupplierOrderRecorded',
  receiptProgress: 'None',
  actorKind: 'staff',
  reasonCode: 'supplier_ordered',
  publicMessageFa: 'پیگیری دستی ثبت شد.',
  publicMessageEn: 'Manual follow-up recorded.',
  actionAt: supplyTestDate,
  expectedAt: null,
  at: supplyTestDate,
};
export const supplyTestEvents = {
  schemaVersion: 1,
  pageSize: 20,
  items: [supplyTestEvent],
  nextCursor: null,
};

export const supplyTestSummaryV2 = {
  ...supplyTestSummary,
  allocation: null,
  reservedForRequest: false,
};
export const supplyTestDetailV2 = {
  ...supplyTestDetail,
  schemaVersion: 2,
  task: supplyTestSummaryV2,
};
export const supplyTestPageV2 = {
  ...supplyTestPage,
  schemaVersion: 2,
  items: [supplyTestSummaryV2],
};
export const supplyTestAllocation = {
  id: 'f'.repeat(32),
  state: 'Active',
  effectiveState: 'Active',
  version: supplyTestVersion,
  expiresAt: '2030-01-02T10:00:00+00:00',
  isDemo: true,
  quantity: 3,
  lines: [{ offerLineId: supplyTestLine, variantId: 'qa-real-sku', quantity: 3 }],
};
export const supplyTestHeldDetailV2 = {
  ...supplyTestDetailV2,
  reservedForRequest: true,
  task: { ...supplyTestSummaryV2, reservedForRequest: true, allocation: supplyTestAllocation },
};

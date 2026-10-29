import {
  allocationCandidateSchema,
  allocationDataSchema,
  allocationInputSchema,
  allocationMutationSchema,
} from './allocation-contract.ts';
import { supplyTestInventoryV2 } from './supply.test-fixtures.ts';
export const allocationTestIds = {
  request: 'a'.repeat(32),
  offer: 'b'.repeat(32),
  acceptance: 'c'.repeat(32),
  task: 'd'.repeat(32),
  line: 'e'.repeat(32),
  allocation: '4'.repeat(32),
  command: '3'.repeat(32),
  unit: '5'.repeat(32),
};
export const allocationTestVersion = 'AAAAAAAAAAE=',
  allocationTestVersion2 = 'AAAAAAAAAAI=',
  allocationTestNow = Date.parse('2026-10-24T00:00:00Z');
const ids = allocationTestIds,
  version = allocationTestVersion;
export const allocationTestCandidate = allocationCandidateSchema.parse({
  schemaVersion: 1,
  requestId: ids.request,
  requestReference: 'SR-1',
  requestVersion: version,
  taskId: ids.task,
  taskVersion: version,
  offerId: ids.offer,
  offerVersion: version,
  acceptanceId: ids.acceptance,
  termsHash: 'A'.repeat(64),
  purchaseUntil: '2026-10-25T00:00:00Z',
  isDemo: true,
  canAttemptAllocation: true,
  lines: [
    {
      offerLineId: ids.line,
      variantId: 'SKU-01',
      sku: 'QA-SKU-01',
      nameFa: 'مدل نمونه',
      nameEn: 'Sample model',
      labelFa: 'نسخهٔ اصلی',
      labelEn: 'Original configuration',
      quantity: 2,
    },
  ],
  stock: [
    {
      variantId: 'sku-01',
      trackingMode: 'none',
      onHand: 5,
      reserved: 1,
      sourcingReserved: 0,
      available: 4,
      version,
    },
  ],
  allocation: null,
  canCheckout: false,
  canPay: false,
});
export const allocationTestInput = allocationInputSchema.parse({
  requestId: ids.command,
  requestVersion: version,
  taskVersion: version,
  offerVersion: version,
  acceptanceId: ids.acceptance,
  termsHash: 'A'.repeat(64),
  expiresAt: '2026-10-24T12:00:00Z',
  reason: 'Explicit synthetic QA hold',
  lines: [{ offerLineId: ids.line, stockVersion: version, trackingMode: 'none', units: [] }],
});
export const allocationTestData = allocationDataSchema.parse({
  schemaVersion: 1,
  id: ids.allocation,
  requestId: ids.request,
  taskId: ids.task,
  offerId: ids.offer,
  acceptanceId: ids.acceptance,
  state: 'Active',
  effectiveState: 'Active',
  version,
  createdAt: '2026-10-24T00:00:00Z',
  changedAt: '2026-10-24T00:00:00Z',
  expiresAt: allocationTestInput.expiresAt,
  isDemo: true,
  lines: [{ offerLineId: ids.line, variantId: 'SKU-01', quantity: 2, unitIds: [] }],
});
export const allocationTestMutation = allocationMutationSchema.parse({
  schemaVersion: 1,
  allocationId: ids.allocation,
  requestId: ids.request,
  taskId: ids.task,
  offerId: ids.offer,
  acceptanceId: ids.acceptance,
  operation: 'allocate',
  state: 'Active',
  version,
  commandId: ids.command,
  at: '2026-10-24T00:00:00Z',
  expiresAt: allocationTestInput.expiresAt,
  replayed: false,
});
export const allocationTestUnit = {
  id: ids.unit,
  variantId: 'SKU-01',
  serial: 'QA-UNIT-01',
  imei1: null,
  imei2: null,
  state: 'available' as const,
  orderId: null,
  reservationId: null,
  warrantyUntil: null,
  createdAt: '2026-10-24T00:00:00Z',
  changedAt: '2026-10-24T00:00:00Z',
  version,
};
export function allocationCurrentFixtures(
  data = allocationTestData,
  active: typeof allocationTestData | null = data,
) {
  const summary = active
    ? {
        schemaVersion: 1,
        id: active.id,
        requestId: active.requestId,
        taskId: active.taskId,
        offerId: active.offerId,
        acceptanceId: active.acceptanceId,
        state: 'Active' as const,
        effectiveState:
          active.effectiveState === 'Expired' ? ('Expired' as const) : ('Active' as const),
        version: active.version,
        expiresAt: active.expiresAt,
        isDemo: active.isDemo,
        quantity: active.lines.reduce((sum, line) => sum + line.quantity, 0),
        lines: active.lines.map(({ unitIds: _, ...line }) => line),
      }
    : null;
  const candidate = allocationCandidateSchema.parse({
    ...allocationTestCandidate,
    canAttemptAllocation: summary === null,
    allocation: summary,
    stock: allocationTestCandidate.stock.map((stock) => ({
      ...stock,
      sourcingReserved: summary ? 2 : 0,
      available: summary ? 2 : 4,
    })),
  });
  const {
    schemaVersion: _,
    requestId: __,
    taskId: ___,
    offerId: ____,
    acceptanceId: _____,
    ...supplyAllocation
  } = summary ?? {};
  const reserved = summary?.effectiveState === 'Active',
    detail = {
      ...supplyTestInventoryV2,
      task: {
        ...supplyTestInventoryV2.task,
        reservedForRequest: reserved,
        task: {
          ...supplyTestInventoryV2.task.task,
          reservedForRequest: reserved,
          allocation: summary ? supplyAllocation : null,
        },
      },
      stock: [{ variantId: 'SKU-01', trackingMode: 'none', onHand: 5, reserved: 1, version }],
    };
  return { data, candidate, detail };
}

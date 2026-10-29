import { z } from 'zod';
import { offerCommandIdSchema, offerIdSchema } from '../../storefront/lib/offer-contract.ts';
import type { RecoveredAdminCommand } from './sourcing-admin-command.ts';
export const manualSourcingOperationSchema = z.enum([
  'review',
  'unavailable',
  'save',
  'publish',
  'withdraw',
  'supply-start',
  'supply-requested',
  'supply-ordered',
  'supply-progress',
  'supply-cancel',
  'supply-fail',
]);
export type ManualSourcingOperation = z.infer<typeof manualSourcingOperationSchema>;
export type ManualSourcingReceiptInput = {
  operation: ManualSourcingOperation;
  requestId: string;
  commandId: string;
  offerId: string;
  taskId: string;
};
export function manualSourcingReceiptScope(value: unknown) {
  const operation = manualSourcingOperationSchema.parse(value);
  return operation.startsWith('supply-')
    ? ('supply' as const)
    : ['save', 'publish', 'withdraw'].includes(operation)
      ? ('offer' as const)
      : ('request' as const);
}
export function manualSourcingReceiptRecovery(
  input: ManualSourcingReceiptInput,
  permissions: { sales: boolean; financial: boolean },
): RecoveredAdminCommand {
  const operation = manualSourcingOperationSchema.parse(input.operation),
    scope = manualSourcingReceiptScope(operation),
    requestId = offerIdSchema.parse(input.requestId),
    id = offerCommandIdSchema.parse(input.commandId);
  if (scope === 'offer' ? !permissions.financial : !permissions.sales)
    throw new Error('شما مجوز پیگیری رسید این نوع فرمان را ندارید.');
  const target =
    scope === 'offer'
      ? { domain: scope, operation, requestId, offerId: offerIdSchema.parse(input.offerId) }
      : scope === 'supply'
        ? {
            domain: scope,
            operation: operation.slice(7),
            requestId,
            taskId: offerIdSchema.parse(input.taskId),
          }
        : { domain: scope, operation, requestId };
  // Receipt recovery has no original mutation payload. Its refresh-only journal
  // cannot fabricate versions or become a mutation retry after a hard reload.
  return {
    kind: 'recovered',
    id,
    reference: requestId,
    target,
    body: { requestId: id },
    phase: 'refresh',
  };
}
export function manualAllocationReceiptRecovery(
  input: {
    operation: 'allocate' | 'release';
    requestId: string;
    taskId: string;
    resourceId: string;
    commandId: string;
  },
  inventory: boolean,
): RecoveredAdminCommand {
  if (!inventory) throw new Error('شما مجوز پیگیری رسید تخصیص انبار را ندارید.');
  const operation = z.enum(['allocate', 'release']).parse(input.operation),
    requestId = offerIdSchema.parse(input.requestId),
    taskId = offerIdSchema.parse(input.taskId),
    resourceId = offerIdSchema.parse(input.resourceId),
    id = offerCommandIdSchema.parse(input.commandId);
  return {
    kind: 'recovered',
    id,
    reference: requestId,
    target: { domain: 'allocation', operation, requestId, taskId, resourceId },
    body: { requestId: id },
    phase: 'refresh',
  };
}

import {
  offerAdminDetailSchema,
  offerAdminPageSchema,
  offerMutationSchema,
} from '../../api/contracts/market/offer-contract.ts';
import {
  sourcingAdminDetailSchema,
  sourcingMutationSchema,
} from '../../api/contracts/market/sourcing-contract.ts';
import {
  commandMethod,
  commandPath,
  commandTarget,
  offerResultMatches,
  isOfferCommand,
  type AdminSourcingCommand,
  type RecoveryTarget,
} from './sourcing-admin-command.ts';
import {
  inventorySupplyDetailV2Schema as inventorySupplyDetailSchema,
  mappingMutationSchema,
  mappingSchema,
  receivingDataSchema,
  receivingMutationSchema,
  sameReceivingSku,
  supplyAdminDetailV2Schema as supplyAdminDetailSchema,
  supplyAdminPageV2Schema as supplyAdminPageSchema,
  supplyMutationSchema,
} from '../../api/contracts/market/supply-contract.ts';
import type { CommandAdapter, CommandCacheUpdate } from './sourcing-command-runner.ts';
import {
  allocationCandidateSchema,
  allocationCurrentMatches,
  allocationDataSchema,
  allocationMutationSchema,
} from '../../api/contracts/market/allocation-contract.ts';

export type CommandPermissions = { sales: boolean; financial: boolean; inventory: boolean };
export function commandPermitted(command: AdminSourcingCommand, permissions: CommandPermissions) {
  const target = commandTarget(command);
  return target.domain === 'offer'
    ? permissions.financial
    : target.domain === 'receiving' || target.domain === 'mapping' || target.domain === 'allocation'
      ? permissions.inventory
      : permissions.sales;
}
const canonical = (value: string) => value.replaceAll('-', '').toLowerCase();
export function commandTargetsEqual(left: RecoveryTarget, right: RecoveryTarget) {
  return (
    left.domain === right.domain &&
    left.operation === right.operation &&
    left.requestId === right.requestId &&
    left.offerId === right.offerId &&
    left.taskId === right.taskId &&
    left.resourceId === right.resourceId
  );
}
export function receiptPath(command: AdminSourcingCommand) {
  const target = commandTarget(command),
    uuid = command.id;
  if (target.domain === 'mapping')
    return `/admin/inventory/receiving-unit-mappings/${target.resourceId}/commands/${uuid}`;
  if (target.domain === 'receiving')
    return `/admin/inventory/sourcing-receipts/${target.resourceId}/commands/${uuid}`;
  if (target.domain === 'allocation')
    return `/admin/inventory/sourcing-allocations/${target.resourceId}/commands/${target.operation}/${uuid}`;
  const base = '/admin/sourcing/requests/' + target.requestId;
  return `${base}${target.domain === 'offer' ? '/offers/' + target.offerId : target.domain === 'supply' ? '/supply/' + target.taskId : ''}/commands/${target.operation}/${uuid}`;
}
const mismatch = () =>
  new Error('پاسخ یا وضعیت جاری با هدف فرمان یکسان نیست؛ همان شناسه را پیگیری کنید.');
export function inventorySourcingStockInvalidations(
  taskId?: string,
): readonly (readonly unknown[])[] {
  return [
    ['admin', 'inventory-sourcing-tasks'],
    taskId
      ? ['admin', 'sourcing-allocation-candidate', taskId]
      : ['admin', 'sourcing-allocation-candidate'],
    ['admin', 'allocation-unit-picker'],
    ['admin', 'stock-page'],
    ['admin', 'stock-movements'],
    ['admin', 'inventory-summary'],
    ['admin', 'serial-page'],
    ['admin', 'serial-page-v2'],
  ];
}
export function createCommandAdapter(
  command: AdminSourcingCommand,
  permissions: CommandPermissions,
  read: (path: string) => Promise<unknown>,
): CommandAdapter {
  const target = commandTarget(command),
    base = '/admin/sourcing/requests/' + target.requestId;
  return {
    path: commandPath(command),
    method: commandMethod(command),
    receiptPath: receiptPath(command),
    permitted: commandPermitted(command, permissions),
    validate(raw, receipt) {
      if (target.domain === 'offer') {
        const value = offerMutationSchema.parse(raw);
        if (
          value.requestId !== target.requestId ||
          value.offerId !== target.offerId ||
          value.operation !== target.operation ||
          (isOfferCommand(command) && !offerResultMatches(command, value)) ||
          (receipt && !value.replayed)
        )
          throw mismatch();
      } else if (target.domain === 'request') {
        const value = sourcingMutationSchema.parse(raw);
        if (
          value.id !== target.requestId ||
          value.state !== (target.operation === 'review' ? 'Reviewing' : 'Unavailable') ||
          (command.kind !== 'recovered' && value.reference !== command.reference) ||
          (receipt && !value.replayed)
        )
          throw mismatch();
      } else if (target.domain === 'supply') {
        const value = supplyMutationSchema.parse(raw);
        if (
          value.requestId !== target.requestId ||
          value.taskId !== target.taskId ||
          (target.offerId && value.offerId !== target.offerId) ||
          value.operation !== target.operation ||
          (receipt && !value.replayed)
        )
          throw mismatch();
      } else if (target.domain === 'mapping') {
        const value = mappingMutationSchema.parse(raw);
        if (
          value.id !== target.resourceId ||
          canonical(value.commandId) !== canonical(command.id) ||
          (receipt && !value.replayed)
        )
          throw mismatch();
      } else if (target.domain === 'allocation') {
        const value = allocationMutationSchema.parse(raw),
          original =
            command.kind === 'allocation-allocate' || command.kind === 'allocation-release'
              ? command
              : null;
        if (
          value.requestId !== target.requestId ||
          value.taskId !== target.taskId ||
          value.allocationId !== target.resourceId ||
          value.operation !== target.operation ||
          canonical(value.commandId) !== canonical(command.id) ||
          (target.offerId && value.offerId !== target.offerId) ||
          (original && value.acceptanceId !== original.body.acceptanceId) ||
          (command.kind === 'allocation-allocate' &&
            Date.parse(value.expiresAt) !== Date.parse(command.body.expiresAt)) ||
          (receipt && !value.replayed)
        )
          throw mismatch();
      } else {
        const value = receivingMutationSchema.parse(raw);
        if (
          value.requestId !== target.requestId ||
          value.taskId !== target.taskId ||
          value.receiptId !== target.resourceId ||
          (receipt && !value.replayed)
        )
          throw mismatch();
      }
    },
    async readFresh() {
      const updates: CommandCacheUpdate[] = [];
      if (target.domain === 'mapping') {
        const value = mappingSchema.parse(
          await read(`/admin/inventory/receiving-unit-mappings/${target.resourceId}`),
        );
        if (value.id !== target.resourceId) throw mismatch();
        updates.push({ key: ['admin', 'receiving-unit-mapping', target.resourceId], value });
        return {
          updates,
          focus: { mappingId: target.resourceId },
          invalidate: [['admin', 'receiving-unit-mappings']],
        };
      }
      if (target.domain === 'allocation') {
        const [allocation, candidate, detail] = await Promise.all([
          read(`/admin/inventory/sourcing-allocations/${target.resourceId}`).then((value) =>
            allocationDataSchema.parse(value),
          ),
          read(`/admin/inventory/sourcing-tasks/${target.taskId}/allocation`).then((value) =>
            allocationCandidateSchema.parse(value),
          ),
          read(`/admin/inventory/sourcing-tasks/v2/${target.taskId}`).then((value) =>
            inventorySupplyDetailSchema.parse(value),
          ),
        ]);
        if (
          allocation.id !== target.resourceId ||
          allocation.requestId !== target.requestId ||
          allocation.taskId !== target.taskId ||
          (target.offerId && allocation.offerId !== target.offerId) ||
          !allocationCurrentMatches(allocation, candidate) ||
          candidate.taskId !== target.taskId ||
          candidate.requestId !== target.requestId ||
          candidate.requestId !== detail.task.requestId ||
          candidate.taskId !== detail.task.task.id ||
          candidate.offerId !== detail.task.task.offerId ||
          candidate.acceptanceId !== detail.task.task.acceptanceId ||
          candidate.requestVersion !== detail.task.requestVersion ||
          candidate.taskVersion !== detail.task.task.version ||
          candidate.allocation?.id !== detail.task.task.allocation?.id ||
          candidate.allocation?.version !== detail.task.task.allocation?.version
        )
          throw mismatch();
        if (
          (command.kind === 'allocation-allocate' || command.kind === 'allocation-release') &&
          allocation.acceptanceId !== command.body.acceptanceId
        )
          throw mismatch();
        if (
          command.kind === 'allocation-allocate' &&
          (allocation.lines.length !== command.body.lines.length ||
            command.body.lines.some((pick) => {
              const line = allocation.lines.find((line) => line.offerLineId === pick.offerLineId);
              return (
                !line ||
                JSON.stringify([...line.unitIds].sort()) !==
                  JSON.stringify(pick.units.map((unit) => unit.unitId).sort())
              );
            }))
        )
          throw mismatch();
        // Receipt state/version describe historical success. The direct resource
        // may now be released/expired/transferred; the current acceptance may have
        // no hold or a different newly-created hold. Never revive the old command.
        updates.push(
          { key: ['admin', 'sourcing-allocation', target.resourceId], value: allocation },
          { key: ['admin', 'sourcing-allocation-candidate', target.taskId], value: candidate },
          { key: ['admin', 'inventory-sourcing-task', target.taskId], value: detail },
        );
        return {
          updates,
          focus: {
            requestId: target.requestId,
            taskId: target.taskId,
            allocationId: target.resourceId,
          },
          invalidate: [
            ['admin', 'inventory-sourcing-tasks'],
            ['admin', 'sourcing-allocation-events', target.resourceId],
            ['admin', 'allocation-unit-picker'],
            ['admin', 'stock-page'],
            ['admin', 'inventory-summary'],
            ['admin', 'serial-page'],
            ['admin', 'serial-page-v2'],
            ['admin', 'sourcing-detail', target.requestId],
            ['admin', 'sourcing-supply', target.requestId],
            ['admin', 'sourcing-supply-detail', target.requestId],
            ['admin', 'sourcing-supply-events', target.requestId],
          ],
        };
      }
      if (target.domain === 'receiving') {
        const [receipt, detail] = await Promise.all([
          read(`/admin/inventory/sourcing-receipts/${target.resourceId}`).then((value) =>
            receivingDataSchema.parse(value),
          ),
          read(`/admin/inventory/sourcing-tasks/v2/${target.taskId}`).then((value) =>
            inventorySupplyDetailSchema.parse(value),
          ),
        ]);
        if (
          receipt.id !== target.resourceId ||
          receipt.taskId !== target.taskId ||
          receipt.requestId !== target.requestId ||
          detail.task.task.id !== target.taskId ||
          detail.task.requestId !== target.requestId ||
          receipt.offerId !== detail.task.task.offerId ||
          receipt.acceptanceId !== detail.task.task.acceptanceId
        )
          throw mismatch();
        for (const line of detail.task.lines) {
          const received = receipt.lines.filter((item) => item.offerLineId === line.offerLineId);
          if (
            received.some((item) => !sameReceivingSku(item.variantId, line.variantId)) ||
            received.reduce((sum, item) => sum + item.quantity, 0) > line.receivedQuantity
          )
            throw mismatch();
        }
        if (
          receipt.lines.some(
            (line) => !detail.task.lines.some((item) => item.offerLineId === line.offerLineId),
          )
        )
          throw mismatch();
        updates.push(
          { key: ['admin', 'sourcing-receipt', target.resourceId], value: receipt },
          { key: ['admin', 'inventory-sourcing-task', target.taskId], value: detail },
        );
        return {
          updates,
          focus: {
            requestId: target.requestId,
            taskId: target.taskId,
            receiptId: target.resourceId,
          },
          invalidate: inventorySourcingStockInvalidations(target.taskId),
        };
      }
      const [request, page, child, supplyPage] = await Promise.all([
        read(base).then((value) => sourcingAdminDetailSchema.parse(value)),
        read(base + '/offers').then((value) => offerAdminPageSchema.parse(value)),
        target.domain === 'offer'
          ? read(`${base}/offers/${target.offerId}`).then((value) =>
              offerAdminDetailSchema.parse(value),
            )
          : target.domain === 'supply'
            ? read(`${base}/supply/v2/${target.taskId}`).then((value) =>
                supplyAdminDetailSchema.parse(value),
              )
            : Promise.resolve(null),
        target.domain === 'supply'
          ? read(base + '/supply/v2').then((value) => supplyAdminPageSchema.parse(value))
          : Promise.resolve(null),
      ]);
      if (
        request.summary.id !== target.requestId ||
        page.requestId !== target.requestId ||
        request.summary.reference !== page.requestReference ||
        request.summary.version !== page.requestVersion ||
        (child &&
          (child.requestId !== target.requestId ||
            child.requestVersion !== request.summary.version ||
            child.requestReference !== request.summary.reference)) ||
        (child && 'offer' in child && child.offer.summary.id !== target.offerId) ||
        (child && 'task' in child && child.task.id !== target.taskId) ||
        (supplyPage &&
          (supplyPage.requestId !== target.requestId ||
            supplyPage.requestVersion !== request.summary.version ||
            supplyPage.requestReference !== request.summary.reference))
      )
        throw mismatch();
      updates.push(
        { key: ['admin', 'sourcing-detail', target.requestId], value: request },
        {
          key: ['admin', 'sourcing-offers', target.requestId],
          value: { pages: [page], pageParams: [null] },
        },
      );
      if (target.domain === 'offer')
        updates.push({
          key: ['admin', 'sourcing-offer', target.requestId, target.offerId],
          value: child,
        });
      if (target.domain === 'supply') {
        updates.push(
          {
            key: ['admin', 'sourcing-supply-detail', target.requestId, target.taskId],
            value: child,
          },
          {
            key: ['admin', 'sourcing-supply', target.requestId],
            value: { pages: [supplyPage], pageParams: [null] },
          },
        );
      }
      return {
        updates,
        focus: { requestId: target.requestId, offerId: target.offerId, taskId: target.taskId },
        invalidate: [
          ['admin', 'sourcing'],
          ['admin', 'sourcing-events', target.requestId],
          ['admin', 'sourcing-offer-events', target.requestId],
          ['admin', 'sourcing-supply-events', target.requestId],
          ...(target.domain !== 'offer' ? [['admin', 'sourcing-offer', target.requestId]] : []),
          ...(target.domain !== 'supply'
            ? [
                ['admin', 'sourcing-supply', target.requestId],
                ['admin', 'sourcing-supply-detail', target.requestId],
              ]
            : []),
        ],
      };
    },
  };
}

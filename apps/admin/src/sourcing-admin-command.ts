import type { SourcingCommand } from './sourcing-contract.ts';
import { sourcingFailureIsUnknown } from './sourcing-contract.ts';
import {
  offerAdminCommandMatches,
  type OfferAdminCommand,
  type OfferSku,
} from './offer-contract.ts';
import type { SupplyAdminCommand } from './supply-contract.ts';
import type { AllocationAdminCommand } from './allocation-contract.ts';

export type RecoveryTarget = {
  domain: 'request' | 'offer' | 'supply' | 'receiving' | 'mapping' | 'allocation';
  operation: string;
  requestId?: string;
  offerId?: string;
  taskId?: string;
  resourceId?: string;
};
export type RecoveredAdminCommand = {
  kind: 'recovered';
  id: string;
  reference: string;
  target: RecoveryTarget;
  body: { requestId: string };
  phase: 'pending' | 'unknown' | 'failed' | 'refresh';
  uncertain?: boolean;
  message?: string;
};
export type AdminSourcingCommand =
  | SourcingCommand
  | (OfferAdminCommand & { reference: string })
  | SupplyAdminCommand
  | AllocationAdminCommand
  | RecoveredAdminCommand;
export function isOfferCommand(
  command: AdminSourcingCommand,
): command is OfferAdminCommand & { reference: string } {
  return command.kind === 'save' || command.kind === 'publish' || command.kind === 'withdraw';
}
export const commandRequest = (command: AdminSourcingCommand) =>
  command.kind === 'recovered'
    ? (command.target.requestId ?? command.target.resourceId ?? '')
    : isOfferCommand(command)
      ? command.requestId
      : 'targetId' in command
        ? command.targetId
        : 'requestId' in command
          ? command.requestId
          : command.resourceId;
export function commandTarget(command: AdminSourcingCommand): RecoveryTarget {
  if (command.kind === 'recovered') return command.target;
  if (isOfferCommand(command))
    return {
      domain: 'offer',
      operation: command.kind,
      requestId: command.requestId,
      offerId: command.offerId,
    };
  if ('targetId' in command)
    return { domain: 'request', operation: command.kind, requestId: command.targetId };
  if (command.kind === 'mapping-save')
    return { domain: 'mapping', operation: 'save', resourceId: command.resourceId };
  if (command.kind === 'receive')
    return {
      domain: 'receiving',
      operation: 'receive',
      requestId: command.requestId,
      taskId: command.taskId,
      resourceId: command.resourceId,
    };
  if (command.kind === 'allocation-allocate' || command.kind === 'allocation-release')
    return {
      domain: 'allocation',
      operation: command.kind.slice(11),
      requestId: command.requestId,
      taskId: command.taskId,
      offerId: command.offerId,
      resourceId: command.resourceId,
    };
  return {
    domain: 'supply',
    operation: command.kind.slice(7),
    requestId: command.requestId,
    offerId: command.kind === 'supply-start' ? command.offerId : undefined,
    taskId: command.taskId,
  };
}
export function commandPath(command: AdminSourcingCommand) {
  const target = commandTarget(command),
    base = '/admin/sourcing/requests/' + target.requestId;
  if (target.domain === 'offer')
    return `${base}/offers/${target.offerId}${target.operation === 'save' ? '' : '/' + target.operation}`;
  if (target.domain === 'request') return `${base}/${target.operation}`;
  if (target.domain === 'mapping')
    return '/admin/inventory/receiving-unit-mappings/' + target.resourceId;
  if (target.domain === 'receiving')
    return `/admin/inventory/sourcing-requests/${target.requestId}/tasks/${target.taskId}/receipts/${target.resourceId}`;
  if (target.domain === 'allocation')
    return `/admin/inventory/sourcing-requests/${target.requestId}/tasks/${target.taskId}/allocations/${target.resourceId}${target.operation === 'release' ? '/release' : ''}`;
  return target.operation === 'start'
    ? `${base}/offers/${target.offerId}/supply/${target.taskId}`
    : `${base}/supply/${target.taskId}/${target.operation}`;
}
export const commandMethod = (command: AdminSourcingCommand): 'PUT' | 'POST' =>
  command.kind === 'save' ||
  command.kind === 'supply-start' ||
  command.kind === 'mapping-save' ||
  command.kind === 'allocation-allocate'
    ? 'PUT'
    : 'POST';
export function maySendCommand(
  stored: AdminSourcingCommand | null | undefined,
  next: AdminSourcingCommand,
) {
  return (
    next.kind !== 'recovered' &&
    next.phase !== 'refresh' &&
    stored?.phase !== 'refresh' &&
    (!stored ||
      (stored.id === next.id &&
        stored.kind === next.kind &&
        JSON.stringify(commandTarget(stored)) === JSON.stringify(commandTarget(next)) &&
        JSON.stringify(stored.body) === JSON.stringify(next.body)))
  );
}
export function offerResultMatches(
  command: OfferAdminCommand,
  value: Parameters<typeof offerAdminCommandMatches>[1],
) {
  return offerAdminCommandMatches(command, value);
}
export { sourcingFailureIsUnknown };
export function canMarkUnavailable(
  base: boolean,
  child: { requestVersion: string; canMark: boolean } | null,
  requestVersion: string,
) {
  return base && child?.requestVersion === requestVersion && child.canMark;
}
export function offerControlsFresh(input: {
  parentVersion: string;
  pageVersion?: string;
  pageError: boolean;
  pageFetching: boolean;
  detailVersion?: string;
  detailError?: boolean;
  detailFetching?: boolean;
  requireDetail?: boolean;
}) {
  return (
    !!input.pageVersion &&
    !input.pageError &&
    !input.pageFetching &&
    input.pageVersion === input.parentVersion &&
    (!input.requireDetail ||
      (!!input.detailVersion &&
        !input.detailError &&
        !input.detailFetching &&
        input.detailVersion === input.parentVersion))
  );
}
export function freezeCommand<T extends AdminSourcingCommand>(command: T): T {
  const copy = structuredClone(command);
  const freeze = (value: unknown) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(copy.body);
  if (copy.kind === 'recovered') freeze(copy.target);
  return copy;
}
export const latinDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 1632));
export function explicitRial(value: string) {
  const canonical = latinDigits(value.trim());
  if (!/^(?:0|[1-9][0-9]{0,18})$/.test(canonical) || BigInt(canonical) > 9223372036854775807n)
    throw new Error('قیمت هر واحد را به ریال صحیح وارد کنید؛ بدون اعشار یا جداکننده.');
  return canonical;
}
export function utcFromInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) || value.startsWith('0000'))
    throw new Error('تاریخ و ساعت UTC را صریح وارد کنید.');
  const date = new Date(value + 'Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, value.length) !== value)
    throw new Error('تاریخ و ساعت UTC معتبر نیست.');
  return date.toISOString();
}
export type OfferEditorLine = {
  lineId: string;
  listingId: string;
  quantity: string;
  price: string;
  sku: OfferSku;
};
export function offerEditorLines(
  request: { listingId: string; quantity: number; model: { id: string } }[],
  lines: OfferEditorLine[],
) {
  if (!lines.length || lines.length > 64) throw new Error('بین ۱ تا ۶۴ ردیف SKU انتخاب کنید.');
  const used = new Set<string>();
  const allocated = new Map<string, number>();
  let total = 0n;
  const result = lines.map((line) => {
    const parent = request.find((item) => item.listingId === line.listingId);
    const pair = line.listingId + ':' + line.sku.variantId;
    if (!parent || parent.model.id !== line.sku.productId || used.has(pair))
      throw new Error('SKU باید یکتا و متعلق به همان مدل درخواست باشد.');
    used.add(pair);
    const qty = latinDigits(line.quantity.trim());
    if (!/^[1-9][0-9]{0,6}$/.test(qty) || Number(qty) > 1000000)
      throw new Error('تعداد هر ردیف باید بین ۱ و ۱٬۰۰۰٬۰۰۰ باشد.');
    const quantity = Number(qty),
      unitPriceRial = explicitRial(line.price);
    allocated.set(line.listingId, (allocated.get(line.listingId) ?? 0) + quantity);
    total += BigInt(unitPriceRial) * BigInt(quantity);
    return {
      lineId: line.lineId,
      listingId: line.listingId,
      variantId: line.sku.variantId,
      quantity,
      unitPriceRial,
      materialFingerprint: line.sku.materialFingerprint,
      currentFingerprint: line.sku.currentFingerprint,
    };
  });
  if (request.some((line) => allocated.get(line.listingId) !== line.quantity))
    throw new Error('تعداد SKUهای انتخابی باید مقدار تمام مدل‌های درخواست را دقیقاً پوشش دهد.');
  if (total > 9223372036854775807n)
    throw new Error('جمع پیشنهاد از سقف ریال صحیح پشتیبانی‌شده بیشتر است.');
  return { lines: result, total: total.toString() };
}

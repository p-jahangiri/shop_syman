import { orderInputSchema, type OrderInput } from '@sayman/web-shared/lib/orders/order-contract.ts';
export interface OrderV2Attempt {
  locale: 'fa' | 'en';
  input: OrderInput;
  quoteExpiresAt: string;
  reservationMinutes: number;
  uncertain: boolean;
}
// Contact details and the immutable request stay in RAM only. A failed refresh
// hides this journal until the same owner is verified; logout clears it.
let owner: string | null = null,
  pending: OrderV2Attempt | null = null;
export function bindOrderV2Owner(value: string | null) {
  if (value !== owner) {
    owner = value;
    pending = null;
  }
}
export function readOrderV2Attempt(value: string) {
  return value === owner && pending ? structuredClone(pending) : null;
}
export function startOrderV2Attempt(
  value: string,
  locale: 'fa' | 'en',
  input: OrderInput,
  quoteExpiresAt: string,
  reservationMinutes: number,
) {
  const parsed = orderInputSchema.parse(input);
  if (value !== owner) throw new Error('order_owner_changed');
  if (
    !Number.isFinite(Date.parse(quoteExpiresAt)) ||
    !Number.isInteger(reservationMinutes) ||
    reservationMinutes < 1 ||
    reservationMinutes > 60
  )
    throw new Error('invalid_order_context');
  if (
    pending &&
    (pending.locale !== locale || JSON.stringify(pending.input) !== JSON.stringify(parsed))
  )
    throw new Error('order_request_pending');
  pending ??= {
    locale,
    input: structuredClone(parsed),
    quoteExpiresAt,
    reservationMinutes,
    uncertain: false,
  };
  return structuredClone(pending);
}
export function finishOrderV2Attempt(value: string, requestId: string) {
  if (value !== owner || pending?.input.requestId !== requestId) return false;
  pending = null;
  return true;
}
export function failOrderV2Attempt(value: string, requestId: string, status: number) {
  if (value !== owner || pending?.input.requestId !== requestId) return false;
  if (pending.uncertain || status < 400 || status >= 500) {
    pending.uncertain = true;
    return true;
  }
  pending = null;
  return false;
}

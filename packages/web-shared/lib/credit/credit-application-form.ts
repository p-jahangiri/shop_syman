import { normalizeOrderDigits } from '../orders/order-form.ts';
import { parseToman } from '../shared/money.ts';
export function parseCreditRequestedToman(value: string) {
  return parseToman(normalizeOrderDigits(value).replace(/٫/g, '.'));
}

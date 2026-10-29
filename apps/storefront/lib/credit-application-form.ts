import { normalizeOrderDigits } from './order-form.ts';
import { parseToman } from './money.ts';
export function parseCreditRequestedToman(value: string) {
  return parseToman(normalizeOrderDigits(value).replace(/٫/g, '.'));
}

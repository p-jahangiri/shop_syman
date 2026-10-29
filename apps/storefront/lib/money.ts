import type { Locale } from './types.ts';

export function formatToman(rial: bigint | string, locale: Locale = 'fa'): string {
  const value = BigInt(rial);
  const negative = value < 0n;
  const amount = negative ? -value : value;
  const whole = amount / 10n;
  const remainder = amount % 10n;
  const formatter = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: 0,
  });
  const integer = formatter.format(negative && whole === 0n ? -0 : negative ? -whole : whole);
  return remainder
    ? `${integer}${locale === 'fa' ? '٫' : '.'}${formatter.format(remainder)}`
    : integer;
}
export function tomanInput(rial: bigint | string): string {
  const value = BigInt(rial);
  const negative = value < 0n;
  const n = negative ? -value : value;
  return `${negative ? '-' : ''}${n / 10n}${n % 10n ? `.${n % 10n}` : ''}`;
}
export function parseToman(value: string): bigint | undefined {
  if (!/^\d{1,18}(?:\.\d)?$/.test(value)) return undefined;
  const [whole, fraction = '0'] = value.split('.');
  const amount = BigInt(whole) * 10n + BigInt(fraction);
  return amount <= 9223372036854775807n ? amount : undefined;
}
// Percentages arrive as bounded JSON numbers, then become exact integer basis
// points before they participate in any monetary calculation.
export function percentBasisPoints(value: number, max: number): bigint {
  if (!Number.isFinite(value)) throw new Error('Invalid percentage');
  const match = String(value).match(/^(\d{1,4})(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Percentages require at most two decimal places');
  const result = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (result > BigInt(max) * 100n) throw new Error('Percentage exceeds its supported range');
  return result;
}

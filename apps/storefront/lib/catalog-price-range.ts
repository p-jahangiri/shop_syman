import { formatToman } from './money.ts';
import type { Locale } from './types.ts';

export const CATALOG_PRICE_SLIDER_STEPS = 1000;
const steps = BigInt(CATALOG_PRICE_SLIDER_STEPS);
const maxRial = 9223372036854775807n;

export type CatalogPriceDomain = { minRial: bigint; maxRial: bigint };

function bound(value: string): bigint | undefined {
  if (!/^\d{1,19}$/.test(value)) return undefined;
  const amount = BigInt(value);
  return amount <= maxRial ? amount : undefined;
}

// Bounds come from unfiltered category facets, never from the current result
// page. Existing APIs without a minimum can use zero as the lower bound.
export function catalogPriceDomain(
  minPriceRial?: string,
  maxPriceRial?: string,
): CatalogPriceDomain | undefined {
  if (maxPriceRial === undefined) return undefined;
  const minRial = minPriceRial === undefined ? 0n : bound(minPriceRial);
  const maximum = bound(maxPriceRial);
  if (minRial === undefined || maximum === undefined || minRial > maximum) return undefined;
  return { minRial, maxRial: maximum };
}

// HTML range controls use small numeric positions. Monetary values and all
// interpolation remain bigint; values typed in a field retain their exact rial.
export function catalogPricePosition(value: string | bigint, domain: CatalogPriceDomain): number {
  const amount = BigInt(value);
  const span = domain.maxRial - domain.minRial;
  if (span <= 0n || amount <= domain.minRial) return 0;
  if (amount >= domain.maxRial) return CATALOG_PRICE_SLIDER_STEPS;
  return Number(((amount - domain.minRial) * steps + span / 2n) / span);
}

export function catalogPriceAtPosition(position: number, domain: CatalogPriceDomain): string {
  if (!Number.isFinite(position)) throw new RangeError('Invalid price slider position');
  const point = BigInt(Math.round(Math.min(CATALOG_PRICE_SLIDER_STEPS, Math.max(0, position))));
  const span = domain.maxRial - domain.minRial;
  if (span <= 0n) return domain.minRial.toString();
  return (domain.minRial + (point * span + steps / 2n) / steps).toString();
}

// Rounded slider positions can coincide even when typed prices differ by one
// rial. Clamp against the exact opposite bound before deciding to clear an end.
export function catalogPriceForThumb(
  position: number,
  domain: CatalogPriceDomain,
  bound: 'min' | 'max',
  oppositeRial?: string,
): string | undefined {
  let amount = BigInt(catalogPriceAtPosition(position, domain));
  if (oppositeRial !== undefined) {
    const opposite = BigInt(oppositeRial);
    if ((bound === 'min' && amount > opposite) || (bound === 'max' && amount < opposite))
      amount = opposite;
  }
  const endpoint = bound === 'min' ? domain.minRial : domain.maxRial;
  return amount === endpoint ? undefined : amount.toString();
}

export function catalogPriceInput(value: string | bigint, locale: Locale): string {
  return formatToman(value, locale);
}

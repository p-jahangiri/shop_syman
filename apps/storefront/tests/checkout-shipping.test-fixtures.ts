// In-memory contract fixtures only; never persist store policy or sample orders.
import { quoteSnapshotSchema } from '@sayman/web-shared/lib/checkout/quote-contract.ts';
import { quote5Snapshot } from '@sayman/web-shared/testing/order-v2.test-fixtures.ts';

export function postpaidQuote<T extends { goodsTotalRial: string; chargeRules: object }>(quote: T) {
  const previous: Omit<T, 'shippingRial' | 'taxRial' | 'payableTotalRial' | 'chargeRules'> = quote;
  return {
    ...previous,
    shippingRial: '0',
    taxRial: null,
    payableTotalRial: quote.goodsTotalRial,
    chargeRules: {
      ...quote.chargeRules,
      version: 'AAAAAAAAAAQ=',
      shippingMode: 'postpaid' as const,
      shippingReason: 'postpaid' as const,
      shippingName: 'Recorded delivery name',
      shippingDescription: 'Recorded delivery description',
      shippingFeeRial: null,
      shippingFreeFromRial: null,
      taxMode: 'included_unitemized' as const,
      taxRateBasisPoints: null,
      taxBase: 'goods_shipping' as const,
      taxRounding: 'half_up' as const,
      taxableBaseRial: quote.goodsTotalRial,
      taxIncluded: true,
    },
  };
}

export function ordinaryPostpaidQuote() {
  const mixed = quote5Snapshot();
  const ordinary = Object.fromEntries(
    Object.entries(mixed.lines[0]).filter(
      ([key]) => !['lineId', 'lineKind', 'accepted'].includes(key),
    ),
  );
  ordinary.unitPriceRial = ordinary.lineTotalRial = '9007199254740993';
  return quoteSnapshotSchema.parse(
    postpaidQuote({
      ...Object.fromEntries(Object.entries(mixed).filter(([key]) => key !== 'canPay')),
      schemaVersion: 3,
      lines: [ordinary],
      itemsSubtotalRial: '9007199254740993',
      goodsTotalRial: '9007199254740993',
      chargeRules: mixed.chargeRules,
    }),
  );
}

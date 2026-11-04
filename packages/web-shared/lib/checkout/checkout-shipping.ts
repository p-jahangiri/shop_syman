type ShippingFacts = {
  shippingRequired: boolean;
  shippingMode?: 'postpaid';
  chargeRules?: { shippingMode: string; shippingReason: string } | null;
};

export function hasPostpaidShipping(value: ShippingFacts) {
  if (!value.shippingRequired) return false;
  return value.chargeRules
    ? value.chargeRules.shippingMode === 'postpaid' &&
        value.chargeRules.shippingReason === 'postpaid'
    : value.shippingMode === 'postpaid';
}

export function postpaidShippingAmountLabel(locale: 'fa' | 'en') {
  return locale === 'fa' ? 'پسکرایه؛ پرداخت جداگانه' : 'Pay carrier separately';
}

export function postpaidShippingNotice(locale: 'fa' | 'en') {
  return locale === 'fa'
    ? 'هزینهٔ حمل در مبلغ قابل پرداخت به فروشگاه لحاظ نشده است؛ مبلغ را حمل‌کننده مشخص می‌کند و جداگانه به او پرداخت می‌کنید. صفر بودن هزینهٔ دریافتی فروشگاه به معنی ارسال رایگان نیست.'
    : 'The store total excludes the carrier’s delivery charge. The carrier determines that amount and you pay it separately. Zero shipping collected by the store does not mean free delivery.';
}

export function hasUnitemizedTax(value: {
  taxIncluded?: boolean;
  taxBreakdownKnown?: false;
  chargeRules?: { taxMode: string; taxIncluded: boolean } | null;
}) {
  return value.chargeRules
    ? value.chargeRules.taxMode === 'included_unitemized' && value.chargeRules.taxIncluded
    : value.taxBreakdownKnown === false && value.taxIncluded === true;
}

export function unitemizedTaxLabel(locale: 'fa' | 'en') {
  return locale === 'fa' ? 'داخل قیمت؛ تفکیک نشده' : 'Included; not itemized';
}

export function unitemizedTaxNotice(locale: 'fa' | 'en') {
  return locale === 'fa'
    ? 'مالیات در قیمت لحاظ شده است و فعلاً نرخ یا مبلغ آن جداگانه تفکیک نشده؛ مالیات دیگری به جمع سفارش افزوده نمی‌شود.'
    : 'Tax is included in the price, with no separate rate or tax breakdown currently stated. No additional tax is added to the order total.';
}

using System.Globalization;
using System.Numerics;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public static class CheckoutChargeCalculator
{
    public static CheckoutCharges Calculate(long subtotal, long goodsTotal, bool physical, CheckoutChargePolicy policy, string locale)
    {
        if (subtotal < 0 || goodsTotal < subtotal) throw new BusinessException("invalid_charge_amount", "Use nonnegative, consistent integer rial amounts.");
        // The same validation also guards manually imported configuration.
        CheckoutChargePolicyService.Validate(new(policy.ShippingMode, policy.ShippingNameFa, policy.ShippingNameEn, policy.ShippingDescriptionFa, policy.ShippingDescriptionEn, Money(policy.ShippingFeeRial), Money(policy.ShippingFreeFromRial), policy.TaxMode, policy.TaxRateBasisPoints, policy.TaxBase, policy.TaxRounding, null));
        var shippingReason = !physical ? "digital" : policy.ShippingMode == "flat" && policy.ShippingFreeFromRial is { } threshold && subtotal >= threshold ? "threshold" : policy.ShippingMode;
        long? shipping = shippingReason switch { "digital" or "free" or "threshold" => 0, "flat" => policy.ShippingFeeRial, _ => null };
        BigInteger? taxBase = policy.TaxBase switch { "items" => subtotal, "goods" => goodsTotal, _ => shipping is null ? null : (BigInteger)goodsTotal + shipping.Value };
        if (taxBase > long.MaxValue) throw Limit();
        var included = policy.TaxMode == "inclusive";
        long? tax = policy.TaxMode switch { "exempt" => 0, "unconfigured" => null, _ => taxBase is null ? null : Rounded(taxBase.Value * policy.TaxRateBasisPoints!.Value, included ? 10000 + policy.TaxRateBasisPoints.Value : 10000, policy.TaxRounding) };
        BigInteger? payable = shipping is not null && tax is not null ? (BigInteger)goodsTotal + shipping.Value + (included ? 0 : tax.Value) : null;
        if (payable > long.MaxValue) throw Limit();
        var rules = new QuoteChargeRules(policy.Version.Length == 0 ? null : Convert.ToBase64String(policy.Version), policy.ShippingMode, locale == "en" ? policy.ShippingNameEn : policy.ShippingNameFa, locale == "en" ? policy.ShippingDescriptionEn : policy.ShippingDescriptionFa, Money(policy.ShippingFeeRial), Money(policy.ShippingFreeFromRial), shippingReason, policy.TaxMode, policy.TaxRateBasisPoints, policy.TaxBase, policy.TaxRounding, taxBase is null ? null : Money((long)taxBase.Value), included);
        return new(shipping, tax, payable is null ? null : (long)payable.Value, rules);
    }
    private static long Rounded(BigInteger numerator, BigInteger denominator, string mode)
    {
        var quotient = BigInteger.DivRem(numerator, denominator, out var remainder);
        if (remainder > 0 && (mode == "up" || mode == "half_up" && remainder * 2 >= denominator)) quotient++;
        if (quotient > long.MaxValue) throw Limit(); return (long)quotient;
    }
    private static string? Money(long? value) => value?.ToString(CultureInfo.InvariantCulture);
    private static BusinessException Limit() => new("quote_amount_limit", "The quote exceeds the supported integer rial amount.");
}

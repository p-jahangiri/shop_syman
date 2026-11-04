using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class CheckoutChargeTests
{
    private static CheckoutChargePolicy Policy(string mode = "exclusive", string basis = "goods", string rounding = "half_up", int? rate = 925) => new() { ShippingMode = "flat", ShippingFeeRial = 1999, ShippingNameFa = "ارسال ثابت", ShippingNameEn = "Flat delivery", TaxMode = mode, TaxRateBasisPoints = rate, TaxBase = basis, TaxRounding = rounding };
    [Fact] public void MissingPolicyDoesNotInventFreeDeliveryOrTax()
    {
        var physical = CheckoutChargeCalculator.Calculate(10003, 11234, true, new(), "en"); Assert.Null(physical.ShippingRial); Assert.Null(physical.TaxRial); Assert.Null(physical.PayableTotalRial); Assert.Null(physical.Rules.Version);
        var digital = CheckoutChargeCalculator.Calculate(10003, 11234, false, new(), "en"); Assert.Equal(0, digital.ShippingRial); Assert.Null(digital.TaxRial); Assert.Null(digital.PayableTotalRial); Assert.Equal("digital", digital.Rules.ShippingReason);
    }
    [Theory] [InlineData(9999, 1999, "flat")] [InlineData(10000, 0, "threshold")] [InlineData(10001, 0, "threshold")]
    public void FreeDeliveryThresholdUsesPrincipalAndIncludesItsBoundary(long subtotal, long fee, string reason)
    {
        var policy = Policy("exempt", rate: null); policy.ShippingFreeFromRial = 10000;
        var result = CheckoutChargeCalculator.Calculate(subtotal, 12000, true, policy, "fa"); Assert.Equal(fee, result.ShippingRial); Assert.Equal(reason, result.Rules.ShippingReason); Assert.Equal(12000 + fee, result.PayableTotalRial); Assert.Equal("ارسال ثابت", result.Rules.ShippingName);
    }
    [Theory] [InlineData("items", "down", 925)] [InlineData("items", "up", 926)] [InlineData("items", "half_up", 925)] [InlineData("goods", "half_up", 1039)] [InlineData("goods_shipping", "half_up", 1224)]
    public void ExclusiveTaxUsesSelectedBasisAndIntegerRounding(string basis, string rounding, long tax)
    {
        var result = CheckoutChargeCalculator.Calculate(10003, 11234, true, Policy(basis: basis, rounding: rounding), "en"); Assert.Equal(tax, result.TaxRial); Assert.Equal(11234 + 1999 + tax, result.PayableTotalRial); Assert.False(result.Rules.TaxIncluded);
    }
    [Theory] [InlineData("down", 50)] [InlineData("up", 51)] [InlineData("half_up", 51)]
    public void IncludedTaxIsExtractedAndNeverChargedTwice(string rounding, long tax)
    {
        var policy = Policy("inclusive", rounding: rounding, rate: 10000); policy.ShippingMode = "free"; policy.ShippingFeeRial = null;
        var result = CheckoutChargeCalculator.Calculate(101, 101, true, policy, "en"); Assert.Equal(tax, result.TaxRial); Assert.Equal(101, result.PayableTotalRial); Assert.True(result.Rules.TaxIncluded);
    }
    [Fact] public void ConfiguredTaxCanWaitForMissingShippingBasisWithoutBecomingExempt()
    {
        var policy = Policy(basis: "goods_shipping"); policy.ShippingMode = "unconfigured"; policy.ShippingFeeRial = null;
        var waiting = CheckoutChargeCalculator.Calculate(10003, 11234, true, policy, "en"); Assert.Null(waiting.Rules.TaxableBaseRial); Assert.Null(waiting.TaxRial); Assert.Null(waiting.PayableTotalRial);
        policy.TaxBase = "goods"; var knownTax = CheckoutChargeCalculator.Calculate(10003, 11234, true, policy, "en"); Assert.Equal(1039, knownTax.TaxRial); Assert.Null(knownTax.PayableTotalRial);
    }
    [Fact] public void LargeIntermediateValuesStayExactAndOverflowIsRejected()
    {
        var inclusive = CheckoutChargeCalculator.Calculate(long.MaxValue, long.MaxValue, false, Policy("inclusive", rate: 10000), "en"); Assert.Equal(4611686018427387904, inclusive.TaxRial); Assert.Equal(long.MaxValue, inclusive.PayableTotalRial);
        Assert.Equal("quote_amount_limit", Assert.Throws<BusinessException>(() => CheckoutChargeCalculator.Calculate(long.MaxValue, long.MaxValue, false, Policy(), "en")).Code);
        Assert.Equal("quote_amount_limit", Assert.Throws<BusinessException>(() => CheckoutChargeCalculator.Calculate(long.MaxValue, long.MaxValue, true, Policy("inclusive", "goods_shipping"), "en")).Code);
    }
    [Theory] [InlineData("zero-fee")] [InlineData("hidden-fee")] [InlineData("zero-threshold")] [InlineData("empty-name")] [InlineData("null-description")] [InlineData("unknown-mode")] [InlineData("zero-rate")] [InlineData("excess-rate")] [InlineData("hidden-rate")] [InlineData("invalid-base")] [InlineData("invalid-rounding")]
    public void InvalidPoliciesFailBeforeDatabaseAccess(string kind)
    {
        var input = new CheckoutChargePolicyInput("flat", "ارسال", "Delivery", "", "", "1999", null, "exclusive", 925, "goods", "half_up", null);
        input = kind switch { "zero-fee" => input with { ShippingFeeRial = "0" }, "hidden-fee" => input with { ShippingMode = "free" }, "zero-threshold" => input with { ShippingFreeFromRial = "0" }, "empty-name" => input with { ShippingNameEn = "" }, "null-description" => input with { ShippingDescriptionEn = null! }, "unknown-mode" => input with { ShippingMode = "provider" }, "zero-rate" => input with { TaxRateBasisPoints = 0 }, "excess-rate" => input with { TaxRateBasisPoints = 10001 }, "hidden-rate" => input with { TaxMode = "unconfigured" }, "invalid-base" => input with { TaxBase = "unknown" }, _ => input with { TaxRounding = "unknown" } };
        Assert.Equal("invalid_charge_policy", Assert.Throws<BusinessException>(() => CheckoutChargePolicyService.Validate(input)).Code);
    }
    [Fact] public void IncludedAndExclusiveModesPreservePaymentInvariantsForLargeAmounts()
    {
        var random = new Random(6130);
        for (var i = 0; i < 200; i++) {
            var subtotal = random.NextInt64(1, 90071992547409930); var goods = subtotal + random.Next(0, 10000); var policy = Policy(i % 2 == 0 ? "inclusive" : "exclusive", "goods_shipping", rate: random.Next(1, 10001));
            var result = CheckoutChargeCalculator.Calculate(subtotal, goods, true, policy, "en"); Assert.True(result.TaxRial >= 0); Assert.Equal(goods + 1999, long.Parse(result.Rules.TaxableBaseRial!)); Assert.Equal(goods + 1999 + (result.Rules.TaxIncluded ? 0 : result.TaxRial), result.PayableTotalRial);
        }
    }
}

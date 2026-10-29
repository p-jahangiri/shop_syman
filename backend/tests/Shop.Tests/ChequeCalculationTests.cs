using System.Globalization;
using System.Numerics;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class ChequeCalculationTests
{
    private static CreditPlanData Plan(int months = 6, int markup = 1250, int down = 2500, int interval = 2, int unit = 10) => new("p", "Plan", months, markup, down, interval, true, [], null, null, unit);
    [Fact] public void FractionalRatesRoundInRialAndRemainderGoesToLastCheque()
    {
        var result = ChequeCalculator.Calculate(100003, Plan());
        Assert.Equal(25010, result.DownPaymentRial); Assert.Equal(9380, result.MarkupRial); Assert.Equal(109383, result.GoodsTotalRial);
        Assert.Equal(new[] { "28120", "28120", "28133" }, result.Installments.Select(x => x.AmountRial)); Assert.Equal(new[] { 2, 4, 6 }, result.Installments.Select(x => x.MonthOffset));
    }
    [Theory] [InlineData(0)] [InlineData(1)] [InlineData(9)] [InlineData(11)] [InlineData(long.MaxValue)]
    public void FullDownPaymentNeverExceedsPrincipalOrProducesCheques(long amount)
    {
        var result = ChequeCalculator.Calculate(amount, Plan(down: 10000)); Assert.Equal(amount, result.DownPaymentRial); Assert.Equal(0, result.MarkupRial); Assert.Empty(result.Installments);
    }
    [Fact] public void IntermediateMultiplicationCanExceedInt64WithoutLosingPrecision()
    {
        var result = ChequeCalculator.Calculate(long.MaxValue, Plan(markup: 0, down: 5000, unit: 1));
        Assert.Equal(4611686018427387904, result.DownPaymentRial); Assert.Equal(long.MaxValue, result.GoodsTotalRial);
        Assert.Equal((BigInteger)long.MaxValue, result.Installments.Aggregate(new BigInteger(result.DownPaymentRial), (s, x) => s + BigInteger.Parse(x.AmountRial, CultureInfo.InvariantCulture)));
    }
    [Fact] public void UnrepresentableTotalFailsInsteadOfWrapping()
    {
        Assert.Equal("quote_amount_limit", Assert.Throws<BusinessException>(() => ChequeCalculator.Calculate(long.MaxValue, Plan(down: 0))).Code);
    }
    [Fact] public void SmallAmountDoesNotCreateZeroCheques()
    {
        Assert.Equal("cheque_amount_too_small", Assert.Throws<BusinessException>(() => ChequeCalculator.Calculate(5, Plan(markup: 0, down: 0))).Code);
        Assert.Equal("5", Assert.Single(ChequeCalculator.Calculate(5, Plan(months: 1, markup: 0, down: 0, interval: 1)).Installments).AmountRial);
    }
    [Fact] public void SupportedTermsPreserveEveryRialAcrossManyAmounts()
    {
        var random = new Random(4217);
        for (var i = 0; i < 200; i++) {
            var amount = random.NextInt64(100000, 90071992547409930); var plan = Plan(months: 60, markup: random.Next(0, 100001), down: random.Next(0, 10001), interval: 3, unit: i % 2 == 0 ? 1 : 10);
            var result = ChequeCalculator.Calculate(amount, plan); var cheques = result.Installments.Select(x => BigInteger.Parse(x.AmountRial, CultureInfo.InvariantCulture)).ToArray();
            Assert.InRange(result.DownPaymentRial, 0, amount); Assert.All(cheques, x => Assert.True(x > 0));
            Assert.Equal(new BigInteger(result.GoodsTotalRial), cheques.Aggregate(new BigInteger(result.DownPaymentRial), (s, x) => s + x));
            Assert.All(cheques.SkipLast(1), x => Assert.Equal(BigInteger.Zero, x % plan.RoundingUnitRial));
        }
    }
    [Theory] [InlineData(-1, 6, 2, 1)] [InlineData(100, 7, 2, 1)] [InlineData(100, 61, 1, 1)] [InlineData(100, 6, 0, 1)] [InlineData(100, 6, 2, 5)]
    public void InvalidTermsFail(long amount, int months, int interval, int unit) => Assert.Equal("invalid_cheque_terms", Assert.Throws<BusinessException>(() => ChequeCalculator.Calculate(amount, Plan(months: months, interval: interval, unit: unit))).Code);
}

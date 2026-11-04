using System.Numerics;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed record ChequeAmount(int Sequence, int MonthOffset, string AmountRial);
public sealed record ChequeCalculation(long DownPaymentRial, long MarkupRial, long GoodsTotalRial, ChequeAmount[] Installments);
public static class ChequeCalculator
{
    public static ChequeCalculation Calculate(long amount, CreditPlanData plan)
    {
        if (amount < 0 || plan.Months is < 1 or > 60 || plan.IntervalMonths < 1 || plan.Months % plan.IntervalMonths != 0 || plan.MarkupBasisPoints is < 0 or > 100000 || plan.DownPaymentBasisPoints is < 0 or > 10000 || plan.RoundingUnitRial is not (1 or 10)) throw new BusinessException("invalid_cheque_terms", "Invalid cheque calculation terms.");
        var unit = new BigInteger(plan.RoundingUnitRial);
        static BigInteger Ceil(BigInteger numerator, BigInteger denominator) => (numerator + denominator - 1) / denominator;
        var down = BigInteger.Min(amount, Ceil((BigInteger)amount * plan.DownPaymentBasisPoints, 10000 * unit) * unit);
        var financed = amount - down; var markup = Ceil(financed * plan.MarkupBasisPoints, 10000 * unit) * unit; var totalCredit = financed + markup;
        var goodsTotal = (BigInteger)amount + markup;
        if (goodsTotal > long.MaxValue) throw new BusinessException("quote_amount_limit", "The quote exceeds the supported integer rial amount.");
        if (totalCredit == 0) return new((long)down, (long)markup, (long)goodsTotal, []);
        var count = plan.Months / plan.IntervalMonths; var regular = (totalCredit / unit) / count * unit;
        if (count > 1 && regular == 0) throw new BusinessException("cheque_amount_too_small", "This amount cannot produce positive cheques for the selected plan.");
        var installments = Enumerable.Range(1, count).Select(i => new ChequeAmount(i, checked(i * plan.IntervalMonths), (i == count ? totalCredit - regular * (count - 1) : regular).ToString(System.Globalization.CultureInfo.InvariantCulture))).ToArray();
        return new((long)down, (long)markup, (long)goodsTotal, installments);
    }
}

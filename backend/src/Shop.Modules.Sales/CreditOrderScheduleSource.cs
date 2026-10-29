using System.Globalization;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed class SalesCreditOrderScheduleSource(SalesDbContext db,CreditOrderService orders,OrderV2Service pages):ICreditOrderScheduleSource
{
    public async Task<CreditScheduleOrderPageSource> PageForFinanceAsync(string? cursor,CancellationToken ct)
    {
        var page=await pages.ListCreditForScheduleAsync(cursor,ct);return new(1,page.Items.Select(o=>new CreditScheduleOrderSummarySource(o.Id,o.OwnerId??throw CreditScheduleRulesMissing(),o.Reference,o.Locale,o.State,o.CreatedAt,o.ExpiresAt,o.PayableTotalRial,o.ItemCount,o.Version)).ToArray(),page.NextCursor);
    }
    private static BusinessException CreditScheduleRulesMissing()=>new("credit_order_unavailable","The scoped cheque order owner could not be read.");
    public async Task<CreditOrderScheduleSource> LockAndReadAsync(string owner,string orderId,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(orderId);CartOfferRules.RequireParent(db);await OrderV2Locks.OwnerAsync(db,owner,ct);
        var detail=await orders.DetailAsync(owner,orderId,ct);var c=detail.Credit;var quote=detail.Calculation;var ordinary=quote.OrdinaryQuote;var accepted=quote.AcceptedQuote;var order=detail.Order;var plan=ordinary?.SelectedPlan??accepted!.SelectedPlan!;
        return new(owner,orderId,order.Summary.Version,order.Summary.State,order.Summary.CreatedAt,order.Summary.ExpiresAt,c.ApplicationId,c.ScopeId,c.CreditQuoteId,c.QuoteFingerprint,quote.Locale,plan.Name,Parse(order.PayableTotalRial),Parse(ordinary?.DownPaymentRial??accepted!.DownPaymentRial),(ordinary?.Installments??accepted!.Installments).Select(x=>new CreditScheduleInstallmentSource(x.Sequence,x.MonthOffset,Parse(x.AmountRial))).ToArray(),new(c.ScopeId,c.ApplicationId,c.OrderId,c.CreditQuoteId,c.QuoteFingerprint,Parse(c.AssessedAmountRial),c.AcceptedAt));
    }
    private static long Parse(string value)=>long.Parse(value,NumberStyles.None,CultureInfo.InvariantCulture);
}

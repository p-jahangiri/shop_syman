using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed class CreditOrderFinanceSummaryReader(SalesDbContext db,TimeProvider clock):ICreditOrderFinanceSummaries
{
    public async Task<CreditScheduleOrderSummarySource[]> ReadAsync(IReadOnlyList<string> ids,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);if(ids.Count is<1 or>20||ids.Distinct(StringComparer.Ordinal).Count()!=ids.Count)throw new BusinessException("invalid_cheque_report","At most twenty distinct server-selected orders are permitted.");foreach(var id in ids)CreditCheckoutQuoteRules.Id(id);var now=clock.GetUtcNow();var rows=await db.Orders.AsNoTracking().Where(x=>ids.Contains(x.Id)&&db.CreditOrderLinks.Any(l=>l.OrderId==x.Id)).Select(x=>new{Order=x,Count=x.SnapshotVersion==2?x.LinesV2.Sum(l=>l.Quantity):x.Lines.Sum(l=>l.Quantity)}).ToArrayAsync(ct);if(rows.Length!=ids.Count)throw new BusinessException("cheque_report_unavailable","The complete retained credit order summary is unavailable.");return rows.Select(x=>new CreditScheduleOrderSummarySource(x.Order.Id,x.Order.OwnerId.ToUpperInvariant(),"SM-"+x.Order.Number.ToString(CultureInfo.InvariantCulture),x.Order.Locale,x.Order.State==OrderState.AwaitingPayment&&x.Order.ExpiresAt<=now?"Expired":x.Order.State.ToString(),x.Order.CreatedAt,x.Order.ExpiresAt,x.Order.PayableTotalRial.ToString(CultureInfo.InvariantCulture),x.Count,Convert.ToBase64String(x.Order.Version))).ToArray();
    }
}

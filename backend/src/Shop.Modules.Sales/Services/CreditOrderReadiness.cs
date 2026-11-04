using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed partial class CreditOrderService
{
    public async Task<CreditOrderReadiness> ReadinessAsync(string owner,string quoteId,CancellationToken ct)
    {
        owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(quoteId);CartOfferRules.RequireParent(db);await OrderV2Locks.OwnerAsync(db,owner,ct);
        // Ownership and protected historical integrity are checked before any
        // conflict is converted into a UI blocker. A stranger still gets 404.
        var historical=await quotes.DetailAsync(owner,quoteId,ct);
        try{
            var current=await quotes.ValidateForOrderAsync(owner,quoteId,historical.Fingerprint,ct);var policy=await settings.ReadAsync(ct);
            var reviewPolicy=ChequeReviewHoldService.Option(await reviewHolds.CurrentAsync(ct));
            var blockers=new List<string>();if(await OrderCommandQueries.OpenCountAsync(db,owner,clock.GetUtcNow(),ct)>=policy.MaxOpenOrdersPerCustomer)blockers.Add("open_order_limit_conflict");
            if(await OrderCommandQueries.QuoteExistsAsync(db,owner,current.BaseQuote.Id,ct))blockers.Add("quote_already_ordered_conflict");
            return new(1,quoteId,historical.Fingerprint,historical.ExpiresAt,blockers.Count==0,blockers.ToArray(),ReviewHold:reviewPolicy);
        }catch(BusinessException e)when(e.Code.Contains("conflict",StringComparison.Ordinal)){return new(1,quoteId,historical.Fingerprint,historical.ExpiresAt,false,[e.Code]);}
    }
}

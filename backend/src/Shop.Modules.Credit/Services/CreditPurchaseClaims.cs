using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;
public sealed partial class CreditPurchaseScopeService
{
    public async Task<CreditPurchaseUse> ClaimAsync(CreditPurchaseClaim input,CancellationToken ct)
    {
        if(input is null||input.Authority is null)throw CreditPurchaseScopeRules.Invalid();
        var owner=CreditApplicationRules.Actor(input.OwnerId);CreditApplicationRules.Id(input.OrderId);CreditApplicationRules.Id(input.CreditQuoteId);CreditApplicationRules.Digest(input.QuoteFingerprint);
        var requested=input.Authority;
        // Revalidate in the root order transaction. This acquires the same
        // Credit gates which the coordinator must take before any Stock lock.
        var current=await ForQuoteAsync(owner,requested.ApplicationId,requested.ScopeId,requested.ApplicationVersion,requested.ScopeVersion,ct);
        if(current!=requested||input.AssessedAmountRial<0||input.AssessedAmountRial>current.LimitAmountRial||current.LimitBasis=="PayableTotalRial"&&input.AssessedAmountRial==0)throw CreditPurchaseScopeRules.Conflict();
        if(await db.PurchaseScopeUses.AnyAsync(x=>x.OrderId==input.OrderId||x.CreditQuoteId==input.CreditQuoteId,ct))throw CreditPurchaseScopeRules.Conflict();
        var app=await Visible(owner,false,current.ApplicationId,true,ct);var at=Now(app);
        if(at>=current.ExpiresAt)throw CreditPurchaseScopeRules.Conflict();
        db.PurchaseScopeUses.Add(new(){ScopeId=current.ScopeId,ApplicationId=current.ApplicationId,OrderId=input.OrderId,CreditQuoteId=input.CreditQuoteId,QuoteFingerprint=input.QuoteFingerprint,ActorId=owner,AssessedAmountRial=input.AssessedAmountRial,At=at});
        Event(app,owner,"ScopeUsed",at);await db.SaveChangesAsync(ct);
        if(current.ExpiresAt<=clock.GetUtcNow())throw CreditPurchaseScopeRules.Conflict();
        return new(current.ScopeId,current.ApplicationId,input.OrderId,input.CreditQuoteId,input.QuoteFingerprint,input.AssessedAmountRial,at);
    }
}

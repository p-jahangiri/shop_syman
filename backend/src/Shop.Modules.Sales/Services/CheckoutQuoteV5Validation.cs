using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed record ValidatedOrderQuoteV5(CheckoutQuote Stored,CheckoutQuoteV5Data Data,PreparedQuoteAgreementV5[] Agreements);
public sealed partial class CheckoutQuoteV5Service
{
    internal Task<ValidatedOrderQuoteV5> ValidateForOrderAsync(string owner,string quoteId,CancellationToken ct)=>ValidateOrderCore(owner,quoteId,false,ct);
    internal Task<ValidatedOrderQuoteV5> ValidateForCreditOrderAsync(string owner,string quoteId,CancellationToken ct)=>ValidateOrderCore(owner,quoteId,true,ct);
    private async Task<ValidatedOrderQuoteV5> ValidateOrderCore(string owner,string quoteId,bool credit,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);await carts.LockForCheckoutAsync(owner,ct);
        var identity=new CartIdentity(owner,null);var cart=await carts.FindAsync(identity,false,ct);CartService.EnsureCapacity(cart);
        var actor=CartService.ActorKey(identity);
        var stored=await db.Quotes.AsNoTracking().SingleOrDefaultAsync(q=>q.Id==quoteId&&q.ActorKey==actor,ct)??throw new BusinessException("not_found","Quote not found.");
        // Version authority precedes deserialization. A Quote4 never acquires
        // new purchasing permission as the application evolves.
        if(stored.ContractVersion!=5)throw new BusinessException("quote_contract_conflict","A new order-capable Quote5 is required.");
        if(stored.ExpiresAt<=clock.GetUtcNow())throw new BusinessException("quote_expired_conflict","Calculate current conditions before creating an order.");
        var snapshot=JsonSerializer.Deserialize<CheckoutQuoteV5Data>(stored.ResponseJson,SnapshotJson)??throw new InvalidOperationException("Invalid Quote5 snapshot.");
        if(snapshot.SchemaVersion!=5||snapshot.QuoteId!=stored.Id||snapshot.SelectedMethod is null||snapshot.TemporaryOrder is null||snapshot.ExpiresAt!=stored.ExpiresAt||snapshot.CreatedAt!=stored.CreatedAt)throw new BusinessException("quote_version_conflict","A fresh order-capable quote is required.");
        if(!allowDemo&&snapshot.Lines.Any(l=>l.Accepted?.ContainsDemo==true))throw CartOfferRules.Missing();
        if(cart is null||cart.OfferLines.Count==0||Convert.ToBase64String(cart.Version)!=stored.CartVersion)throw new BusinessException("cart_version_conflict","The cart changed after this quote.");
        // No Stock read or inventory application lock is taken here. HoldV2
        // obtains request/reservation, all allocations and then Stock, and is
        // the exact final stock proof in this same Serializable transaction.
        var current=await CalculateAsync(owner,cart,snapshot.Locale,snapshot.SelectedMethod.Id,snapshot.SelectedPlan?.Id,stored.Id,stored.CreatedAt,stored.ExpiresAt,false,ct);
        if(current.Data.PricingFingerprint!=stored.PricingFingerprint||snapshot.PricingFingerprint!=stored.PricingFingerprint)throw new BusinessException("quote_changed_conflict","Price, accepted terms, purchase conditions or checkout settings changed. Calculate again.");
        if(credit)CreditOrderEligibility.Require(await orderSettings.ReadAsync(ct),current.Data.SelectedMethod,current.Data.SelectedPlan,current.Data.PayableTotalRial,current.Data.Blockers);
        else if(current.Data.TemporaryOrder?.CanCreate!=true)throw new BusinessException("temporary_order_unavailable_conflict","This purchase method or its charges are unavailable for temporary ordering.");
        if(stored.ExpiresAt<=clock.GetUtcNow())throw new BusinessException("quote_expired_conflict","The order quote expired while validating its authorities.");
        return new(stored,snapshot,current.Agreements);
    }
}

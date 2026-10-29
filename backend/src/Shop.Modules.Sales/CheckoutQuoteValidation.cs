using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed partial class CheckoutQuoteService
{
    internal Task<(CheckoutQuote Stored, CheckoutQuoteData Data)> ValidateForOrderAsync(string ownerId,string quoteId,CancellationToken ct)=>ValidateOrderCore(ownerId,quoteId,false,ct);
    internal Task<(CheckoutQuote Stored, CheckoutQuoteData Data)> ValidateForCreditOrderAsync(string ownerId,string quoteId,CancellationToken ct)=>ValidateOrderCore(ownerId,quoteId,true,ct);
    private async Task<(CheckoutQuote Stored, CheckoutQuoteData Data)> ValidateOrderCore(string ownerId,string quoteId,bool credit,CancellationToken ct)
    {
        if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Order validation requires the checkout transaction.");
        await carts.LockForCheckoutAsync(ownerId, ct); var identity = new CartIdentity(ownerId, null); var actor = CartService.ActorKey(identity);
        // Read the live cart before interpreting an older quote. Cart1 cannot
        // represent accepted offer lines, even when that quote has expired.
        var cart = await carts.ReadContentsAsync(identity, ct);
        var quote = await db.Quotes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == quoteId && x.ActorKey == actor, ct) ?? throw new BusinessException("not_found", "Quote not found.");
        if (quote.ContractVersion is not (null or 3)) throw new BusinessException("quote_contract_conflict", "This quote contract cannot create an order through the legacy workflow.");
        if (quote.ExpiresAt <= clock.GetUtcNow()) throw new BusinessException("quote_expired_conflict", "Calculate current conditions before creating an order.");
        var snapshot = JsonSerializer.Deserialize<CheckoutQuoteData>(quote.ResponseJson, SnapshotJson) ?? throw new InvalidOperationException("Invalid quote snapshot.");
        if (snapshot.SchemaVersion != 3 || snapshot.SelectedMethod is null || snapshot.TemporaryOrder is null) throw new BusinessException("quote_version_conflict", "A fresh order-capable quote is required.");
        if (cart.Version != quote.CartVersion || cart.Lines.Length == 0) throw new BusinessException("cart_version_conflict", "Your cart changed after the quote.");
        // Recalculate without saving or renewing a quote. Only the original,
        // immutable snapshot is returned after current terms match it exactly.
        var current = await CalculateAsync(snapshot.Locale, new(quote.CartVersion, snapshot.SelectedMethod.Id, snapshot.SelectedPlan?.Id, null), cart, quote.Id, quote.CreatedAt, quote.ExpiresAt, false, ct);
        if (current.PricingFingerprint != quote.PricingFingerprint) throw new BusinessException("quote_changed_conflict", "Price, purchase conditions or checkout settings changed. Calculate again.");
        if(credit)CreditOrderEligibility.Require(await orderSettings.ReadAsync(ct),current.SelectedMethod,current.SelectedPlan,current.PayableTotalRial,current.Blockers);
        else if (current.TemporaryOrder?.CanCreate != true) throw new BusinessException("temporary_order_unavailable_conflict", "This purchase method or its charges are not ready for a temporary order.");
        return (quote, snapshot);
    }
}

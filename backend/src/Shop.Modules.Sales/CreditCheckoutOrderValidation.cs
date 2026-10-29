using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed record ValidatedCreditOrderQuote(CreditCheckoutQuote Stored,CreditCheckoutQuoteData Data,CreditPurchaseAuthority Authority,CheckoutQuote BaseQuote,CheckoutQuoteData? Ordinary,CheckoutQuoteV5Data? Accepted,PreparedQuoteAgreementV5[] Agreements);
public sealed partial class CreditCheckoutQuoteService
{
    internal async Task<ValidatedCreditOrderQuote> ValidateForOrderAsync(string owner,string quoteId,string fingerprint,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);owner=CreditCheckoutQuoteRules.Owner(owner);CreditCheckoutQuoteRules.Id(quoteId);
        // A missing ID must not retain an empty-index range before the Credit gate.
        var row=await db.CreditCheckoutQuotes.FromSqlInterpolated($"SELECT * FROM [sales].[CreditCheckoutQuotes] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={owner} AND [Id]={quoteId}").AsNoTracking().SingleOrDefaultAsync(ct)??throw CreditCheckoutQuoteRules.Missing();var snapshot=Read(row).Quote;
        if(row.Fingerprint!=fingerprint)throw new BusinessException("credit_quote_changed_conflict","Accept the exact retained cheque calculation fingerprint.");
        if(row.ExpiresAt<=clock.GetUtcNow())throw new BusinessException("credit_quote_expired_conflict","Calculate current cheque conditions before placing an order.");
        if(snapshot.Assessment.WithinLimit!=true||snapshot.Assessment.AssessedAmountRial is null||snapshot.Assessment.Blockers.Length!=1||snapshot.Assessment.Blockers[0]!="credit_order_not_configured")throw new BusinessException("credit_order_unavailable_conflict","Final charges and this scope's amount must be fully determined and within its limit.");
        // These gates precede cart/allocation/Stock, including the later claim.
        var authority=await scopes.ForQuoteAsync(owner,row.ApplicationId,row.ScopeId,row.ApplicationVersion,row.ScopeVersion,ct);
        if(!Same(CreditQuoteAssessment.Snapshot(authority),snapshot.Authority))throw new BusinessException("credit_quote_changed_conflict","The retained purchase authority differs from its current scope.");
        CheckoutQuote baseQuote;PreparedQuoteAgreementV5[] groups=[];
        if(row.BaseContractVersion==3){var current=await ordinary.ValidateForCreditOrderAsync(owner,row.BaseQuoteId,ct);baseQuote=current.Stored;}
        else if(row.BaseContractVersion==5){var current=await accepted.ValidateForCreditOrderAsync(owner,row.BaseQuoteId,ct);baseQuote=current.Stored;groups=current.Agreements;}
        else throw CreditCheckoutQuoteRules.Unavailable();
        if(Hash(baseQuote.ResponseJson)!=row.BaseSnapshotHash||baseQuote.ExpiresAt<row.ExpiresAt||row.ExpiresAt<=clock.GetUtcNow())throw new BusinessException("credit_quote_changed_conflict","The complete original quote snapshot is unavailable or expired.");
        return new(row,snapshot,authority,baseQuote,snapshot.OrdinaryQuote,snapshot.AcceptedQuote,groups);
    }
}

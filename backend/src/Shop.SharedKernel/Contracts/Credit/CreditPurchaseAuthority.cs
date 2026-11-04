namespace Shop.SharedKernel;
// A scope is a bounded authority for one future purchase, not a payment or an
// inventory reservation. Consumers must revalidate it in their root transaction.
public sealed record CreditPurchaseAuthority(string ApplicationId,string ApplicationVersion,string ScopeId,string ScopeVersion,string ReviewId,string SubmissionId,string LimitBasis,long LimitAmountRial,DateTimeOffset ExpiresAt,string PlanId,string PlanVersion,string PlanSnapshotHash);
public interface ICreditPurchaseScopeReader
{
    Task<CreditPurchaseAuthority> ForQuoteAsync(string owner,string applicationId,string scopeId,string applicationVersion,string scopeVersion,CancellationToken ct);
}

// Root order coordination owns the surrounding audited Serializable transaction.
// A claim consumes the whole one-purchase scope, including a zero financed part.
public sealed record CreditPurchaseClaim(string OwnerId,CreditPurchaseAuthority Authority,string OrderId,string CreditQuoteId,string QuoteFingerprint,long AssessedAmountRial);
public sealed record CreditPurchaseUse(string ScopeId,string ApplicationId,string OrderId,string CreditQuoteId,string QuoteFingerprint,long AssessedAmountRial,DateTimeOffset At);
public interface ICreditPurchaseScopeClaims
{
    Task<CreditPurchaseUse> ClaimAsync(CreditPurchaseClaim input,CancellationToken ct);
}

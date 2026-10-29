namespace Shop.SharedKernel;

// Provider-neutral integration contracts, not a vendor HTTP protocol. A real
// adapter needs its own official contract and sandbox verification. No product
// test gateway or success substitute is registered.
public sealed record CashGatewayStart(string AttemptId, string OrderId, long AmountRial,
    string Currency, Uri ReturnUri);
public sealed record CashGatewayStarted(string State, string? Authority, Uri? RedirectUri);
public sealed record CashGatewayVerify(string AttemptId, string Authority, long AmountRial, string Currency);
public sealed record CashGatewayVerified(string State, string? Authority, long? AmountRial,
    string? Currency, string? Reference);
public interface ICashPaymentGateway
{
    string ProviderKey {get;}
    string AccountKey {get;}
    // Explicit stable create keys/status recovery are required before enabling
    // initiation. A network timeout never means that initiation failed.
    bool IsConfigured {get;}
    bool SupportsIdempotentInitiation {get;}
    IReadOnlySet<string> AllowedRedirectHosts {get;}
    Task<CashGatewayStarted> StartAsync(CashGatewayStart request,CancellationToken ct);
    Task<CashGatewayVerified> VerifyAsync(CashGatewayVerify request,CancellationToken ct);
}
// Raw remote authorities are not public identifiers and must be protected at
// rest by the host's own key ring. Module code only sees this narrow contract.
public interface IPaymentAuthorityProtection
{
    byte[] Protect(string attemptId,string value);
    string Unprotect(string attemptId,byte[] value);
}

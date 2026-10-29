using System.Security.Cryptography;
using System.Text.Json;

namespace Shop.SharedKernel;

// Internal integration boundary only. No HTTP endpoint accepts a verification
// fact. A future configured gateway must independently verify the frozen
// attempt/authority/amount with the provider before constructing this fact.
public sealed record VerifiedCashPayment(string AttemptId, string VerificationId, string OrderId, string OwnerId,
    string MethodId, long AmountRial, string SnapshotFingerprint, string ProviderKey, string AccountKey,
    string AuthorityHash, string ReferenceHash, DateTimeOffset VerifiedAt);
public sealed record CashOrderPaymentReadiness(int SchemaVersion, string OrderId, string OwnerId, string State,
    string Version, string MethodId, long AmountRial, string SnapshotFingerprint, DateTimeOffset ExpiresAt,
    bool ContainsDemo, bool CanInitiate, string[] Blockers);
public sealed record CashOrderSettlement(int SchemaVersion, string AttemptId, string VerificationId,
    string OrderId, string Disposition, string Reason, string AmountRial, string OrderVersion,
    DateTimeOffset RecordedAt, bool ContainsDemo, bool Replayed);
public interface ICashPaymentOrders
{
    Task LockOwnerAsync(string ownerId,CancellationToken ct);
    Task<CashOrderPaymentReadiness> ReadAsync(string ownerId, string orderId, CancellationToken ct);
    Task<CashOrderSettlement> ConfirmVerifiedAsync(VerifiedCashPayment proof, CancellationToken ct);
}
public static class CashPaymentProofRules
{
    public static VerifiedCashPayment Normalize(VerifiedCashPayment p)
    {
        if(p is null || p.AmountRial<=0 || !Key(p.OwnerId,64) || !Key(p.MethodId,64)
            || !Key(p.ProviderKey,40) || !Key(p.AccountKey,64) || p.VerifiedAt==default)throw Invalid();
        return p with {AttemptId=Id(p.AttemptId),VerificationId=Id(p.VerificationId),OrderId=Id(p.OrderId),
            SnapshotFingerprint=Hash(p.SnapshotFingerprint),ProviderKey=p.ProviderKey.ToLowerInvariant(),AccountKey=p.AccountKey.ToLowerInvariant(),AuthorityHash=Hash(p.AuthorityHash),ReferenceHash=Hash(p.ReferenceHash),VerifiedAt=p.VerifiedAt.ToUniversalTime()};
    }
    public static string Fingerprint(VerifiedCashPayment p)
    {
        p=Normalize(p);return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(p with{OwnerId=p.OwnerId.ToUpperInvariant(),MethodId=p.MethodId.ToUpperInvariant()})));
    }
    public static string Id(string s)=>s is {Length:32}&&Guid.TryParseExact(s,"N",out var id)&&id!=Guid.Empty&&id.ToString("N")==s?s:throw Invalid();
    public static string Hash(string s)=>s is {Length:64}&&s.All(c=>c is >= '0' and <= '9' or >= 'A' and <= 'F')?s:throw Invalid();
    public static bool Key(string? s,int max)=>s is {Length:>0}&&s.Length<=max&&s.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_');
    private static BusinessException Invalid()=>new("invalid_payment_proof","A complete provider-verified, order-bound cash payment fact is required.");
}

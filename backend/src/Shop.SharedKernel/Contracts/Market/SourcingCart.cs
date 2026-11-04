using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

// Prices and quantities are supplied by the accepted server-side plan only.
// RequestId is the command UUID; the target request/offer belongs to the route.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingConversionInput(
    string RequestId,string TaskId,string RequestVersion,string TaskVersion,
    string OfferVersion,string AcceptanceId,string AgreementId,string AgreementVersion,
    string AllocationId,string AllocationVersion,string TermsHash,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? CartVersion);

public sealed record SourcingCartLineLink(string LineId,string AgreementLineId,string OfferLineId);

// Historical command receipt. A replay does not re-add deleted cart lines and
// never represents a current stock or checkout capability.
public sealed record SourcingConversionMutation(
    int SchemaVersion,string ConversionId,string RequestId,string TaskId,string OfferId,
    string AcceptanceId,string AgreementId,string AllocationId,string CartId,string CartVersion,
    SourcingCartLineLink[] Lines,string CommandId,DateTimeOffset At,bool Replayed,
    bool CanCheckout=false,bool CanPay=false);

// Price-free, owner-checked Inventory proof. No device identities or customer
// identifiers cross into the customer projection or Sales conversion writer.
public sealed record SourcingStockConversionProof(
    string AllocationId,string RequestId,string TaskId,string OfferId,string AcceptanceId,
    string TermsHash,string Version,DateTimeOffset ExpiresAt,bool IsDemo,
    SourcingAllocationSummaryLine[] Lines);

public interface IInventorySourcingConversionGuard
{
    Task<SourcingStockConversionProof?> ReadActiveAsync(string ownerId,string acceptanceId,CancellationToken ct);
    Task<SourcingStockConversionProof> AssertAsync(string ownerId,SourcingStockAllocationPlan plan,string allocationId,string expectedVersion,CancellationToken ct);
}

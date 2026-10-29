using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

// The browser selects actual Stock/unit versions and an explicit absolute hold
// deadline. It never supplies a price, customer, SKU replacement or quantity cap.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingAllocationUnitInput(string UnitId,string Version);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingAllocationLineInput(string OfferLineId,string? StockVersion,string TrackingMode,SourcingAllocationUnitInput[] Units);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingAllocationInput(string RequestId,string RequestVersion,string TaskVersion,string OfferVersion,string AcceptanceId,string TermsHash,DateTimeOffset ExpiresAt,string Reason,SourcingAllocationLineInput[] Lines);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingAllocationReleaseInput(string RequestId,string AcceptanceId,string Version,string Reason);

// Market owns the immutable accepted purchase terms. Only the composition root
// may split this plan into financial Sales and price-free Inventory contracts.
public sealed record AcceptedSourcingPlanLine(string OfferLineId,string ListingId,int Quantity,string UnitPriceRial,OfferSkuSnapshot Sku);
public sealed record AcceptedSourcingPurchasePlan(string RequestId,string TaskId,string OfferId,int Revision,string AcceptanceId,string OwnerId,string TermsHash,string RequestVersion,string TaskVersion,string OfferVersion,DateTimeOffset PurchaseUntil,string TermsFa,string TermsEn,bool ContainsDemo,AcceptedSourcingPlanLine[] Lines);
public sealed record SourcingStockAllocationPlanLine(string OfferLineId,string VariantId,string ProductId,int Quantity,string MaterialFingerprint);
public sealed record SourcingStockAllocationPlan(string RequestId,string TaskId,string OfferId,string AcceptanceId,string OwnerId,string TermsHash,DateTimeOffset PurchaseUntil,bool ContainsDemo,SourcingStockAllocationPlanLine[] Lines);
public sealed record SourcingAllocationLineData(string OfferLineId,string VariantId,int Quantity,string[] UnitIds);
public sealed record SourcingAllocationData(int SchemaVersion,string Id,string RequestId,string TaskId,string OfferId,string AcceptanceId,string State,string EffectiveState,string Version,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,DateTimeOffset ExpiresAt,bool IsDemo,SourcingAllocationLineData[] Lines);
public sealed record SourcingAllocationSummaryLine(string OfferLineId,string VariantId,int Quantity);
public sealed record SourcingAllocationSummaryData(int SchemaVersion,string Id,string RequestId,string TaskId,string OfferId,string AcceptanceId,string State,string EffectiveState,string Version,DateTimeOffset ExpiresAt,bool IsDemo,int Quantity,SourcingAllocationSummaryLine[] Lines);
public sealed record SourcingAllocationMutation(int SchemaVersion,string AllocationId,string RequestId,string TaskId,string OfferId,string AcceptanceId,string Operation,string State,string Version,string CommandId,DateTimeOffset At,DateTimeOffset ExpiresAt,bool Replayed);
public sealed record SourcingAllocationEventData(string Id,string State,string Reason,DateTimeOffset At);
public sealed record SourcingAllocationEventPage(int SchemaVersion,int PageSize,SourcingAllocationEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);

public interface IInventorySourcingAllocations
{
    // Root first owns Market request/task locks; replay precedes live versions.
    Task<SourcingAllocationMutation?> ReplayAsync(string actor,string requestId,string taskId,string allocationId,SourcingAllocationInput input,CancellationToken ct);
    Task<SourcingAllocationMutation?> ReplayReleaseAsync(string actor,string requestId,string taskId,string allocationId,SourcingAllocationReleaseInput input,CancellationToken ct);
    Task<SourcingAllocationMutation> AllocateAsync(string actor,string allocationId,SourcingStockAllocationPlan plan,SourcingAllocationInput input,CancellationToken ct);
    Task<SourcingAllocationMutation> ReleaseAsync(string actor,string allocationId,SourcingAllocationReleaseInput input,CancellationToken ct);
    Task ReleaseForAcceptanceAsync(string actor,string acceptanceId,string reason,CancellationToken ct);
    Task<SourcingAllocationData> ReadAsync(string allocationId,string? ownerId,CancellationToken ct);
    Task<SourcingAllocationData?> ReadActiveAsync(string acceptanceId,string? ownerId,CancellationToken ct);
    Task<SourcingAllocationSummaryData[]> ReadSummariesAsync(string[] acceptanceIds,string? ownerId,CancellationToken ct);
    Task<SourcingAllocationMutation> ReadCommandAsync(string actor,string allocationId,string operation,string commandId,CancellationToken ct);
    Task<SourcingAllocationEventPage> EventsAsync(string allocationId,string? ownerId,string? cursor,CancellationToken ct);
    Task<int> ExpireBatchAsync(int maximum,CancellationToken ct);
}

// Invoked under the Market request/task locks BEFORE any Stock lock. Root
// composes Sales revoke/consumption protection and Inventory share release.
public interface ISourcingPurchaseLifecycle
{
    Task BeforeCloseAsync(string actor,string requestId,string taskId,string acceptanceId,string reason,CancellationToken ct);
}

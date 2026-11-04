namespace Shop.SharedKernel;

// Internal Sales/Inventory boundary. No prices, customer input, or Market context.
// The caller owns Serializable, the exclusive cart lock and all Agreement locks
// in AcceptanceId order before requesting a hold. ExpiresAt is absolute.
public sealed record StockOrderLineV2(string LineId,string VariantId,int Quantity,string? AllocationId=null,string? OfferLineId=null);
public sealed record StockOrderAllocationV2(SourcingStockAllocationPlan Plan,string AllocationId,string Version);
public sealed record StockOrderHoldV2Request(string OwnerId,string OrderId,string RequestId,DateTimeOffset ExpiresAt,StockOrderLineV2[] Lines,StockOrderAllocationV2[] Allocations);
public sealed record StockOrderReservationLineV2(string LineId,string VariantId,int Quantity,string TrackingMode,string? AllocationId,string? OfferLineId);
public sealed record StockOrderReservationDataV2(int SchemaVersion,string Id,string OrderId,StockReservationState State,DateTimeOffset CreatedAt,DateTimeOffset ExpiresAt,StockOrderReservationLineV2[] Lines);

public interface IStockOrderReservationsV2
{
    Task<StockOrderReservationDataV2> HoldAsync(StockOrderHoldV2Request request,CancellationToken ct);
    Task<StockOrderReservationDataV2> ReadAsync(string ownerId,string reservationId,CancellationToken ct);
    Task<StockOrderReservationDataV2> AllocateAsync(string ownerId,string reservationId,string actorId,CancellationToken ct);
    Task<StockOrderReservationDataV2> ReleaseAsync(string ownerId,string reservationId,string actorId,CancellationToken ct);
    Task<StockOrderReservationDataV2> FulfillAsync(string ownerId,string reservationId,string actorId,CancellationToken ct);
    Task<StockOrderReservationDataV2> ExpireIfDueAsync(string ownerId,string reservationId,string actorId,CancellationToken ct);
}

public sealed record StockOrderSerialPickV2(string LineId,string UnitId,string Version,DateTimeOffset? WarrantyUntil=null);
public sealed record StockOrderSerialAssignmentV2(string OwnerId,string ReservationId,string ActorId,string RequestId,IReadOnlyList<StockOrderSerialPickV2> Units);
public interface IStockSerialAssignmentsV2
{
    Task AssignAsync(StockOrderSerialAssignmentV2 request,CancellationToken ct);
}

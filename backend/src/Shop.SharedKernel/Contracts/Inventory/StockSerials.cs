namespace Shop.SharedKernel;

// Internal only: the caller validates a real paid order and supplies its reservation.
// Sales order lines use the composite OrderId/VariantId; no cross-module DB access.
public sealed record StockSerialPick(string UnitId,string Version,DateTimeOffset? WarrantyUntil=null);
public sealed record StockSerialAssignment(string OwnerId,string ReservationId,string ActorId,string RequestId,IReadOnlyList<StockSerialPick> Units);
public interface IStockSerialAssignments
{
    Task AssignAsync(StockSerialAssignment request,CancellationToken ct);
}
public interface IInventorySerialGuard
{
    Task AssertDigitalVariantsAllowedAsync(string[] variantIds,CancellationToken ct);
}

namespace Shop.SharedKernel;

public enum StockReservationState { Active, Allocated, Released, Expired, Fulfilled }
public sealed record StockReservationLine(string VariantId, int Quantity);
public sealed record StockHoldRequest(string OwnerId, string OrderId, string RequestId, IReadOnlyList<StockReservationLine> Lines, TimeSpan Lifetime);
public sealed record StockReservationData(string Id, string OrderId, StockReservationState State, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, IReadOnlyList<StockReservationLine> Lines);

// Internal Sales/Inventory boundary. IDs and lines must come from a validated server-side order.
// A replay retains its original deadline/state. Callers must require Active/Allocated as appropriate.
public interface IStockReservations
{
    Task<StockReservationData> HoldAsync(StockHoldRequest request, CancellationToken ct);
    Task<StockReservationData> ReadAsync(string ownerId, string reservationId, CancellationToken ct);
    Task<StockReservationData> AllocateAsync(string ownerId, string reservationId, string actorId, CancellationToken ct);
    Task<StockReservationData> ReleaseAsync(string ownerId, string reservationId, string actorId, CancellationToken ct);
    Task<StockReservationData> FulfillAsync(string ownerId, string reservationId, string actorId, CancellationToken ct);
}

// A new internal consumer may require an absolute authority deadline. Existing
// Lifetime-based holds and their hashes retain their historical semantics.
public sealed record StockBoundedHoldRequest(string OwnerId,string OrderId,string RequestId,IReadOnlyList<StockReservationLine> Lines,DateTimeOffset ExpiresAt);
public interface IStockBoundedReservations
{
    Task<StockReservationData> HoldBoundedAsync(StockBoundedHoldRequest request,CancellationToken ct);
}

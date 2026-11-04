namespace Shop.SharedKernel;

// Private Sales/Inventory boundary. No prices or mutable catalogue facts.
// Caller owns a shared Serializable transaction and the canonical Sales owner lock.
public sealed record FulfillmentInventoryLine(string LineKey, string VariantId, int Quantity, string TrackingMode);
public sealed record FulfillmentInventoryUnit(string Id, string LineKey, string VariantId, string Version, string State, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] string? Serial, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] string? Imei1, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] string? Imei2, [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.Never)] DateTimeOffset? WarrantyUntil);
public sealed record FulfillmentInventoryProof(int SchemaVersion, string ReservationId, string OrderId, int ReservationContract, string Version, StockReservationState State, FulfillmentInventoryLine[] Lines, FulfillmentInventoryUnit[] Units, bool MoreUnits);
public sealed record FulfillmentInventoryStatus(int SchemaVersion, string ReservationId, string OrderId, int ReservationContract, string Version, StockReservationState State);
public interface IOrderFulfillmentInventory
{
    Task<FulfillmentInventoryProof> ReadAsync(string ownerId, string reservationId, CancellationToken ct);
    Task<FulfillmentInventoryStatus> ReadStatusAsync(string ownerId, string reservationId, CancellationToken ct);
}

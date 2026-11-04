using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;
public sealed partial class StockReservationService : IOrderFulfillmentInventory
{
    async Task<FulfillmentInventoryStatus> IOrderFulfillmentInventory.ReadStatusAsync(string ownerId, string reservationId, CancellationToken ct)
    {
        RequireV2Transaction(); var owner = Identifier(ownerId); var id = Uuid(reservationId); await LockAsync("reservation", id, ct);
        var row = await LoadAsync(owner, id, ct);
        if (row.ContractVersion is not (null or 2)) throw new BusinessException("reservation_contract_upgrade_required", "Use the reservation's explicit stored contract.");
        if (row.ContractVersion == 2) { await RequireVisibleV2Async(row, ct); await LoadV2GraphAsync(row, ct); }
        return new(1, row.Id, row.OrderId, row.ContractVersion ?? 1, Convert.ToBase64String(row.Version), row.State);
    }
    async Task<FulfillmentInventoryProof> IOrderFulfillmentInventory.ReadAsync(string ownerId, string reservationId, CancellationToken ct)
    {
        RequireV2Transaction();
        var owner = Identifier(ownerId); var id = Uuid(reservationId);
        await LockAsync("reservation", id, ct);
        var row = await LoadAsync(owner, id, ct);
        if (row.ContractVersion is not (null or 2)) throw new BusinessException("reservation_contract_upgrade_required", "Use the explicit reservation reader for this order.");
        if (row.ContractVersion == 2) { await RequireVisibleV2Async(row, ct); await LoadV2GraphAsync(row, ct); }
        var stocks = await LockStockAsync(row.Items.Select(x => x.VariantId), ct);
        if (stocks.Count != row.Items.Count) throw UnavailableFulfillment();
        var lines = row.ContractVersion == 2
            ? row.LineEntitlements.Select(x => new FulfillmentInventoryLine(x.LineId, x.VariantId, x.Quantity, x.TrackingMode)).ToArray()
            : row.Items.Select(x => new FulfillmentInventoryLine(x.VariantId.ToUpperInvariant(), x.VariantId, x.Quantity, stocks[x.VariantId].TrackingMode)).ToArray();
        if (lines.Length is < 1 or > 64 || lines.Any(x => x.Quantity is < 1 or > 1000000 || !stocks.TryGetValue(x.VariantId, out var stock) || stock.TrackingMode != x.TrackingMode)) throw UnavailableFulfillment();
        // The reservation and Stock locks are shared with every serial writer.
        var units = await db.SerialUnits.AsNoTracking().Where(x => x.ReservationId == id || x.OrderId == row.OrderId).OrderBy(x => x.Id).Take(101).ToArrayAsync(ct);
        if (units.Any(x => x.ReservationId != id || x.OrderId != row.OrderId || !lines.Any(l => l.VariantId.Equals(x.VariantId, StringComparison.OrdinalIgnoreCase) && (row.ContractVersion == 2 ? l.LineKey == x.OrderLineId : x.OrderLineId is null)))) throw UnavailableFulfillment();
        var mapped = units.Take(100).Select(x => new FulfillmentInventoryUnit(x.Id, row.ContractVersion == 2 ? x.OrderLineId! : x.VariantId.ToUpperInvariant(), x.VariantId, Convert.ToBase64String(x.Version), x.State, x.Serial, x.Imei1, x.Imei2, x.WarrantyUntil)).ToArray();
        return new(1, row.Id, row.OrderId, row.ContractVersion ?? 1, Convert.ToBase64String(row.Version), row.State, lines.OrderBy(x => x.LineKey, StringComparer.Ordinal).ToArray(), mapped, units.Length > 100);
    }
    private static BusinessException UnavailableFulfillment() => new("shipment_unavailable", "The order's inventory assignments cannot be read consistently.");
}

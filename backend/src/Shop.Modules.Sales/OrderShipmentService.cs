using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;
public sealed class OrderShipmentService(SalesDbContext db, IOrderFulfillmentInventory inventory, IStockReservations legacy, IStockOrderReservationsV2 versioned, TimeProvider clock, bool allowDemo = false, ICreditFulfillmentAuthorization? creditAuthorization = null)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, RespectRequiredConstructorParameters = true, RespectNullableAnnotations = true, MaxDepth = 16 };
    private sealed record SourceLine(string Key, string VariantId, string ProductId, string Sku, string Name, string Label, string Warranty, int Quantity, bool IsDigital);

    public async Task<AdminShipmentData> ReadAdminAsync(string ownerId, string orderId, CancellationToken ct)
    {
        var order = await OrderAsync(ownerId, orderId, ct); await RequireSingleWorkflowAsync(order.Id,ct); var shipment = await LoadAsync(order.Id, ct);
        if (shipment?.State is "dispatched" or "delivered") {
            var status = await inventory.ReadStatusAsync(order.OwnerId, order.ReservationId, ct); ValidateStatus(order, status);
            var historical = Data(order, shipment, true); var blocked = CompletedBlockers(order, shipment, status);
            return new(1, order.Id, order.OwnerId, order.State.ToString(), Version(order.Version), order.ContainsDemo, historical, historical.Lines, historical.Units, false, false, false, blocked.Length == 0 && shipment.State == "dispatched", blocked, ShipmentRules.Hash(status), false);
        }
        var proof = await inventory.ReadAsync(order.OwnerId, order.ReservationId, ct); ValidateBinding(order, proof); var blockers = Blockers(order, shipment, proof); if(order.State==OrderState.CreditApproved&&(creditAuthorization is null||!await creditAuthorization.IsAuthorizedAsync(order.OwnerId,order.Id,ct)))blockers=[..blockers,"credit_clearance_required"]; var state = order.State == OrderState.AwaitingPayment && order.ExpiresAt <= clock.GetUtcNow() ? "Expired" : order.State.ToString();
        return new(1, order.Id, order.OwnerId, state, Version(order.Version), order.ContainsDemo, shipment is null ? null : Data(order, shipment, true), PackingLines(order, proof), PackingUnits(proof), blockers.Length == 0 && shipment is null, shipment?.State == "packed" && blockers.Contains("packed_inventory_changed") && blockers.All(x => x == "packed_inventory_changed"), blockers.Length == 0 && shipment?.State == "packed", false, blockers, ShipmentRules.Hash(proof), false);
    }
    public async Task<CustomerShipmentData> ReadCustomerAsync(string ownerId, string orderId, CancellationToken ct)
    {
        var order = await OrderAsync(ownerId, orderId, ct); await RequireSingleWorkflowAsync(order.Id,ct); var shipment = await LoadAsync(order.Id, ct);
        return new(1, order.Id, shipment is null ? null : Data(order, shipment, shipment.State != "packed"), shipment?.State is "dispatched" or "delivered");
    }
    public async Task<ShipmentCommandResult> ApplyAsync(string actorId, string orderId, ShipmentCommandInput supplied, CancellationToken ct)
    {
        CartOfferRules.RequireParent(db); var actor = OrderInputRules.Identifier(actorId).ToUpperInvariant(); var id = ShipmentRules.Uuid(orderId); var input = ShipmentRules.Normalize(supplied); var hash = ShipmentRules.Hash(new { OrderId = id, Input = input });
        await LockAsync("order-owner", input.OwnerId.ToUpperInvariant(), ct); await LockAsync("shipment-command", actor + ":" + input.CommandId, ct);
        var previous = await db.OrderShipmentCommands.FromSqlInterpolated($"SELECT * FROM [sales].[OrderShipmentCommands] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={actor} AND [CommandId]={input.CommandId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if (previous is not null) {
            if (previous.ContainsDemo && !allowDemo) throw Missing();
            if (previous.OrderId != id || previous.PayloadHash != hash) throw new BusinessException("idempotency_conflict", "This shipment command id belongs to another order or body.");
            return Receipt(previous) with { Replayed = true };
        }
        var order = await OrderAsync(input.OwnerId, id, ct); await RequireSingleWorkflowAsync(order.Id,ct); var shipment = await LoadAsync(order.Id, ct);
        if (input.OrderVersion != Version(order.Version) || input.ShipmentVersion != (shipment is null ? null : Version(shipment.Version))) throw new BusinessException("version_conflict", "The order or shipment changed. Review the current state first.");
        if (order.State is not(OrderState.Paid or OrderState.CreditApproved)) throw new BusinessException("shipment_payment_conflict", "A paid order or independently authorized credit order is required.");
        CreditDispatchAuthority? authority=null;if(order.State==OrderState.CreditApproved&&input.Action!="deliver"){authority=creditAuthorization is null?null:await creditAuthorization.ReadAuthorityAsync(order.OwnerId,order.Id,ct);if(authority is not{Authorized:true,RecordedAt:not null})throw new BusinessException("shipment_credit_clearance_conflict","The credit financial authorization is missing, revoked or stale. Finance must review the current evidence.");}
        FulfillmentInventoryProof? proof = null; string fingerprint; string[] blockers;
        if (shipment?.State is "dispatched" or "delivered") {
            var status = await inventory.ReadStatusAsync(order.OwnerId, order.ReservationId, ct); ValidateStatus(order, status); fingerprint = ShipmentRules.Hash(status); blockers = CompletedBlockers(order, shipment, status);
        } else {
            proof = await inventory.ReadAsync(order.OwnerId, order.ReservationId, ct); ValidateBinding(order, proof); fingerprint = ShipmentRules.Hash(proof); blockers = Blockers(order, shipment, proof);
        }
        if (input.InventoryFingerprint != fingerprint) throw new BusinessException("shipment_inventory_conflict", "The reviewed packing or inventory facts changed. Reload before confirming.");
        if ((input.Action == "repack" ? blockers.Any(x => x != "packed_inventory_changed") : blockers.Length != 0)) throw new BusinessException("shipment_readiness_conflict", "The order is not ready: " + string.Join(", ", blockers));
        var now = clock.GetUtcNow();
        if (input.Action == "pack") {
            if (shipment is not null) throw StageConflict();
            var source = Lines(order);
            if (proof is null) throw Unavailable();
            shipment = new() { Id = Guid.NewGuid().ToString("N"), OrderId = order.Id, OwnerId = order.OwnerId, ReservationId = order.ReservationId, InventoryFingerprint = ShipmentRules.Hash(proof), PackedAt = now, ChangedAt = now, ContainsDemo = order.ContainsDemo };
            AddPackingSnapshot(order, shipment, proof);
            db.OrderShipments.Add(shipment);
        } else if (input.Action == "repack") {
            if (shipment?.State != "packed" || proof is null || !blockers.Contains("packed_inventory_changed")) throw StageConflict();
            if (shipment.PackingRevision >= 1000000) throw new BusinessException("shipment_capacity_conflict", "The packing revision limit has been reached.");
            shipment.PackingRevision++; shipment.PackedAt = now; shipment.ChangedAt = now; shipment.InventoryFingerprint = ShipmentRules.Hash(proof); AddPackingSnapshot(order, shipment, proof);
        } else if (input.Action == "dispatch") {
            if (shipment?.State != "packed") throw StageConflict();
            RequireTime(input.OccurredAt!.Value, authority?.RecordedAt is{}authorizedAt&&authorizedAt>shipment.PackedAt?authorizedAt:shipment.PackedAt, now);
            if (proof is null || ShipmentRules.Hash(proof) != shipment.InventoryFingerprint) throw new BusinessException("shipment_inventory_conflict", "The packed units or reservation changed. Do not dispatch a different package.");
            var fulfilled = order.SnapshotVersion == 2
                ? (await versioned.FulfillAsync(order.OwnerId, order.ReservationId, actor, ct)).State
                : (await legacy.FulfillAsync(order.OwnerId, order.ReservationId, actor, ct)).State;
            if (fulfilled != StockReservationState.Fulfilled) throw new BusinessException("shipment_reservation_conflict", "Inventory did not confirm the complete warehouse hand-off.");
            shipment.State = "dispatched"; shipment.DispatchedAt = input.OccurredAt; shipment.CarrierNameFa = input.CarrierNameFa; shipment.CarrierNameEn = input.CarrierNameEn; shipment.TrackingNumber = input.TrackingNumber; shipment.ChangedAt = now;
        } else {
            if (shipment?.State != "dispatched") throw StageConflict();
            RequireTime(input.OccurredAt!.Value, shipment.DispatchedAt!.Value, now);
            shipment.State = "delivered"; shipment.DeliveredAt = input.OccurredAt; shipment.ChangedAt = now; order.State = OrderState.Fulfilled;
        }
        order.ChangedAt = now; db.Entry(order).Property(x=>x.ChangedAt).IsModified=true; order.Events.Add(new() { OrderId = order.Id, State = order.State, ActorId = actor, Reason = input.Action == "repack" ? "shipment_repacked" : "shipment_" + shipment.State, At = now });
        await db.SaveChangesAsync(ct);
        var result = new ShipmentCommandResult(1, input.CommandId, hash, order.Id, input.Action, input.InventoryFingerprint, input.Reason, now, Version(order.Version), Data(order, shipment, true), false);
        var json = JsonSerializer.Serialize(result, Json); if (json.Length > 131072 || Encoding.UTF8.GetByteCount(json) > 262144) throw new BusinessException("shipment_capacity_conflict", "The complete packing receipt exceeds this workflow's size limit.");
        db.OrderShipmentCommands.Add(new() { ActorId = actor, CommandId = input.CommandId, OrderId = id, Action = input.Action, PackingRevision = shipment.PackingRevision, PayloadHash = hash, ResponseHash = HashText(json), ResponseJson = json, ContainsDemo = order.ContainsDemo, At = now });
        await db.SaveChangesAsync(ct); return result;
    }
    public async Task<ShipmentCommandResult> ReadReceiptAsync(string actorId, string orderId, string commandId, CancellationToken ct)
    {
        var actor = OrderInputRules.Identifier(actorId).ToUpperInvariant(); var id = ShipmentRules.Uuid(orderId); var command = ShipmentRules.Uuid(commandId);
        var row = await db.OrderShipmentCommands.AsNoTracking().SingleOrDefaultAsync(x => x.ActorId == actor && x.CommandId == command && x.OrderId == id, ct) ?? throw Missing();
        if (row.ContainsDemo && !allowDemo) throw Missing(); return Receipt(row) with { Replayed = true };
    }
    private async Task RequireSingleWorkflowAsync(string order,CancellationToken ct){if(await db.FulfillmentHeaders.AsNoTracking().AnyAsync(x=>x.OrderId==order,ct))throw new BusinessException("shipment_contract_upgrade_required","Use the explicit multi-parcel workflow for this order.");}
    private async Task<SalesOrder> OrderAsync(string ownerId, string orderId, CancellationToken ct)
    {
        CartOfferRules.RequireParent(db); var owner = OrderInputRules.Identifier(ownerId); var id = ShipmentRules.Uuid(orderId); await LockAsync("order-owner", owner.ToUpperInvariant(), ct);
        var order = await OrderCommandQueries.FindAsync(db, owner, id, ct) ?? throw Missing(); await db.Entry(order).ReloadAsync(ct);
        if (order.SnapshotVersion is not (null or 2)) throw new BusinessException("order_contract_upgrade_required", "This order requires its explicit lifecycle reader.");
        if (order.ContainsDemo && !allowDemo) throw Missing(); await OrderCommandQueries.LoadHistoryAsync(db, order, ct); _ = Lines(order); return order;
    }
    private async Task<OrderShipment?> LoadAsync(string orderId, CancellationToken ct)
    {
        var row = await db.OrderShipments.FromSqlInterpolated($"SELECT * FROM [sales].[OrderShipments] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={orderId}").SingleOrDefaultAsync(ct);
        if (row is null) return null; await db.Entry(row).ReloadAsync(ct);
        row.Lines = await db.OrderShipmentLines.FromSqlInterpolated($"SELECT * FROM [sales].[OrderShipmentLines] WITH (READCOMMITTEDLOCK) WHERE [ShipmentId]={row.Id} AND [PackingRevision]={row.PackingRevision}").ToListAsync(ct);
        row.Units = await db.OrderShipmentUnits.FromSqlInterpolated($"SELECT * FROM [sales].[OrderShipmentUnits] WITH (READCOMMITTEDLOCK) WHERE [ShipmentId]={row.Id} AND [PackingRevision]={row.PackingRevision}").ToListAsync(ct);
        return row;
    }
    private static void AddPackingSnapshot(SalesOrder order, OrderShipment shipment, FulfillmentInventoryProof proof)
    {
        shipment.Lines.AddRange(Lines(order).Select(x => new OrderShipmentLine { ShipmentId = shipment.Id, PackingRevision = shipment.PackingRevision, LineKey = x.Key, VariantId = x.VariantId, ProductId = x.ProductId, Sku = x.Sku, Name = x.Name, Label = x.Label, Warranty = x.Warranty, Quantity = x.Quantity, TrackingMode = proof.Lines.Single(p => p.LineKey == x.Key).TrackingMode }));
        shipment.Units.AddRange(proof.Units.Select(x => new OrderShipmentUnit { ShipmentId = shipment.Id, PackingRevision = shipment.PackingRevision, UnitId = x.Id, LineKey = x.LineKey, VariantId = x.VariantId, InventoryVersion = x.Version, Serial = x.Serial, Imei1 = x.Imei1, Imei2 = x.Imei2, WarrantyUntil = x.WarrantyUntil }));
    }
    private static SourceLine[] Lines(SalesOrder order)
    {
        var lines = order.SnapshotVersion == 2
            ? order.LinesV2.Select(x => new SourceLine(x.LineId, x.VariantId, x.ProductId, x.Sku, x.Name, x.Label, x.Warranty, x.Quantity, x.IsDigital)).ToArray()
            : order.Lines.Select(x => new SourceLine(x.VariantId.ToUpperInvariant(), x.VariantId, x.ProductId, x.Sku, x.Name, x.Label, x.Warranty, x.Quantity, x.IsDigital)).ToArray();
        if (lines.Length is < 1 or > 64 || lines.Select(x => x.Key).Distinct(StringComparer.Ordinal).Count() != lines.Length || lines.Any(x => x.Quantity is < 1 or > 1000000)) throw Unavailable();
        return lines.OrderBy(x => x.Key, StringComparer.Ordinal).ToArray();
    }
    private static void ValidateBinding(SalesOrder order, FulfillmentInventoryProof proof)
    {
        var lines = Lines(order);
        if (proof.SchemaVersion != 1 || proof.OrderId != order.Id || proof.ReservationId != order.ReservationId || proof.ReservationContract != (order.SnapshotVersion == 2 ? 2 : 1) || proof.Lines.Length != lines.Length || lines.Any(x => !proof.Lines.Any(l => l.LineKey == x.Key && l.VariantId.Equals(x.VariantId, StringComparison.OrdinalIgnoreCase) && l.Quantity == x.Quantity))) throw Unavailable();
    }
    private static void ValidateStatus(SalesOrder order, FulfillmentInventoryStatus status)
    {
        if (status.SchemaVersion != 1 || status.OrderId != order.Id || status.ReservationId != order.ReservationId || status.ReservationContract != (order.SnapshotVersion == 2 ? 2 : 1)) throw Unavailable();
    }
    private static string[] CompletedBlockers(SalesOrder order, OrderShipment shipment, FulfillmentInventoryStatus status)
    {
        var errors = new List<string>();
        if (order.State is not(OrderState.Paid or OrderState.CreditApproved) && !(order.State == OrderState.Fulfilled && shipment.State == "delivered")) errors.Add("payment_not_confirmed");
        if (!order.ShippingRequired || Lines(order).Any(x => x.IsDigital)) errors.Add("physical_only_fulfillment_required");
        if (status.State != StockReservationState.Fulfilled) errors.Add("reservation_not_fulfilled");
        if (shipment.State == "delivered") errors.Add("shipment_complete");
        return errors.ToArray();
    }
    private static ShipmentLineData[] PackingLines(SalesOrder order, FulfillmentInventoryProof proof) => Lines(order).Select(x => new ShipmentLineData(x.Key, x.VariantId, x.ProductId, x.Sku, x.Name, x.Label, x.Warranty, x.Quantity, proof.Lines.Single(l => l.LineKey == x.Key).TrackingMode)).ToArray();
    private static ShipmentUnitData[] PackingUnits(FulfillmentInventoryProof proof) => proof.Units.OrderBy(x => x.Id, StringComparer.Ordinal).Select(x => new ShipmentUnitData(x.Id, x.LineKey, x.VariantId, x.Serial, x.Imei1, x.Imei2, x.WarrantyUntil)).ToArray();
    private static string[] Blockers(SalesOrder order, OrderShipment? shipment, FulfillmentInventoryProof proof)
    {
        var errors = new List<string>();
        if (order.State is not(OrderState.Paid or OrderState.CreditApproved) && !(order.State == OrderState.Fulfilled && shipment?.State == "delivered")) errors.Add("payment_not_confirmed");
        if (!order.ShippingRequired || Lines(order).Any(x => x.IsDigital)) errors.Add("physical_only_fulfillment_required");
        if (proof.MoreUnits) errors.Add("shipment_tracked_unit_limit");
        var expected = shipment?.State is "dispatched" or "delivered" ? StockReservationState.Fulfilled : StockReservationState.Allocated;
        if (proof.State != expected) errors.Add("reservation_not_" + expected.ToString().ToLowerInvariant());
        var unitState = expected == StockReservationState.Fulfilled ? "delivered" : "assigned";
        if (proof.Units.Any(x => x.State != unitState) || proof.Lines.Any(l => proof.Units.Count(x => x.LineKey == l.LineKey) != (l.TrackingMode == "none" ? 0 : l.Quantity))) errors.Add("complete_serial_assignment_required");
        if (shipment?.State == "packed" && ShipmentRules.Hash(proof) != shipment.InventoryFingerprint) errors.Add("packed_inventory_changed");
        if (shipment?.State == "delivered") errors.Add("shipment_complete");
        return errors.ToArray();
    }
    private static ShipmentData Data(SalesOrder order, OrderShipment row, bool includeUnits)
    {
        var source = Lines(order); var currentLines = row.Lines.Where(x => x.PackingRevision == row.PackingRevision).ToArray(); var currentUnits = row.Units.Where(x => x.PackingRevision == row.PackingRevision).ToArray();
        if (row.OrderId != order.Id || row.OwnerId != order.OwnerId || row.ReservationId != order.ReservationId || row.ContainsDemo != order.ContainsDemo || currentLines.Length != source.Length || source.Any(s => !currentLines.Any(l => l.LineKey == s.Key && l.VariantId.Equals(s.VariantId, StringComparison.OrdinalIgnoreCase) && l.ProductId == s.ProductId && l.Sku == s.Sku && l.Name == s.Name && l.Label == s.Label && l.Warranty == s.Warranty && l.Quantity == s.Quantity)) || currentUnits.Length > 100) throw Unavailable();
        var result = new ShipmentData(row.Id, row.OrderId, row.State, Version(row.Version), row.PackingRevision, row.PackedAt, row.DispatchedAt, row.DeliveredAt, row.CarrierNameFa, row.CarrierNameEn, row.TrackingNumber, row.ContainsDemo, true,
            currentLines.OrderBy(x => x.LineKey, StringComparer.Ordinal).Select(x => new ShipmentLineData(x.LineKey, x.VariantId, x.ProductId, x.Sku, x.Name, x.Label, x.Warranty, x.Quantity, x.TrackingMode)).ToArray(),
            currentUnits.OrderBy(x => x.UnitId, StringComparer.Ordinal).Select(x => new ShipmentUnitData(x.UnitId, x.LineKey, x.VariantId, x.Serial, x.Imei1, x.Imei2, x.WarrantyUntil)).ToArray());
        ValidateData(result); return includeUnits ? result : result with { Units = [], UnitDetailsVisible = false };
    }
    private static ShipmentCommandResult Receipt(OrderShipmentCommand row)
    {
        try {
            if (HashText(row.ResponseJson) != row.ResponseHash || row.ResponseJson.Length > 131072) throw Unavailable();
            var result = JsonSerializer.Deserialize<ShipmentCommandResult>(row.ResponseJson, Json) ?? throw Unavailable();
            if (result.SchemaVersion != 1 || result.CommandId != row.CommandId || result.OrderId != row.OrderId || result.PayloadHash != row.PayloadHash || result.Action != row.Action || result.Reason is not { Length: > 0 and <= 400 } || result.Reason.Any(char.IsControl) || result.RecordedAt != row.At || result.RecordedAt.Offset != TimeSpan.Zero || result.Replayed || !result.Shipment.UnitDetailsVisible || row.Action is not ("pack" or "repack" or "dispatch" or "deliver") || result.Shipment.OrderId != row.OrderId || result.Shipment.PackingRevision != row.PackingRevision || result.Shipment.ContainsDemo != row.ContainsDemo || result.Shipment.State != (row.Action is "pack" or "repack" ? "packed" : row.Action == "dispatch" ? "dispatched" : "delivered")) throw Unavailable();
            _ = ShipmentRules.Version(result.OrderVersion); _ = ShipmentRules.Fingerprint(result.InventoryFingerprint); ValidateData(result.Shipment); return result;
        } catch (Exception e) when (e is JsonException or FormatException or NullReferenceException or BusinessException) { throw Unavailable(); }
    }
    private static void ValidateData(ShipmentData data)
    {
        _ = ShipmentRules.Uuid(data.Id); _ = ShipmentRules.Uuid(data.OrderId); _ = ShipmentRules.Version(data.Version);
        if (data.State is not ("packed" or "dispatched" or "delivered") || data.Lines is null || data.Units is null || data.Lines.Length is < 1 or > 64 || data.Units.Length > 100 || data.Lines.Any(l => l is null || l.Quantity is < 1 or > 1000000 || l.TrackingMode is not ("none" or "serial" or "imei")) || data.Lines.Select(l => l.LineKey).Distinct(StringComparer.Ordinal).Count() != data.Lines.Length || data.Units.Any(u => u is null || u.Serial is null && u.Imei1 is null || !data.Lines.Any(l => l.LineKey == u.LineKey && l.VariantId.Equals(u.VariantId, StringComparison.OrdinalIgnoreCase) && l.TrackingMode != "none")) || data.Units.Select(u => u.UnitId).Distinct(StringComparer.Ordinal).Count() != data.Units.Length || data.Lines.Any(l => data.Units.Count(u => u.LineKey == l.LineKey) != (l.TrackingMode == "none" ? 0 : l.Quantity))) throw Unavailable();
        foreach (var unit in data.Units) _ = ShipmentRules.Uuid(unit.UnitId);
        if (data.PackingRevision is < 1 or > 1000000 || !data.UnitDetailsVisible || data.PackedAt.Offset != TimeSpan.Zero || data.DispatchedAt is { Offset: var dispatchOffset } && dispatchOffset != TimeSpan.Zero || data.DeliveredAt is { Offset: var deliveryOffset } && deliveryOffset != TimeSpan.Zero) throw Unavailable();
        if (data.State == "packed") {
            if (data.DispatchedAt is not null || data.DeliveredAt is not null || data.CarrierNameFa is not null || data.CarrierNameEn is not null || data.TrackingNumber is not null) throw Unavailable();
        } else if (data.DispatchedAt is null || data.DispatchedAt < data.PackedAt || string.IsNullOrWhiteSpace(data.CarrierNameFa) || string.IsNullOrWhiteSpace(data.CarrierNameEn) || (data.State == "dispatched" ? data.DeliveredAt is not null : data.DeliveredAt is null || data.DeliveredAt < data.DispatchedAt)) throw Unavailable();
    }
    private async Task LockAsync(string kind, string value, CancellationToken ct)
    {
        CartOfferRules.RequireParent(db); await using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction(); command.CommandTimeout = 12;
        command.CommandText = "DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;"; var parameter = command.CreateParameter(); parameter.ParameterName = "@resource"; parameter.DbType = DbType.String; parameter.Value = "sayman:sales:" + kind + ":" + HashText(value); command.Parameters.Add(parameter);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) < 0) { await db.Database.CurrentTransaction!.RollbackAsync(CancellationToken.None); throw new BusinessException("shipment_busy_conflict", "Shipment operations are busy. Retry the same command id."); }
    }
    private static void RequireTime(DateTimeOffset value, DateTimeOffset earliest, DateTimeOffset now) { if (value < earliest || value > now) throw new BusinessException("shipment_time_conflict", "Use the actual non-future event time after the preceding stage."); }
    private static string HashText(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static string Version(byte[] value) => value.Length == 8 ? Convert.ToBase64String(value) : throw Unavailable();
    private static BusinessException Missing() => new("not_found", "The owned order or shipment receipt was not found.");
    private static BusinessException Unavailable() => new("shipment_unavailable", "The historical shipment or its inventory binding is unavailable.");
    private static BusinessException StageConflict() => new("shipment_stage_conflict", "The shipment cannot make that transition from its current stage.");
}

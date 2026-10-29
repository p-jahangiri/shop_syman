using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed partial class SerialInventoryService
{
    private sealed record AssignmentResultV2(int SchemaVersion, string ReservationId, bool Assigned);

    async Task IStockSerialAssignmentsV2.AssignAsync(StockOrderSerialAssignmentV2 request, CancellationToken ct)
    {
        var owner = SerialRules.Identifier(request.OwnerId); var id = SerialRules.Uuid(request.ReservationId); var actor = SerialRules.Identifier(request.ActorId).ToUpperInvariant(); var key = SerialRules.Uuid(request.RequestId);
        if (request.Units is null || request.Units.Count is < 1 or > SerialRules.BatchSize || request.Units.Any(p => p is null)) throw new BusinessException("invalid_serial_input", "Assign 1–100 distinct physical units to exact order lines.");
        var picks = request.Units.Select(p => new StockOrderSerialPickV2(SerialRules.Uuid(p.LineId), SerialRules.Uuid(p.UnitId), SerialRules.Version(p.Version, false)!, p.WarrantyUntil?.ToUniversalTime())).OrderBy(p => p.UnitId, StringComparer.Ordinal).ToArray();
        if (picks.Select(p => p.UnitId).Distinct(StringComparer.Ordinal).Count() != picks.Length) throw new BusinessException("invalid_serial_input", "A physical unit can be assigned only once in one command.");
        var hash = SerialRules.Hash(new { Kind = "assign-v2", Owner = owner.ToUpperInvariant(), Reservation = id, Units = picks });
        await using var tx = await reservations.BeginAsync(ct);
        await reservations.LockAsync("reservation", id, ct);
        var reservation = await reservations.LoadAsync(owner, id, ct); StockReservationService.RequireV2(reservation); await reservations.RequireVisibleV2Async(reservation, ct);
        await reservations.LockAsync("serial-command", actor + ":" + key, ct);
        var previous = await db.SerialCommands.AsNoTracking().SingleOrDefaultAsync(c => c.ActorId == actor && c.RequestId == key, ct);
        if (previous is not null) {
            using var document = JsonDocument.Parse(previous.ResponseJson);
            if (!document.RootElement.TryGetProperty("schemaVersion", out var marker) || !marker.TryGetInt32(out var contract) || contract != 2) throw new BusinessException("serial_contract_upgrade_required", "This serial command belongs to another explicit contract.");
            if (previous.PayloadHash != hash) throw new BusinessException("idempotency_conflict", "This serial request id has another payload.");
            var saved = JsonSerializer.Deserialize<AssignmentResultV2>(previous.ResponseJson, Json) ?? throw new InvalidOperationException("The stored version 2 serial receipt is invalid.");
            if (saved.ReservationId != id || !saved.Assigned) throw new InvalidOperationException("The version 2 serial receipt has another target.");
            if (tx is not null) await tx.CommitAsync(ct); return;
        }
        await reservations.GuardNoPartialDispatchAsync(id,ct);
        await reservations.LoadV2GraphAsync(reservation, ct);
        if (reservation.State != StockReservationState.Allocated) throw new BusinessException("serial_state_conflict", "Only an allocated order may receive physical serial assignments.");
        var stocks = await reservations.LockStockAsync(reservation.Items.Select(l => l.VariantId), ct);
        var units = await reservations.LockV2UnitsAsync(picks.Select(p => p.UnitId), ct);
        if (units.Count != picks.Length) throw new BusinessException("not_found", "A selected physical unit was not found.");
        var assigned = await db.SerialUnits.AsNoTracking().Where(u => u.ReservationId == id && u.State == "assigned").GroupBy(u => new { u.OrderLineId, u.VariantId, u.OrderId }).Select(g => new { g.Key.OrderLineId, g.Key.VariantId, g.Key.OrderId, Quantity = g.Count() }).Take(65).ToArrayAsync(ct);
        if (assigned.Length > 64 || assigned.Any(u => u.OrderId != reservation.OrderId || !reservation.LineEntitlements.Any(l => l.LineId == u.OrderLineId && l.VariantId.Equals(u.VariantId, StringComparison.OrdinalIgnoreCase)))) throw new InvalidOperationException("Existing physical line assignments are inconsistent.");
        foreach (var group in picks.GroupBy(p => p.LineId, StringComparer.Ordinal)) {
            var line = reservation.LineEntitlements.SingleOrDefault(l => l.LineId == group.Key);
            if (line is null || line.TrackingMode == "none" || !stocks.TryGetValue(line.VariantId, out var stock) || stock.TrackingMode != line.TrackingMode || assigned.Where(u => u.OrderLineId == line.LineId).Sum(u => u.Quantity) + group.Count() > line.Quantity) throw ConflictV2();
        }
        var claimChanges = new List<SerialUnitClaim>();
        foreach (var pick in picks) {
            var line = reservation.LineEntitlements.Single(l => l.LineId == pick.LineId); var unit = units[pick.UnitId]; SerialRules.MatchVersion(unit.Version, pick.Version);
            if (unit.State != "available" || unit.ReservationId is not null || unit.OrderId is not null || unit.OrderLineId is not null || !unit.VariantId.Equals(line.VariantId, StringComparison.OrdinalIgnoreCase)) throw ConflictV2();
            var active = await db.SerialUnitClaims.FromSqlInterpolated($"SELECT * FROM [inventory].[SerialUnitClaims] WITH (UPDLOCK,HOLDLOCK) WHERE [UnitId]={unit.Id} AND [IsActive]=1").SingleOrDefaultAsync(ct);
            if (line.AllocationId is null) {
                if (active is not null) throw ConflictV2();
            } else {
                if (active is null) throw ConflictV2(); await db.Entry(active).ReloadAsync(ct);
                if (active.State != "OrderHeld" || !active.IsActive || active.ReservationId != id || active.OrderId != reservation.OrderId || active.OrderLineId != line.LineId || active.OriginAllocationId != line.AllocationId || active.OfferLineId != line.OfferLineId || !active.VariantId.Equals(line.VariantId, StringComparison.OrdinalIgnoreCase)) throw ConflictV2();
                claimChanges.Add(active);
            }
        }
        var now = clock.GetUtcNow();
        foreach (var pick in picks) {
            var unit = units[pick.UnitId]; unit.State = "assigned"; unit.ReservationId = id; unit.OrderId = reservation.OrderId; unit.OrderLineId = pick.LineId; unit.WarrantyUntil = pick.WarrantyUntil; unit.ChangedAt = now; AddEvent(unit, actor, "Order v2 line assignment");
        }
        foreach (var claim in claimChanges) { claim.State = "Assigned"; claim.IsActive = false; claim.ChangedAt = now; }
        await db.SaveChangesAsync(ct); await Remember(actor, key, hash, new AssignmentResultV2(2, id, true), ct);
        if (tx is not null) await tx.CommitAsync(ct);
    }
    private static BusinessException ConflictV2() => new("serial_state_conflict", "The selected physical unit does not match this exact order line's remaining entitlement.");
}

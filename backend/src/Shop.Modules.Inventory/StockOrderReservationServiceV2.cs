using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed partial class StockReservationService
{
    async Task<StockOrderReservationDataV2> IStockOrderReservationsV2.HoldAsync(StockOrderHoldV2Request supplied, CancellationToken ct)
    {
        var request = StockOrderReservationV2Rules.Normalize(supplied, allowDemo);
        RequireV2Transaction();
        var hash = Hash(JsonSerializer.Serialize(new { ContractVersion = 2, request.OrderId, request.ExpiresAt, request.Lines, request.Allocations }));
        var id = Hash("reservation:" + request.OwnerId.ToUpperInvariant() + ":" + request.RequestId)[..32].ToLowerInvariant();
        await LockAsync("request", request.OwnerId.ToUpperInvariant() + ":" + request.RequestId, ct);
        await LockAsync("order", request.OrderId, ct);
        await LockAsync("reservation", id, ct);
        // The same request/order/reservation application locks as V1 protect
        // immutable replay identity, without taking cross-owner empty ranges.
        var previous = await db.Reservations.FromSqlInterpolated($"SELECT * FROM [inventory].[Reservations] WITH (READCOMMITTEDLOCK) WHERE [OwnerId]={request.OwnerId} AND [RequestId]={request.RequestId}").SingleOrDefaultAsync(ct);
        if (previous is not null) {
            await db.Entry(previous).ReloadAsync(ct); RequireV2(previous);
            await RequireVisibleV2Async(previous, ct);
            if (previous.PayloadHash != hash) throw new BusinessException("idempotency_conflict", "This reservation request id has another payload.");
            await LoadV2GraphAsync(previous, ct);
            // A historical hold never re-transfers or revalidates a live
            // allocation. It can only perform its own due expiry once.
            await ExpireV2CoreAsync(previous, "inventory-expiry", ct);
            return V2Data(previous);
        }
        if (await db.Reservations.FromSqlInterpolated($"SELECT * FROM [inventory].[Reservations] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={request.OrderId}").AnyAsync(ct)) throw new BusinessException("reservation_conflict", "This order already has a reservation.");

        foreach (var allocation in request.Allocations) await LockAsync("sourcing-allocation-acceptance", allocation.Plan.AcceptanceId, ct);
        foreach (var allocation in request.Allocations.OrderBy(a => a.AllocationId, StringComparer.Ordinal)) await LockAsync("sourcing-allocation-resource", allocation.AllocationId, ct);
        var allocations = new List<SourcingStockAllocation>();
        foreach (var selected in request.Allocations) {
            var row = await db.SourcingAllocations.FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={selected.AllocationId} AND [OwnerId]={request.OwnerId}").SingleOrDefaultAsync(ct) ?? throw MissingV2();
            await db.Entry(row).ReloadAsync(ct);
            if (row.ContainsDemo && !allowDemo) throw MissingV2();
            SerialRules.MatchVersion(row.Version, selected.Version);
            await db.Entry(row).Collection(a => a.Lines).LoadAsync(ct);
            ValidateV2Allocation(selected, row, clock.GetUtcNow());
            if (await db.SourcingAllocationTransfers.FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocationTransfers] WITH (READCOMMITTEDLOCK) WHERE [AllocationId]={row.Id}").AnyAsync(ct)) throw new BusinessException("sourcing_allocation_transferred_conflict", "The accepted allocation already belongs to an order.");
            allocations.Add(row);
        }

        var stocks = await LockStockAsync(request.Lines.Select(l => l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase), ct);
        SourcingCheckoutInventoryRules.ValidateHeldStock(allocations, stocks);
        foreach (var group in request.Lines.GroupBy(l => l.VariantId, StringComparer.OrdinalIgnoreCase)) {
            if (!stocks.TryGetValue(group.Key, out var stock)) throw new BusinessException("insufficient_stock", "The order requires actual existing Stock.");
            var ordinary = group.Where(l => l.AllocationId is null).Sum(l => (long)l.Quantity);
            if (ordinary > StockAvailability.Available(stock.OnHand, stock.Reserved, stock.SourcingReserved)) throw new BusinessException("insufficient_stock", "Public Stock cannot borrow an accepted allocation's units.");
        }

        // Discovery is protected by every relevant Stock lock; all writers of
        // these units/claims take that same Stock lock before changing them.
        var allocationIds = allocations.Select(a => a.Id).ToArray();
        var claimed = await db.SerialUnitClaims.AsNoTracking().Where(c => allocationIds.Contains(c.OriginAllocationId) && c.IsActive).OrderBy(c => c.UnitId).Take(6401).ToArrayAsync(ct);
        if (claimed.Length > 6400 || claimed.GroupBy(c => c.OriginAllocationId).Any(g => g.Count() > 100)) throw V2Invariant();
        var units = await LockV2UnitsAsync(claimed.Select(c => c.UnitId), ct);
        var claims = new List<SerialUnitClaim>();
        foreach (var candidate in claimed) {
            var claim = await db.SerialUnitClaims.FromSqlInterpolated($"SELECT * FROM [inventory].[SerialUnitClaims] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={candidate.Id}").SingleAsync(ct);
            await db.Entry(claim).ReloadAsync(ct); claims.Add(claim);
        }
        foreach (var allocation in allocations)
            foreach (var line in allocation.Lines) {
                var matching = claims.Where(c => c.OriginAllocationId == allocation.Id && c.OfferLineId == line.OfferLineId).ToArray();
                if (matching.Length != (line.TrackingMode == "none" ? 0 : line.Quantity)) throw V2Invariant();
                foreach (var claim in matching)
                    if (!claim.IsActive || claim.State != "AllocationHeld" || claim.ReservationId is not null || claim.OrderId is not null || claim.OrderLineId is not null || !claim.VariantId.Equals(line.VariantId, StringComparison.OrdinalIgnoreCase) || !units.TryGetValue(claim.UnitId, out var unit) || !unit.VariantId.Equals(line.VariantId, StringComparison.OrdinalIgnoreCase) || unit.State != "available" || unit.ReservationId is not null || unit.OrderId is not null || unit.OrderLineId is not null) throw V2Invariant();
            }

        var now = clock.GetUtcNow();
        foreach (var selected in request.Allocations) ValidateV2Allocation(selected, allocations.Single(a => a.Id == selected.AllocationId), now);
        var deadlines = request.Allocations.Select(a => a.Plan.PurchaseUntil).Concat(allocations.Select(a => a.ExpiresAt)).ToArray();
        StockOrderReservationV2Rules.ValidateDeadline(request.ExpiresAt, deadlines, now);
        var reservation = new StockReservation { Id = id, ContractVersion = 2, OwnerId = request.OwnerId, OrderId = request.OrderId, RequestId = request.RequestId, PayloadHash = hash, State = StockReservationState.Active, CreatedAt = now, ChangedAt = now, ExpiresAt = request.ExpiresAt };
        foreach (var line in request.Lines) reservation.LineEntitlements.Add(new() { ReservationId = id, LineId = line.LineId, VariantId = stocks[line.VariantId].VariantId, Quantity = line.Quantity, TrackingMode = stocks[line.VariantId].TrackingMode, AllocationId = line.AllocationId, OfferLineId = line.OfferLineId });
        foreach (var group in request.Lines.GroupBy(l => l.VariantId, StringComparer.OrdinalIgnoreCase)) {
            var stock = stocks[group.Key]; var accepted = checked((int)group.Where(l => l.AllocationId is not null).Sum(l => (long)l.Quantity)); var total = checked((int)group.Sum(l => (long)l.Quantity));
            stock.SourcingReserved -= accepted; stock.Reserved = checked(stock.Reserved + total);
            _ = StockAvailability.Available(stock.OnHand, stock.Reserved, stock.SourcingReserved);
            reservation.Items.Add(new() { ReservationId = id, VariantId = stock.VariantId, Quantity = total });
        }
        db.Reservations.Add(reservation); AddEvent(reservation, request.OwnerId);
        foreach (var allocation in allocations) {
            db.SourcingAllocationTransfers.Add(new() { AllocationId = allocation.Id, ReservationId = id, OrderId = request.OrderId, OwnerId = request.OwnerId, AcceptanceId = allocation.AcceptanceId, AllocationVersion = Convert.ToBase64String(allocation.Version), OriginalExpiresAt = allocation.ExpiresAt, TransferredAt = now, ContainsDemo = allocation.ContainsDemo });
            allocation.State = "Transferred"; allocation.IsActive = false; allocation.ChangedAt = now;
            db.SourcingAllocationEvents.Add(new() { AllocationId = allocation.Id, State = "Transferred", ActorId = request.OwnerId, Reason = "Accepted allocation transferred to order " + request.OrderId, At = now });
        }
        foreach (var claim in claims) {
            var line = request.Lines.Single(l => l.AllocationId == claim.OriginAllocationId && l.OfferLineId == claim.OfferLineId);
            claim.State = "OrderHeld"; claim.ReservationId = id; claim.OrderId = request.OrderId; claim.OrderLineId = line.LineId; claim.ChangedAt = now;
        }
        StockOrderReservationV2Rules.ValidateDeadline(request.ExpiresAt, deadlines, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        StockOrderReservationV2Rules.ValidateDeadline(request.ExpiresAt, deadlines, clock.GetUtcNow());
        return V2Data(reservation);
    }

    async Task<StockOrderReservationDataV2> IStockOrderReservationsV2.ReadAsync(string ownerId, string reservationId, CancellationToken ct)
    {
        var row = await db.Reservations.AsNoTracking().Include(r => r.Items).Include(r => r.LineEntitlements).AsSplitQuery().SingleOrDefaultAsync(r => r.Id == Uuid(reservationId) && r.OwnerId == Identifier(ownerId), ct) ?? throw MissingV2();
        RequireV2(row); await RequireVisibleV2Async(row, ct); ValidateV2Graph(row); await ValidateV2TransfersAsync(row, ct);
        var current = await db.Reservations.AsNoTracking().Where(r => r.Id == row.Id && r.OwnerId == row.OwnerId).Select(r => r.Version).SingleOrDefaultAsync(ct);
        if (current is null || !current.SequenceEqual(row.Version)) throw new BusinessException("version_conflict", "The reservation changed while reading its line rights.");
        var data = V2Data(row);
        return row.State == StockReservationState.Active && row.ExpiresAt <= clock.GetUtcNow() ? data with { State = StockReservationState.Expired } : data;
    }
    Task<StockOrderReservationDataV2> IStockOrderReservationsV2.AllocateAsync(string owner, string id, string actor, CancellationToken ct) => ChangeV2Async(owner, id, actor, StockReservationState.Allocated, ct);
    Task<StockOrderReservationDataV2> IStockOrderReservationsV2.ReleaseAsync(string owner, string id, string actor, CancellationToken ct) => ChangeV2Async(owner, id, actor, StockReservationState.Released, ct);
    Task<StockOrderReservationDataV2> IStockOrderReservationsV2.FulfillAsync(string owner, string id, string actor, CancellationToken ct) => ChangeV2Async(owner, id, actor, StockReservationState.Fulfilled, ct);
    Task<StockOrderReservationDataV2> IStockOrderReservationsV2.ExpireIfDueAsync(string owner, string id, string actor, CancellationToken ct) => ChangeV2Async(owner, id, actor, null, ct);

    private async Task<StockOrderReservationDataV2> ChangeV2Async(string ownerId, string reservationId, string actorId, StockReservationState? target, CancellationToken ct)
    {
        var owner = Identifier(ownerId); var id = Uuid(reservationId); var actor = Identifier(actorId);
        await using var tx = await BeginAsync(ct); await LockAsync("reservation", id, ct);
        var row = await LoadAsync(owner, id, ct); RequireV2(row); await RequireVisibleV2Async(row, ct); await LoadV2GraphAsync(row, ct);
        await ExpireV2CoreAsync(row, actor, ct);
        if (target is null || row.State == target || row.State == StockReservationState.Expired || target == StockReservationState.Allocated && row.State == StockReservationState.Fulfilled) {
            if (tx is not null) await tx.CommitAsync(ct); return V2Data(row);
        }
        if (!(target == StockReservationState.Allocated && row.State == StockReservationState.Active || target == StockReservationState.Released && row.State is StockReservationState.Active or StockReservationState.Allocated || target == StockReservationState.Fulfilled && row.State == StockReservationState.Allocated))
            throw new BusinessException("reservation_state_conflict", "This reservation cannot make the requested transition.");
        if (target is StockReservationState.Released or StockReservationState.Fulfilled) await RemoveV2ReservedAsync(row, target.Value, actor, ct);
        row.State = target.Value; row.ChangedAt = clock.GetUtcNow(); AddEvent(row, actor); await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct); return V2Data(row);
    }

    private async Task<bool> ExpireV2CoreAsync(StockReservation row, string actor, CancellationToken ct)
    {
        RequireV2(row); if (row.State != StockReservationState.Active || row.ExpiresAt > clock.GetUtcNow()) return false;
        await LockAsync("reservation", row.Id, ct); await db.Entry(row).ReloadAsync(ct);
        if (row.State != StockReservationState.Active || row.ExpiresAt > clock.GetUtcNow()) return false;
        await LoadV2GraphAsync(row, ct); await RemoveV2ReservedAsync(row, StockReservationState.Expired, actor, ct);
        row.State = StockReservationState.Expired; row.ChangedAt = clock.GetUtcNow(); AddEvent(row, actor); await db.SaveChangesAsync(ct); return true;
    }

    private async Task RemoveV2ReservedAsync(StockReservation row, StockReservationState target, string actor, CancellationToken ct)
    {
        await GuardNoPartialDispatchAsync(row.Id,ct);
        ValidateV2Graph(row); var fulfill = target == StockReservationState.Fulfilled;
        var stocks = await LockStockAsync(row.Items.Select(i => i.VariantId), ct);
        foreach (var item in row.Items) {
            if (!stocks.TryGetValue(item.VariantId, out var stock) || stock.Reserved < item.Quantity || stock.OnHand < item.Quantity || row.LineEntitlements.Any(l => l.VariantId.Equals(item.VariantId, StringComparison.OrdinalIgnoreCase) && l.TrackingMode != stock.TrackingMode)) throw V2Invariant();
            _ = StockAvailability.Available(stock.OnHand, stock.Reserved, stock.SourcingReserved);
        }
        var claimCandidates = await db.SerialUnitClaims.AsNoTracking().Where(c => c.ReservationId == row.Id || c.OrderId == row.OrderId).OrderBy(c => c.UnitId).Take(6401).ToArrayAsync(ct);
        if (claimCandidates.Length > 6400) throw V2Invariant();
        var assignedIds = await db.SerialUnits.AsNoTracking().Where(u => u.ReservationId == row.Id || u.OrderId == row.OrderId).Select(u => u.Id).ToArrayAsync(ct);
        var units = await LockV2UnitsAsync(assignedIds.Concat(claimCandidates.Select(c => c.UnitId)), ct);
        var claims = new List<SerialUnitClaim>();
        foreach (var candidate in claimCandidates) {
            var claim = await db.SerialUnitClaims.FromSqlInterpolated($"SELECT * FROM [inventory].[SerialUnitClaims] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={candidate.Id}").SingleAsync(ct);
            await db.Entry(claim).ReloadAsync(ct); claims.Add(claim);
        }
        foreach (var claim in claims) {
            var line = row.LineEntitlements.SingleOrDefault(l => l.LineId == claim.OrderLineId);
            if (claim.ReservationId != row.Id || claim.OrderId != row.OrderId || line is null || line.AllocationId != claim.OriginAllocationId || line.OfferLineId != claim.OfferLineId || !line.VariantId.Equals(claim.VariantId, StringComparison.OrdinalIgnoreCase) || claim.State is not ("OrderHeld" or "Assigned") || claim.IsActive != (claim.State == "OrderHeld") || !units.TryGetValue(claim.UnitId, out var unit)) throw V2Invariant();
            if (claim.State == "OrderHeld") {
                if (fulfill) throw new BusinessException("serial_assignment_required", "Assign every promised physical unit before fulfillment.");
                if (unit.State != "available" || unit.ReservationId is not null || unit.OrderId is not null || unit.OrderLineId is not null) throw V2Invariant();
            } else if (unit.State != "assigned" || unit.ReservationId != row.Id || unit.OrderId != row.OrderId || unit.OrderLineId != line.LineId) throw V2Invariant();
        }
        foreach (var line in row.LineEntitlements) {
            var count = units.Values.Count(u => u.State == "assigned" && u.ReservationId == row.Id && u.OrderLineId == line.LineId && u.VariantId.Equals(line.VariantId, StringComparison.OrdinalIgnoreCase));
            if (count > line.Quantity || line.TrackingMode == "none" && count != 0) throw V2Invariant();
            if (fulfill && line.TrackingMode != "none" && count != line.Quantity) throw new BusinessException("serial_assignment_required", "Assign every tracked order line before fulfillment.");
            if (claims.Count(c => c.OrderLineId == line.LineId) != (line.AllocationId is not null && line.TrackingMode != "none" ? line.Quantity : 0)) throw V2Invariant();
        }
        foreach (var unit in units.Values.Where(u => u.ReservationId == row.Id || u.OrderId == row.OrderId)) {
            if (unit.State != "assigned" || unit.ReservationId != row.Id || unit.OrderId != row.OrderId || !row.LineEntitlements.Any(l => l.LineId == unit.OrderLineId && l.VariantId.Equals(unit.VariantId, StringComparison.OrdinalIgnoreCase))) throw V2Invariant();
            if (await db.SerialUnitClaims.AnyAsync(c => c.UnitId == unit.Id && c.IsActive && c.ReservationId != row.Id, ct)) throw V2Invariant();
        }
        var now = clock.GetUtcNow();
        foreach (var claim in claims) { claim.State = fulfill ? "Fulfilled" : target == StockReservationState.Expired ? "Expired" : "Released"; claim.IsActive = false; claim.ChangedAt = now; }
        foreach (var unit in units.Values.Where(u => u.ReservationId == row.Id)) {
            unit.State = fulfill ? "delivered" : "available"; unit.ChangedAt = now;
            if (!fulfill) { unit.OrderId = null; unit.ReservationId = null; unit.OrderLineId = null; unit.WarrantyUntil = null; }
            db.SerialEvents.Add(new() { UnitId = unit.Id, State = unit.State, ActorId = actor, At = now, OrderId = row.OrderId, Reason = fulfill ? "Order v2 fulfillment" : "Order v2 release" });
        }
        foreach (var item in row.Items) {
            var stock = stocks[item.VariantId]; stock.Reserved -= item.Quantity;
            if (fulfill) { stock.OnHand -= item.Quantity; db.Movements.Add(new() { VariantId = stock.VariantId, Delta = -item.Quantity, Balance = stock.OnHand, ActorId = actor, At = now, Reason = "Order v2 fulfillment " + row.OrderId, RequestId = Hash("fulfill:" + row.Id + ":" + stock.VariantId.ToUpperInvariant()) }); }
            _ = StockAvailability.Available(stock.OnHand, stock.Reserved, stock.SourcingReserved);
        }
    }

    internal async Task<Dictionary<string, SerialUnit>> LockV2UnitsAsync(IEnumerable<string> supplied, CancellationToken ct)
    {
        var result = new Dictionary<string, SerialUnit>(StringComparer.Ordinal);
        foreach (var id in supplied.Distinct(StringComparer.Ordinal).OrderBy(x => x, StringComparer.Ordinal)) {
            var row = await db.SerialUnits.FromSqlInterpolated($"SELECT * FROM [inventory].[SerialUnits] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id}").SingleOrDefaultAsync(ct);
            if (row is null) continue; await db.Entry(row).ReloadAsync(ct); result.Add(id, row);
        }
        return result;
    }
    internal async Task LoadV2GraphAsync(StockReservation row, CancellationToken ct)
    {
        RequireV2(row); await LoadImmutableItemsAsync(row, ct);
        row.LineEntitlements = await db.ReservationLineEntitlements.FromSqlInterpolated($"SELECT * FROM [inventory].[ReservationLineEntitlements] WITH (READCOMMITTEDLOCK) WHERE [ReservationId]={row.Id}").ToListAsync(ct);
        ValidateV2Graph(row); await ValidateV2TransfersAsync(row, ct);
    }
    private async Task ValidateV2TransfersAsync(StockReservation row, CancellationToken ct)
    {
        var ids = row.LineEntitlements.Where(l => l.AllocationId is not null).Select(l => l.AllocationId!).Distinct(StringComparer.Ordinal).ToArray();
        var transfers = await db.SourcingAllocationTransfers.FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocationTransfers] WITH (READCOMMITTEDLOCK) WHERE [ReservationId]={row.Id}").AsNoTracking().Take(65).ToArrayAsync(ct);
        if (ids.Length == 0 || transfers.Length != ids.Length || transfers.Any(t => !ids.Contains(t.AllocationId, StringComparer.Ordinal) || t.OrderId != row.OrderId || t.OwnerId != row.OwnerId || t.TransferredAt != row.CreatedAt || t.OriginalExpiresAt < row.ExpiresAt)) throw V2Invariant();
    }
    internal async Task RequireVisibleV2Async(StockReservation row, CancellationToken ct)
    {
        if (!allowDemo && await db.SourcingAllocationTransfers.FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocationTransfers] WITH (READCOMMITTEDLOCK) WHERE [ReservationId]={row.Id}").AnyAsync(t => t.ContainsDemo, ct)) throw MissingV2();
    }
    internal static void RequireV2(StockReservation row)
    {
        if (row.ContractVersion != 2) throw new BusinessException("reservation_contract_upgrade_required", "Use the reservation's explicit stored contract.");
    }
    internal static void ValidateV2Graph(StockReservation row)
    {
        RequireV2(row);
        if (row.LineEntitlements.Count is < 1 or > 64 || row.Items.Count is < 1 or > 64 || row.LineEntitlements.Select(l => l.LineId).Distinct(StringComparer.Ordinal).Count() != row.LineEntitlements.Count || row.LineEntitlements.Any(l => l.ReservationId != row.Id || l.Quantity is < 1 or > 1000000 || l.TrackingMode is not ("none" or "serial" or "imei") || (l.AllocationId is null) != (l.OfferLineId is null)) || row.Items.Count != row.LineEntitlements.Select(l => l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).Count()) throw V2Invariant();
        foreach (var item in row.Items)
            if (item.Quantity != row.LineEntitlements.Where(l => l.VariantId.Equals(item.VariantId, StringComparison.OrdinalIgnoreCase)).Sum(l => (long)l.Quantity)) throw V2Invariant();
    }
    private void RequireV2Transaction()
    {
        if (db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Order v2 holds require the root Serializable transaction and every preceding Agreement lock.");
    }
    private static void ValidateV2Allocation(StockOrderAllocationV2 selected, SourcingStockAllocation row, DateTimeOffset now)
    {
        if (row.State != "Active" || !row.IsActive) throw new BusinessException("sourcing_allocation_transferred_conflict", "A complete active allocation is required for a new order.");
        var proof = new SourcingStockConversionProof(row.Id, row.RequestId, row.TaskId, row.OfferId, row.AcceptanceId, row.TermsHash, Convert.ToBase64String(row.Version), row.ExpiresAt, row.ContainsDemo, row.Lines.OrderBy(l => l.OfferLineId, StringComparer.Ordinal).Select(l => new SourcingAllocationSummaryLine(l.OfferLineId, l.VariantId, l.Quantity)).ToArray());
        SourcingStockConversionRules.ValidateCoverage(selected.Plan, proof, now);
    }
    private static StockOrderReservationDataV2 V2Data(StockReservation row) => new(2, row.Id, row.OrderId, row.State, row.CreatedAt, row.ExpiresAt, row.LineEntitlements.OrderBy(l => l.LineId, StringComparer.Ordinal).Select(l => new StockOrderReservationLineV2(l.LineId, l.VariantId, l.Quantity, l.TrackingMode, l.AllocationId, l.OfferLineId)).ToArray());
    private static BusinessException MissingV2() => new("not_found", "The order reservation was not found.");
    private static InvalidOperationException V2Invariant() => new("Version 2 reservation rights, aggregate Stock or physical claims are inconsistent.");
}

using System.Data;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// These tests exercise only the price-free Inventory boundary in real SQL.
// Sales/HTTP tests separately establish consent, finance and the shared root tx.
public sealed partial class StockOrderReservationV2SqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static string Id() => Guid.NewGuid().ToString("N");
    private static readonly string Fingerprint = new('A', 64);
    private const string Version = "AAAAAAAAAAE=";
    private sealed class Clock : TimeProvider
    {
        private long ticks = DateTimeOffset.UtcNow.UtcTicks;
        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref ticks), TimeSpan.Zero);
        public void Advance(TimeSpan duration) => Interlocked.Add(ref ticks, duration.Ticks);
    }
    private readonly Clock clock = new();
    private sealed record Setup(string Variant, StockOrderHoldV2Request Request, SerialUnitData[] Units);
    private async Task<T> Scope<T>(Func<InventoryDbContext, Task<T>> action)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database); return await action(db);
    }
    private Task<T> Tx<T>(Func<InventoryDbContext, Task<T>> action) => Scope(async db => { await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable); var value = await action(db); await tx.CommitAsync(); return value; });
    private StockReservationService Reservations(InventoryDbContext db, bool allowDemo = true) => new(db, clock, allowDemo);
    private IStockOrderReservationsV2 V2(InventoryDbContext db, bool allowDemo = true) => Reservations(db, allowDemo);
    private Task<StockItem> Stock(string variant) => Scope(db => db.Stock.AsNoTracking().SingleAsync(s => s.VariantId == variant));
    private async Task<Setup> Prepare(bool tracked = true, int first = 2, int second = 1, int ordinary = 1, bool demo = false)
    {
        var variant = "order-v2-" + Id(); var quantity = first + second + ordinary; var owner = "owner-" + Id();
        await Scope(async db => { db.Stock.Add(new() { VariantId = variant, OnHand = tracked ? 0 : quantity }); await db.SaveChangesAsync(); return true; });
        var units = new List<SerialUnitData>();
        if (tracked) {
            var stock = await Stock(variant);
            await Tx(db => new SerialInventoryService(db, Reservations(db), clock).ConfigureAsync(variant, false, new("serial", Convert.ToBase64String(stock.Version), Id()), "order-inventory-qa", default));
            foreach (var batch in Enumerable.Range(0, quantity).Chunk(100)) {
                stock = await Stock(variant);
                var receipt = await Tx(db => new SerialInventoryService(db, Reservations(db), clock).ReceiveAsync(variant, false, new(batch.Select(i => new SerialUnitInput("QA-" + variant + "-" + i)).ToArray(), "Explicit synthetic Order2 physical receipt", Convert.ToBase64String(stock.Version), Id()), "order-inventory-qa", default));
                units.AddRange(receipt.Units);
            }
        }
        var allocations = new List<StockOrderAllocationV2>(); var lines = new List<StockOrderLineV2>(); var offset = 0;
        foreach (var accepted in new[] { first, second }) {
            if (accepted == 0) continue;
            var offerLine = Id(); var plan = new SourcingStockAllocationPlan(Id(), Id(), Id(), Id(), owner, Fingerprint, clock.GetUtcNow().AddHours(1), demo, [new(offerLine, variant, "model-qa", accepted, Fingerprint)]);
            var stock = await Stock(variant); var selected = tracked ? units.Skip(offset).Take(accepted).Select(u => new SourcingAllocationUnitInput(u.Id, u.Version)).ToArray() : []; offset += accepted;
            var allocation = await Tx(db => new SourcingAllocationService(db, Reservations(db), clock, true).AllocateAsync("order-inventory-qa", Id(), plan, new(Id(), Version, Version, Version, plan.AcceptanceId, plan.TermsHash, clock.GetUtcNow().AddMinutes(20), "Explicit synthetic Order2 sourcing allocation", [new(offerLine, Convert.ToBase64String(stock.Version), stock.TrackingMode, selected)]), default));
            allocations.Add(new(plan, allocation.AllocationId, allocation.Version)); lines.Add(new(Id(), variant, accepted, allocation.AllocationId, offerLine));
        }
        if (ordinary > 0) lines.Add(new(Id(), variant, ordinary));
        return new(variant, new(owner, Id(), Id(), clock.GetUtcNow().AddMinutes(10), lines.ToArray(), allocations.ToArray()), units.ToArray());
    }
    private Task<StockOrderReservationDataV2> Hold(Setup setup) => Tx(db => V2(db).HoldAsync(setup.Request, default));
    private Task<string> Snapshot(string variant) => Scope(async db => {
        var allocations = await db.SourcingAllocationLines.Where(l => l.VariantId == variant).Select(l => l.AllocationId).ToArrayAsync();
        var reservationIds = await db.ReservationItems.Where(l => l.VariantId == variant).Select(l => l.ReservationId).ToArrayAsync();
        return JsonSerializer.Serialize(new {
            Stock = await db.Stock.AsNoTracking().Where(s => s.VariantId == variant).ToArrayAsync(),
            Allocations = await db.SourcingAllocations.AsNoTracking().Where(a => allocations.Contains(a.Id)).OrderBy(a => a.Id).Select(a => new { a.Id, a.State, a.IsActive, a.ChangedAt, a.Version }).ToArrayAsync(),
            Claims = await db.SerialUnitClaims.AsNoTracking().Where(c => c.VariantId == variant).OrderBy(c => c.Id).ToArrayAsync(),
            Units = await db.SerialUnits.AsNoTracking().Where(u => u.VariantId == variant).OrderBy(u => u.Id).ToArrayAsync(),
            Reservations = await db.Reservations.AsNoTracking().Where(r => reservationIds.Contains(r.Id)).OrderBy(r => r.Id).Select(r => new { r.Id, r.ContractVersion, r.State, r.ExpiresAt, r.ChangedAt, r.Version }).ToArrayAsync(),
            Entitlements = await db.ReservationLineEntitlements.AsNoTracking().Where(l => l.VariantId == variant).OrderBy(l => l.LineId).ToArrayAsync(),
            Transfers = await db.SourcingAllocationTransfers.AsNoTracking().Where(t => allocations.Contains(t.AllocationId)).OrderBy(t => t.AllocationId).ToArrayAsync(),
            Events = await db.SourcingAllocationEvents.AsNoTracking().Where(e => allocations.Contains(e.AllocationId)).OrderBy(e => e.Id).ToArrayAsync(),
            ReservationEvents = await db.ReservationEvents.AsNoTracking().Where(e => reservationIds.Contains(e.ReservationId)).OrderBy(e => e.Id).ToArrayAsync(),
            Movements = await db.Movements.AsNoTracking().Where(m => m.VariantId == variant).OrderBy(m => m.Id).ToArrayAsync()
        });
    });
    private Task Assign(Setup setup, StockOrderReservationDataV2 hold, StockOrderSerialPickV2[] picks, string? command = null) => Scope(async db => { await ((IStockSerialAssignmentsV2)new SerialInventoryService(db, Reservations(db), clock)).AssignAsync(new(setup.Request.OwnerId, hold.Id, "order-inventory-qa", command ?? Id(), picks), default); return true; });
    private Task<SerialUnit[]> Units(Setup setup) => Scope(db => db.SerialUnits.AsNoTracking().Where(u => u.VariantId == setup.Variant).OrderBy(u => u.Id).ToArrayAsync());

    [Theory][InlineData(false)][InlineData(true)]
    public async Task MixedSameSkuLinesTransferOnlyAcceptedCountersAndKeepIndependentRights(bool tracked)
    {
        var setup = await Prepare(tracked); var hold = await Hold(setup); var stock = await Stock(setup.Variant);
        Assert.Equal(2, hold.SchemaVersion); Assert.Equal(setup.Request.ExpiresAt, hold.ExpiresAt); Assert.Equal(3, hold.Lines.Length); Assert.Equal(4, hold.Lines.Sum(l => l.Quantity));
        Assert.Equal(4, stock.OnHand); Assert.Equal(4, stock.Reserved); Assert.Equal(0, stock.SourcingReserved); Assert.Equal(0, StockAvailability.Available(stock.OnHand, stock.Reserved, stock.SourcingReserved));
        await Scope(async db => {
            Assert.Single(await db.ReservationItems.Where(i => i.ReservationId == hold.Id).ToArrayAsync());
            Assert.Equal(2, await db.SourcingAllocationTransfers.CountAsync(t => t.ReservationId == hold.Id));
            Assert.All(await db.SourcingAllocations.Where(a => setup.Request.Allocations.Select(r => r.AllocationId).Contains(a.Id)).ToArrayAsync(), a => { Assert.Equal("Transferred", a.State); Assert.False(a.IsActive); });
            var claims = await db.SerialUnitClaims.Where(c => c.ReservationId == hold.Id).ToArrayAsync(); Assert.Equal(tracked ? 3 : 0, claims.Length);
            Assert.All(claims, c => { Assert.Equal("OrderHeld", c.State); Assert.True(c.IsActive); Assert.Equal(setup.Request.OrderId, c.OrderId); Assert.Contains(hold.Lines, l => l.LineId == c.OrderLineId && l.AllocationId == c.OriginAllocationId && l.OfferLineId == c.OfferLineId); }); return true;
        });
        var before = await Snapshot(setup.Variant); var replay = await Hold(setup); Assert.Equal(JsonSerializer.Serialize(hold), JsonSerializer.Serialize(replay)); Assert.Equal(before, await Snapshot(setup.Variant));
        await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default));
    }

    [Fact]
    public async Task AllocationOneHundredUnitLimitsRemainIndependentAcrossTheWholeOrder()
    {
        var setup = await Prepare(first: 100, second: 100, ordinary: 0); var hold = await Hold(setup);
        Assert.Equal(200, hold.Lines.Sum(l => l.Quantity)); Assert.Equal(200, await Scope(db => db.SerialUnitClaims.CountAsync(c => c.ReservationId == hold.Id && c.State == "OrderHeld" && c.IsActive)));
        await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default));
        Assert.Equal(200, (await Stock(setup.Variant)).OnHand); Assert.Equal(0, (await Stock(setup.Variant)).Reserved);
    }

    [Fact]
    public async Task RollbackAfterTheCompleteHoldRestoresEveryCounterClaimTransferAndHistory()
    {
        var setup = await Prepare(); var before = await Snapshot(setup.Variant);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Tx<bool>(async db => { await V2(db).HoldAsync(setup.Request, default); throw new InvalidOperationException("Explicit synthetic root failure after Inventory hold"); }));
        Assert.Equal(before, await Snapshot(setup.Variant)); var hold = await Hold(setup); await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default));
    }

    [Fact]
    public async Task ReleasingAssignedAndUnassignedClaimsNeverResurrectsSourcingOrAnOldHold()
    {
        var setup = await Prepare(); var hold = await Hold(setup); await Scope(db => V2(db).AllocateAsync(setup.Request.OwnerId, hold.Id, "verified-QA-payment", default));
        var lines = hold.Lines.Where(l => l.AllocationId is not null).ToArray();
        var promised = await Scope(db => db.SerialUnitClaims.AsNoTracking().Where(c => c.ReservationId == hold.Id && c.OrderLineId == lines[0].LineId).FirstAsync()); var unit = (await Units(setup)).Single(u => u.Id == promised.UnitId);
        var ordinary = hold.Lines.Single(l => l.AllocationId is null); var free = (await Units(setup)).Single(u => !setup.Units.Take(3).Select(x => x.Id).Contains(u.Id));
        var command = Id(); await Assign(setup, hold, [new(lines[0].LineId, unit.Id, Convert.ToBase64String(unit.Version)), new(ordinary.LineId, free.Id, Convert.ToBase64String(free.Version))], command);
        var released = await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default)); Assert.Equal(StockReservationState.Released, released.State);
        var after = await Snapshot(setup.Variant); await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default)); var replay = await Hold(setup);
        Assert.Equal(StockReservationState.Released, replay.State); Assert.Equal(hold.ExpiresAt, replay.ExpiresAt); Assert.Equal(after, await Snapshot(setup.Variant));
        var stock = await Stock(setup.Variant); Assert.Equal(4, stock.OnHand); Assert.Equal(0, stock.Reserved); Assert.Equal(0, stock.SourcingReserved);
        Assert.All(await Units(setup), u => { Assert.Equal("available", u.State); Assert.Null(u.OrderId); Assert.Null(u.ReservationId); Assert.Null(u.OrderLineId); });
        await Scope(async db => { Assert.All(await db.SerialUnitClaims.Where(c => c.ReservationId == hold.Id).ToArrayAsync(), c => { Assert.Equal("Released", c.State); Assert.False(c.IsActive); Assert.NotNull(c.OrderLineId); }); Assert.Equal(2, await db.SourcingAllocationTransfers.CountAsync(t => t.ReservationId == hold.Id)); return true; });
        // An old assignment receipt is historical after release and cannot
        // assign those units again, even when its original unit versions differ.
        await Assign(setup, hold, [new(lines[0].LineId, unit.Id, Convert.ToBase64String(unit.Version)), new(ordinary.LineId, free.Id, Convert.ToBase64String(free.Version))], command);
        Assert.Equal(after, await Snapshot(setup.Variant));
    }

    [Fact]
    public async Task ExactLineEntitlementsRejectSwappingPromisedAndOrdinaryUnitsOfTheSameSku()
    {
        var setup = await Prepare(); var hold = await Hold(setup); await Scope(db => V2(db).AllocateAsync(setup.Request.OwnerId, hold.Id, "verified-QA-payment", default));
        var claim = await Scope(db => db.SerialUnitClaims.AsNoTracking().FirstAsync(c => c.ReservationId == hold.Id)); var unit = (await Units(setup)).Single(u => u.Id == claim.UnitId); var ordinary = hold.Lines.Single(l => l.AllocationId is null); var before = await Snapshot(setup.Variant);
        Assert.Equal("serial_state_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Assign(setup, hold, [new(ordinary.LineId, unit.Id, Convert.ToBase64String(unit.Version))]))).Code);
        var other = hold.Lines.First(l => l.AllocationId is not null && l.LineId != claim.OrderLineId);
        Assert.Equal("serial_state_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Assign(setup, hold, [new(other.LineId, unit.Id, Convert.ToBase64String(unit.Version))]))).Code);
        Assert.Equal(before, await Snapshot(setup.Variant)); await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default));
    }

    [Fact]
    public async Task FulfillmentRequiresEveryExactTrackedLineAndConsumesOnHandOnlyOnce()
    {
        var setup = await Prepare(); var hold = await Hold(setup); await Scope(db => V2(db).AllocateAsync(setup.Request.OwnerId, hold.Id, "verified-QA-payment", default));
        Assert.Equal("serial_assignment_required", (await Assert.ThrowsAsync<BusinessException>(() => Scope(db => V2(db).FulfillAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default)))).Code);
        var claims = await Scope(db => db.SerialUnitClaims.AsNoTracking().Where(c => c.ReservationId == hold.Id).ToArrayAsync()); var units = await Units(setup); var ordinary = hold.Lines.Single(l => l.AllocationId is null);
        var picks = units.Select(u => new StockOrderSerialPickV2(claims.SingleOrDefault(c => c.UnitId == u.Id)?.OrderLineId ?? ordinary.LineId, u.Id, Convert.ToBase64String(u.Version), clock.GetUtcNow().AddYears(1))).ToArray();
        await Assign(setup, hold, picks); var delivered = await Scope(db => V2(db).FulfillAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default)); Assert.Equal(StockReservationState.Fulfilled, delivered.State);
        var after = await Snapshot(setup.Variant); await Scope(db => V2(db).FulfillAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default)); Assert.Equal(after, await Snapshot(setup.Variant));
        var stock = await Stock(setup.Variant); Assert.Equal(0, stock.OnHand); Assert.Equal(0, stock.Reserved); Assert.Equal(0, stock.SourcingReserved); Assert.All(await Units(setup), u => { Assert.Equal("delivered", u.State); Assert.NotNull(u.OrderLineId); });
        Assert.Equal(1, await Scope(db => db.Movements.CountAsync(m => m.VariantId == setup.Variant && m.Reason.StartsWith("Order v2 fulfillment"))));
        Assert.All(await Scope(db => db.SerialUnitClaims.AsNoTracking().Where(c => c.ReservationId == hold.Id).ToArrayAsync()), c => { Assert.Equal("Fulfilled", c.State); Assert.False(c.IsActive); });
    }

    [Fact]
    public async Task LegacyReadersMutationsAndSerialReplayNeverDowngradeVersionTwo()
    {
        var setup = await Prepare(); var hold = await Hold(setup); var before = await Snapshot(setup.Variant);
        Assert.Equal("reservation_contract_upgrade_required", (await Assert.ThrowsAsync<BusinessException>(() => Scope(db => Reservations(db).ReadAsync(setup.Request.OwnerId, hold.Id, default)))).Code);
        foreach (var operation in new Func<StockReservationService, Task<StockReservationData>>[] { s => s.AllocateAsync(setup.Request.OwnerId, hold.Id, "qa", default), s => s.ReleaseAsync(setup.Request.OwnerId, hold.Id, "qa", default), s => s.FulfillAsync(setup.Request.OwnerId, hold.Id, "qa", default) })
            Assert.Equal("reservation_contract_upgrade_required", (await Assert.ThrowsAsync<BusinessException>(() => Scope(db => operation(Reservations(db))))).Code);
        Assert.Equal("reservation_contract_upgrade_required", (await Assert.ThrowsAsync<BusinessException>(() => Scope(async db => { await new SerialInventoryService(db, Reservations(db), clock).AssignAsync(new StockSerialAssignment(setup.Request.OwnerId, hold.Id, "qa", Id(), [new(setup.Units[0].Id, setup.Units[0].Version)]), default); return true; }))).Code);
        Assert.Equal(before, await Snapshot(setup.Variant)); await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default));
    }

    [Fact]
    public async Task IndependentExpiryWorkerDispatchesVersionTwoWithoutReleasingTheTransferredOriginTwice()
    {
        var setup = await Prepare(); var hold = await Hold(setup); clock.Advance(TimeSpan.FromMinutes(11));
        var effective = await Scope(db => V2(db).ReadAsync(setup.Request.OwnerId, hold.Id, default)); Assert.Equal(StockReservationState.Expired, effective.State); Assert.Equal(4, (await Stock(setup.Variant)).Reserved);
        await Scope(db => Reservations(db).ExpireBatchAsync(100, default)); var after = await Snapshot(setup.Variant); await Scope(db => Reservations(db).ExpireBatchAsync(100, default)); Assert.Equal(after, await Snapshot(setup.Variant));
        Assert.Equal(StockReservationState.Expired, (await Hold(setup)).State); Assert.Equal(0, (await Stock(setup.Variant)).Reserved); Assert.Equal(0, (await Stock(setup.Variant)).SourcingReserved);
        await Scope(async db => { Assert.Single(await db.ReservationEvents.Where(e => e.ReservationId == hold.Id && e.State == StockReservationState.Expired).ToArrayAsync()); Assert.All(await db.SourcingAllocations.Where(a => setup.Request.Allocations.Select(x => x.AllocationId).Contains(a.Id)).ToArrayAsync(), a => Assert.Equal("Transferred", a.State)); return true; });
    }

    [Fact]
    public async Task TwoRacingIdenticalHoldsProduceOneReservationAndOneTransferPerOrigin()
    {
        var setup = await Prepare(); var results = await Task.WhenAll(Hold(setup), Hold(setup)); Assert.Equal(results[0].Id, results[1].Id); Assert.Equal(results[0].ExpiresAt, results[1].ExpiresAt);
        Assert.Equal(1, await Scope(db => db.Reservations.CountAsync(r => r.OrderId == setup.Request.OrderId))); Assert.Equal(2, await Scope(db => db.SourcingAllocationTransfers.CountAsync(t => t.ReservationId == results[0].Id))); Assert.Equal(4, (await Stock(setup.Variant)).Reserved);
        await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, results[0].Id, "order-inventory-qa", default));
    }

    [Fact]
    public async Task AChangedCommandCannotReplayOrReclaimItsReleasedOrigin()
    {
        var setup = await Prepare(false); var hold = await Hold(setup); await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default)); var before = await Snapshot(setup.Variant);
        Assert.Equal("idempotency_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Hold(setup with { Request = setup.Request with { ExpiresAt = setup.Request.ExpiresAt.AddSeconds(1) } }))).Code);
        var newCommand = setup with { Request = setup.Request with { OrderId = Id(), RequestId = Id() } };
        Assert.Equal("version_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Hold(newCommand))).Code);
        Assert.Equal(before, await Snapshot(setup.Variant));
    }

    [Fact]
    public async Task AHiddenDemoCannotBeReadOrReplayedThroughTheProductionBoundary()
    {
        var setup = await Prepare(demo: true); var hold = await Hold(setup); var before = await Snapshot(setup.Variant);
        Assert.Equal("not_found", (await Assert.ThrowsAsync<BusinessException>(() => Scope(db => V2(db, false).ReadAsync(setup.Request.OwnerId, hold.Id, default)))).Code);
        Assert.Equal("not_found", (await Assert.ThrowsAsync<BusinessException>(() => Tx(db => V2(db, false).HoldAsync(setup.Request, default)))).Code);
        Assert.Equal("not_found", (await Assert.ThrowsAsync<BusinessException>(() => Scope(db => V2(db).ReadAsync("foreign-owner", hold.Id, default)))).Code);
        Assert.Equal(before, await Snapshot(setup.Variant)); await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, hold.Id, "order-inventory-qa", default));
    }

    [Fact]
    public async Task AllocationReleaseRacingTransferCanNeverReleaseOrderHeldStock()
    {
        var setup = await Prepare(false, second: 0, ordinary: 0); var selected = setup.Request.Allocations[0];
        async Task<StockOrderReservationDataV2?> TryHold() { try { return await Hold(setup); } catch (BusinessException e) when (e.Code is "version_conflict" or "sourcing_allocation_transferred_conflict") { return null; } }
        async Task<bool> TryRelease() { try { await Tx(db => new SourcingAllocationService(db, Reservations(db), clock, true).ReleaseAsync("order-inventory-qa", selected.AllocationId, new(Id(), selected.Plan.AcceptanceId, selected.Version, "Explicit synthetic release racing Order2 transfer"), default)); return true; } catch (BusinessException e) when (e.Code is "version_conflict" or "sourcing_allocation_transferred_conflict") { return false; } }
        var holding = TryHold(); var releasing = TryRelease(); await Task.WhenAll(holding, releasing);
        var held = await holding; var released = await releasing; Assert.True((held is not null) != released);
        var stock = await Stock(setup.Variant); Assert.Equal(0, stock.SourcingReserved); Assert.Equal(held is null ? 0 : 2, stock.Reserved); Assert.Equal(2, stock.OnHand);
        Assert.Equal(held is null ? 0 : 1, await Scope(db => db.SourcingAllocationTransfers.CountAsync(t => t.AllocationId == selected.AllocationId)));
        if (held is not null) await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, held.Id, "order-inventory-qa", default));
    }

    private static async Task<int> Session(InventoryDbContext db)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction(); command.CommandText = "SELECT @@SPID"; return Convert.ToInt32(await command.ExecuteScalarAsync());
    }
    private static async Task<bool> ObserveWait(InventoryDbContext blocker, int waiting, int holding)
    {
        var watch = Stopwatch.StartNew(); while (watch.Elapsed < TimeSpan.FromSeconds(8)) {
            await using var command = blocker.Database.GetDbConnection().CreateCommand(); command.Transaction = blocker.Database.CurrentTransaction!.GetDbTransaction(); command.CommandTimeout = 3;
            command.CommandText = "WITH waiting AS (SELECT session_id FROM sys.dm_exec_requests WHERE blocking_session_id=@holding AND database_id=DB_ID() AND wait_type LIKE 'LCK_M_%' UNION ALL SELECT r.session_id FROM sys.dm_exec_requests r JOIN waiting w ON r.blocking_session_id=w.session_id WHERE r.database_id=DB_ID() AND r.wait_type LIKE 'LCK_M_%') SELECT COUNT(*) FROM waiting WHERE session_id=@waiting OPTION(MAXRECURSION 8);";
            var first = command.CreateParameter(); first.ParameterName = "@holding"; first.Value = holding; command.Parameters.Add(first); var second = command.CreateParameter(); second.ParameterName = "@waiting"; second.Value = waiting; command.Parameters.Add(second);
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) > 0) return true; await Task.Delay(25);
        } return false;
    }
    [Fact]
    public async Task DifferentOwnerLegacyAndV2HoldsWaitOnStockWithoutRetainingCrossOwnerIdentityRanges()
    {
        var setup = await Prepare(first: 1, second: 0, ordinary: 2);
        setup = setup with { Request = setup.Request with { Lines = setup.Request.Lines.Select(l => l.AllocationId is null ? l with { Quantity = 1 } : l).ToArray() } };
        var legacyOwner = setup.Request.OwnerId + "-v1"; var legacy = new StockHoldRequest(legacyOwner, Id(), Id(), [new(setup.Variant, 1)], TimeSpan.FromMinutes(10));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var blocker = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); await using var tx = await blocker.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        await blocker.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK,HOLDLOCK) WHERE [VariantId]={setup.Variant}").SingleAsync();
        var holding = await Session(blocker); var v1Started = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously); var v2Started = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var v1 = Tx(async db => { v1Started.SetResult(await Session(db)); return await Reservations(db).HoldAsync(legacy, default); });
        var v2 = Tx(async db => { v2Started.SetResult(await Session(db)); return await V2(db).HoldAsync(setup.Request, default); });
        var sessions = await Task.WhenAll(v1Started.Task, v2Started.Task).WaitAsync(TimeSpan.FromSeconds(10)); bool observedV1, observedV2;
        try { observedV1 = await ObserveWait(blocker, sessions[0], holding); observedV2 = await ObserveWait(blocker, sessions[1], holding); } finally { await tx.CommitAsync(); }
        await Task.WhenAll(v1, v2); var first = await v1; var second = await v2;
        Assert.True(observedV1 && observedV2, "Both exact caller sessions must reach the fixture Stock blocking chain before its lock is released.");
        Assert.Equal(StockReservationState.Active, first.State); Assert.Equal(StockReservationState.Active, second.State); Assert.NotEqual(first.Id, second.Id);
        var stock = await Stock(setup.Variant); Assert.Equal(3, stock.OnHand); Assert.Equal(3, stock.Reserved); Assert.Equal(0, stock.SourcingReserved);
        await Scope(db => Reservations(db).ReleaseAsync(legacyOwner, first.Id, "order-inventory-qa", default)); await Scope(db => V2(db).ReleaseAsync(setup.Request.OwnerId, second.Id, "order-inventory-qa", default));
        stock = await Stock(setup.Variant); Assert.Equal(3, stock.OnHand); Assert.Equal(0, stock.Reserved); Assert.Equal(0, stock.SourcingReserved);
    }
    [Theory][InlineData("stock")][InlineData("allocation")]
    public async Task ObservedSqlWaitCannotTransferAfterTheAbsoluteOrderDeadline(string domain)
    {
        var setup = await Prepare(); var before = await Snapshot(setup.Variant);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var blocker = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); await using var tx = await blocker.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        if (domain == "stock") await blocker.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK,HOLDLOCK) WHERE [VariantId]={setup.Variant}").SingleAsync();
        else { var first = setup.Request.Allocations.OrderBy(a => a.Plan.AcceptanceId, StringComparer.Ordinal).First().AllocationId; await blocker.SourcingAllocations.FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={first}").SingleAsync(); }
        var holding = await Session(blocker); var started = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously); var pending = Tx(async db => { started.SetResult(await Session(db)); return await V2(db).HoldAsync(setup.Request, default); });
        var waiting = await started.Task.WaitAsync(TimeSpan.FromSeconds(10)); bool observed;
        try { observed = await ObserveWait(blocker, waiting, holding); if (observed) clock.Advance(TimeSpan.FromMinutes(11)); } finally { await tx.CommitAsync(); }
        var error = await Assert.ThrowsAsync<BusinessException>(async () => await pending); Assert.True(observed, "Require SQL-observed contention on this exact fixture blocker before advancing the explicit clock."); Assert.Equal("reservation_deadline_conflict", error.Code); Assert.Equal(before, await Snapshot(setup.Variant));
    }
}

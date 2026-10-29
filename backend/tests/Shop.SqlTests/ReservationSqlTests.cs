using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class ReservationSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>, IAsyncLifetime
{
    private sealed class TestClock : TimeProvider
    {
        private long ticks = DateTimeOffset.UtcNow.UtcTicks;
        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref ticks), TimeSpan.Zero);
        public void Advance(TimeSpan by) => Interlocked.Add(ref ticks, by.Ticks);
    }
    private readonly TestClock clock = new();
    private static readonly CancellationToken Ct = CancellationToken.None;
    public async Task InitializeAsync()
    {
        // Each test gets a clean reservation namespace in this class's isolated temporary database.
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
        await db.ReservationEvents.ExecuteDeleteAsync(); await db.ReservationItems.ExecuteDeleteAsync(); await db.Reservations.ExecuteDeleteAsync();
        await db.Stock.ExecuteUpdateAsync(s => s.SetProperty(x => x.Reserved, 0));
    }
    public Task DisposeAsync() => Task.CompletedTask;
    private static string Id() => Guid.NewGuid().ToString("N");
    private StockHoldRequest Request(params StockReservationLine[] lines) => new(Id(), Id(), Id(), lines, TimeSpan.FromMinutes(10));
    private async Task<T> Execute<T>(Func<StockReservationService, Task<T>> run)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        return await run(new(scope.ServiceProvider.GetRequiredService<InventoryDbContext>(), clock));
    }
    private async Task<string> Stock(int quantity)
    {
        var id = "reservation-" + Id(); await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); db.Stock.Add(new() { VariantId = id, OnHand = quantity }); await db.SaveChangesAsync(); return id;
    }
    private async Task AssertStock(string id, int onHand, int reserved)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var stock = await db.Stock.AsNoTracking().SingleAsync(x => x.VariantId == id); Assert.Equal(onHand, stock.OnHand); Assert.Equal(reserved, stock.Reserved);
        Assert.Equal(onHand - reserved, await db.Database.SqlQuery<int>($"SELECT [Available] AS [Value] FROM [inventory].[AvailableStockV1] WHERE [VariantId]={id}").SingleAsync());
    }
    private async Task<string?> HoldFailure(StockHoldRequest request)
    {
        try { await Execute(s => s.HoldAsync(request, Ct)); return null; } catch (BusinessException e) { return e.Code; }
    }

    [Fact] public async Task TwoBuyersCannotReserveTheLastUnit()
    {
        var id = await Stock(1); var first = Request(new StockReservationLine(id, 1)); var second = Request(new StockReservationLine(id, 1));
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<string?> Buy(StockHoldRequest request) { await start.Task; return await HoldFailure(request); }
        var buyers = new[] { Buy(first), Buy(second) }; start.SetResult(); var results = await Task.WhenAll(buyers);
        Assert.Single(results, x => x is null); Assert.Single(results, x => x == "insufficient_stock"); await AssertStock(id, 1, 1);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        Assert.Single(await db.ReservationItems.Where(x => x.VariantId == id).ToListAsync()); Assert.Empty(await db.Movements.Where(x => x.VariantId == id).ToListAsync());
    }

    [Fact] public async Task ConcurrentReplayKeepsIdentityDeadlineAndPayload()
    {
        var id = await Stock(4); var request = Request(new StockReservationLine(id, 2));
        var both = await Task.WhenAll(Execute(s => s.HoldAsync(request, Ct)), Execute(s => s.HoldAsync(request, Ct)));
        Assert.Equal(both[0].Id, both[1].Id); Assert.Equal(both[0].ExpiresAt, both[1].ExpiresAt);
        clock.Advance(TimeSpan.FromMinutes(3)); var replay = await Execute(s => s.HoldAsync(request with { RequestId = Guid.Parse(request.RequestId).ToString("D"), Lines = [new(id.ToUpperInvariant(), 2)] }, Ct));
        Assert.Equal(both[0].Id, replay.Id); Assert.Equal(both[0].ExpiresAt, replay.ExpiresAt); Assert.Equal(both[0].State, replay.State); await AssertStock(id, 4, 2);
        Assert.Equal("idempotency_conflict", await HoldFailure(request with { Lifetime = TimeSpan.FromMinutes(20) }));
        Assert.Equal("idempotency_conflict", await HoldFailure(request with { Lines = [new(id, 1)] }));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        Assert.Equal(1, await db.ReservationEvents.CountAsync(x => x.ReservationId == replay.Id));
    }

    [Fact] public async Task MissingLineRollsBackTheWholeBasketAndDuplicateLinesAreRejected()
    {
        var id = await Stock(3); var unavailable = await Stock(0); var request = Request(new StockReservationLine(id, 2), new(unavailable, 1));
        Assert.Equal("insufficient_stock", await HoldFailure(request)); await AssertStock(id, 3, 0); await AssertStock(unavailable, 0, 0);
        Assert.Equal("invalid_reservation", await HoldFailure(request with { Lines = [new(id, 1), new(id.ToUpperInvariant(), 1)] }));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        Assert.False(await db.Reservations.AnyAsync(x => x.OrderId == request.OrderId));
    }

    [Fact] public async Task ReversedMultiLineRequestsBothCommitWithoutOverselling()
    {
        var a = await Stock(3); var b = await Stock(3);
        var both = await Task.WhenAll(Execute(s => s.HoldAsync(Request(new StockReservationLine(a, 1), new(b, 2)), Ct)), Execute(s => s.HoldAsync(Request(new StockReservationLine(b, 1), new(a, 2)), Ct)));
        Assert.All(both, x => Assert.Equal(StockReservationState.Active, x.State)); await AssertStock(a, 3, 3); await AssertStock(b, 3, 3);
    }

    [Fact] public async Task AllocatedStockSurvivesExpiryAndFulfillmentWritesTheLedgerOnce()
    {
        var id = await Stock(5); var request = Request(new StockReservationLine(id, 2)); var held = await Execute(s => s.HoldAsync(request, Ct));
        var allocated = await Execute(s => s.AllocateAsync(request.OwnerId, held.Id, "verified-payment", Ct)); Assert.Equal(StockReservationState.Allocated, allocated.State);
        clock.Advance(TimeSpan.FromHours(2)); Assert.Equal(0, await Execute(s => s.ExpireBatchAsync(100, Ct))); await AssertStock(id, 5, 2);
        var results = await Task.WhenAll(Execute(s => s.FulfillAsync(request.OwnerId, held.Id, "warehouse", Ct)), Execute(s => s.FulfillAsync(request.OwnerId, held.Id, "warehouse", Ct)));
        Assert.All(results, x => Assert.Equal(StockReservationState.Fulfilled, x.State)); await AssertStock(id, 3, 0);
        var lateAllocation = await Execute(s => s.AllocateAsync(request.OwnerId, held.Id, "verified-payment", Ct)); Assert.Equal(StockReservationState.Fulfilled, lateAllocation.State);
        var failure = await Assert.ThrowsAsync<BusinessException>(() => Execute(s => s.ReleaseAsync(request.OwnerId, held.Id, "cancel", Ct))); Assert.Equal("reservation_state_conflict", failure.Code);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var movement = Assert.Single(await db.Movements.Where(x => x.VariantId == id).ToListAsync()); Assert.Equal(-2, movement.Delta); Assert.Equal(3, movement.Balance); Assert.Equal("warehouse", movement.ActorId);
        Assert.Equal(3, await db.ReservationEvents.CountAsync(x => x.ReservationId == held.Id));
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task CancellationReleasesActiveOrAllocatedStockExactlyOnce(bool allocate)
    {
        var id = await Stock(4); var request = Request(new StockReservationLine(id, 3)); var held = await Execute(s => s.HoldAsync(request, Ct));
        if (allocate) await Execute(s => s.AllocateAsync(request.OwnerId, held.Id, "verified-payment", Ct));
        var released = await Task.WhenAll(Execute(s => s.ReleaseAsync(request.OwnerId, held.Id, "customer-cancel", Ct)), Execute(s => s.ReleaseAsync(request.OwnerId, held.Id, "customer-cancel", Ct)));
        Assert.All(released, x => Assert.Equal(StockReservationState.Released, x.State)); await AssertStock(id, 4, 0);
        var replay = await Execute(s => s.HoldAsync(request, Ct)); Assert.Equal(StockReservationState.Released, replay.State);
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); Assert.Empty(await db.Movements.Where(x => x.VariantId == id).ToListAsync());
    }

    [Fact] public async Task DueHoldCannotBeAllocatedAndCompetingExpiryWorkersReleaseOnce()
    {
        var id = await Stock(4); var request = Request(new StockReservationLine(id, 2)); var held = await Execute(s => s.HoldAsync(request, Ct));
        clock.Advance(TimeSpan.FromMinutes(10)); Assert.Equal(StockReservationState.Expired, (await Execute(s => s.ReadAsync(request.OwnerId, held.Id, Ct))).State);
        var work = await Task.WhenAll(Execute(s => s.ExpireBatchAsync(100, Ct)), Execute(s => s.ExpireBatchAsync(100, Ct)));
        Assert.Equal(1, work.Sum()); await AssertStock(id, 4, 0);
        Assert.Equal(StockReservationState.Expired, (await Execute(s => s.AllocateAsync(request.OwnerId, held.Id, "late-payment", Ct))).State);
        var replay = await Execute(s => s.HoldAsync(request, Ct)); Assert.Equal(held.ExpiresAt, replay.ExpiresAt); Assert.Equal(StockReservationState.Expired, replay.State);
        Assert.Equal("reservation_conflict", await HoldFailure(request with { RequestId = Id() }));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); Assert.Equal(2, await db.ReservationEvents.CountAsync(x => x.ReservationId == held.Id));
    }

    [Fact] public async Task ExpiryAndLatePaymentRaceCannotAllocateDueStock()
    {
        var id = await Stock(1); var request = Request(new StockReservationLine(id, 1)); var held = await Execute(s => s.HoldAsync(request, Ct)); clock.Advance(TimeSpan.FromMinutes(11));
        var allocation = Execute(s => s.AllocateAsync(request.OwnerId, held.Id, "late-payment", Ct)); var expiry = Execute(s => s.ExpireBatchAsync(100, Ct)); await Task.WhenAll(allocation, expiry);
        Assert.Equal(StockReservationState.Expired, (await allocation).State); await AssertStock(id, 1, 0);
    }

    [Fact] public async Task OwnerBoundaryAndStateMachineRejectUnauthorizedOrPrematureChanges()
    {
        var id = await Stock(2); var request = Request(new StockReservationLine(id, 1)); var held = await Execute(s => s.HoldAsync(request, Ct));
        foreach (var operation in new Func<StockReservationService, Task<StockReservationData>>[] {
            s => s.ReadAsync("another-owner", held.Id, Ct), s => s.ReleaseAsync("another-owner", held.Id, "another-owner", Ct), s => s.AllocateAsync("another-owner", held.Id, "another-owner", Ct), s => s.FulfillAsync("another-owner", held.Id, "another-owner", Ct) }) {
            Assert.Equal("not_found", (await Assert.ThrowsAsync<BusinessException>(() => Execute(operation))).Code);
        }
        Assert.Equal("reservation_state_conflict", (await Assert.ThrowsAsync<BusinessException>(() => Execute(s => s.FulfillAsync(request.OwnerId, held.Id, "warehouse", Ct)))).Code);
        await AssertStock(id, 2, 1);
    }

    [Fact] public async Task ParentTransactionOwnsCommitAndEventFailureRollsBackStock()
    {
        var id = await Stock(2); var request = Request(new StockReservationLine(id, 1));
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>(); await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            await new StockReservationService(db, clock).HoldAsync(request, Ct); await transaction.RollbackAsync();
        }
        await AssertStock(id, 2, 0);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope()) {
            var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
            Assert.StartsWith("SaymanTest_", db.Database.GetDbConnection().Database);
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[ReservationEvents] WITH NOCHECK ADD CONSTRAINT [CK_TestReservationEventFailure] CHECK ([State] = 'Impossible')");
            try { await Assert.ThrowsAsync<DbUpdateException>(() => Execute(s => s.HoldAsync(request, Ct))); }
            finally { await db.Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[ReservationEvents] DROP CONSTRAINT [CK_TestReservationEventFailure]"); }
            Assert.False(await db.Reservations.AnyAsync(x => x.OrderId == request.OrderId));
        }
        await AssertStock(id, 2, 0);
        Assert.Equal(StockReservationState.Active, (await Execute(s => s.HoldAsync(request, Ct))).State);
    }

    [Fact] public async Task ManualAdjustmentCannotRemoveReservedUnits()
    {
        var id = await Stock(2); var request = Request(new StockReservationLine(id, 2)); await Execute(s => s.HoldAsync(request, Ct));
        await using var scope = fixture.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
        var stock = await db.Stock.AsNoTracking().SingleAsync(x => x.VariantId == id);
        var failure = await Assert.ThrowsAsync<BusinessException>(() => new InventoryService(db).AdjustAsync(id, new(-1, "Correction", Guid.NewGuid().ToString(), Convert.ToBase64String(stock.Version)), "warehouse", Ct)); Assert.Equal("insufficient_stock", failure.Code);
        await AssertStock(id, 2, 2);
    }
}

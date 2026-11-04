using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
// Isolated GUID fixture only. Stock modes/counts here are synthetic Inventory
// metadata; these tests prove pre-write hold guards, not receiving or dispatch.
public sealed class NewOrderPhysicalCapacitySqlTests(SqlFixture fixture):IClassFixture<SqlFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private async Task<T> Run<T>(Func<InventoryDbContext,Task<T>> action){await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);return await action(db);}
    private async Task<string> Stock(string mode,int quantity)=>await Run(async db=>{var id="capacity-"+Id();db.Stock.Add(new(){VariantId=id,TrackingMode=mode,OnHand=quantity});await db.SaveChangesAsync();return id;});
    private Task<StockReservationData> Hold(StockHoldRequest input,bool bounded)=>Run(db=>bounded?new StockReservationService(db,TimeProvider.System).HoldBoundedAsync(new(input.OwnerId,input.OrderId,input.RequestId,input.Lines,DateTimeOffset.UtcNow.AddMinutes(10)),default):new StockReservationService(db,TimeProvider.System).HoldAsync(input,default));
    private Task<string> State(params string[] ids)=>Run(async db=>{var reservations=await db.ReservationItems.Where(x=>ids.Contains(x.VariantId)).Select(x=>x.ReservationId).ToArrayAsync();return JsonSerializer.Serialize(new{Stock=await db.Stock.AsNoTracking().Where(x=>ids.Contains(x.VariantId)).OrderBy(x=>x.VariantId).ToArrayAsync(),Reservations=await db.Reservations.AsNoTracking().Where(x=>reservations.Contains(x.Id)).OrderBy(x=>x.Id).ToArrayAsync(),Items=await db.ReservationItems.AsNoTracking().Where(x=>reservations.Contains(x.ReservationId)).OrderBy(x=>x.ReservationId).ThenBy(x=>x.VariantId).ToArrayAsync(),Events=await db.ReservationEvents.AsNoTracking().Where(x=>reservations.Contains(x.ReservationId)).OrderBy(x=>x.Id).ToArrayAsync(),Movements=await db.Movements.AsNoTracking().Where(x=>ids.Contains(x.VariantId)).OrderBy(x=>x.Id).ToArrayAsync()});});
    [Theory][InlineData(false)][InlineData(true)]
    public async Task LegacyAndBoundedCreditNewHoldsRejectAggregateOneHundredAndOneBeforeEveryWriteAndPermitSameFailedIdentityAfterCorrection(bool bounded)
    {
        var a=await Stock("serial",60);var b=await Stock("imei",41);var free=await Stock("none",1000000);var input=new StockHoldRequest(Id(),Id(),Id(),[new(a,60),new(b,41),new(free,1000000)],TimeSpan.FromMinutes(10));var before=await State(a,b,free);
        Assert.Equal("fulfillment_order_capacity_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Hold(input,bounded))).Code);Assert.Equal(before,await State(a,b,free));
        await Run(async db=>{Assert.False(await db.Reservations.AnyAsync(x=>x.OrderId==input.OrderId||x.OwnerId==input.OwnerId&&x.RequestId==input.RequestId));return true;});
        var corrected=input with{Lines=[new(a,60),new(b,40),new(free,1000000)]};var hold=await Hold(corrected,bounded);Assert.Equal(1000100,hold.Lines.Sum(x=>x.Quantity));
        await Run(db=>new StockReservationService(db,TimeProvider.System).ReleaseAsync(input.OwnerId,hold.Id,"synthetic-capacity-qa",default));
    }
    [Fact]public async Task ConcurrentValidAndOversizedLegacyRequestsCannotCreateAnUndeliverableReservation()
    {
        var sku=await Stock("serial",201);var valid=new StockHoldRequest(Id(),Id(),Id(),[new(sku,100)],TimeSpan.FromMinutes(10));var invalid=new StockHoldRequest(Id(),Id(),Id(),[new(sku,101)],TimeSpan.FromMinutes(10));
        async Task<string?> Try(StockHoldRequest input){try{await Hold(input,false);return null;}catch(BusinessException e){return e.Code;}}
        var results=await Task.WhenAll(Try(valid),Try(invalid));Assert.Null(results[0]);Assert.Equal("fulfillment_order_capacity_conflict",results[1]);
        await Run(async db=>{var row=await db.Stock.SingleAsync(x=>x.VariantId==sku);Assert.Equal(100,row.Reserved);Assert.Equal(201,row.OnHand);Assert.Single(await db.ReservationItems.Where(x=>x.VariantId==sku).ToArrayAsync());Assert.False(await db.Reservations.AnyAsync(x=>x.OrderId==invalid.OrderId));return true;});
    }
    [Fact]public async Task LegacyPreLimitOversizedHistoryCanStillReadAndReplayWithoutApplyingANewHoldGuard()
    {
        var sku=await Stock("none",101);var input=new StockHoldRequest(Id(),Id(),Id(),[new(sku,101)],TimeSpan.FromMinutes(10));var hold=await Hold(input,false);
        // Inject the equivalent of an already-existing pre-limit tracked hold.
        // Production mode changes remain protected; this is GUID-fixture history.
        await Run(async db=>{await db.Stock.Where(x=>x.VariantId==sku).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.TrackingMode,"serial"));return true;});var before=await State(sku);
        Assert.Equal(hold.Id,(await Hold(input,false)).Id);Assert.Equal(hold.Id,(await Run(db=>new StockReservationService(db,TimeProvider.System).ReadAsync(input.OwnerId,hold.Id,default))).Id);Assert.Equal(before,await State(sku));
    }
}

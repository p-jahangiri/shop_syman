using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed partial class StockOrderReservationV2SqlTests
{
    [Fact]public async Task CombinedAcceptedAndOrdinaryTrackedRightsCannotExceedOneHundredOrConsumeAnyOriginOnFailure()
    {
        var setup=await Prepare(first:60,second:40,ordinary:1);var before=await Snapshot(setup.Variant);
        async Task<string> Try(){return (await Assert.ThrowsAsync<BusinessException>(()=>Hold(setup))).Code;}
        var failures=await Task.WhenAll(Try(),Try());Assert.All(failures,x=>Assert.Equal("fulfillment_order_capacity_conflict",x));Assert.Equal(before,await Snapshot(setup.Variant));
        await Scope(async db=>{Assert.False(await db.Reservations.AnyAsync(x=>x.OrderId==setup.Request.OrderId));Assert.Empty(await db.SourcingAllocationTransfers.Where(x=>setup.Request.Allocations.Select(a=>a.AllocationId).Contains(x.AllocationId)).ToArrayAsync());return true;});
        var corrected=setup with{Request=setup.Request with{Lines=setup.Request.Lines.Where(x=>x.AllocationId is not null).ToArray()}};var hold=await Hold(corrected);Assert.Equal(100,hold.Lines.Sum(x=>x.Quantity));Assert.All(hold.Lines,x=>Assert.Equal("serial",x.TrackingMode));var saved=await Snapshot(setup.Variant);Assert.Equal(JsonSerializer.Serialize(hold),JsonSerializer.Serialize(await Hold(corrected)));Assert.Equal(saved,await Snapshot(setup.Variant));
        await Scope(db=>V2(db).ReleaseAsync(setup.Request.OwnerId,hold.Id,"order-inventory-qa",default));
    }
    [Fact]public async Task TrackedCapacityIsAcrossDistinctSkuModesWhileUntrackedPhysicalCountsKeepExistingBounds()
    {
        var setup=await Prepare(first:60,second:0,ordinary:0);var extra="capacity-other-"+Id();var none="capacity-none-"+Id();await Scope(async db=>{db.Stock.Add(new(){VariantId=extra,TrackingMode="imei",OnHand=41});db.Stock.Add(new(){VariantId=none,TrackingMode="none",OnHand=1000000});await db.SaveChangesAsync();return true;});
        var failed=setup with{Request=setup.Request with{Lines=[..setup.Request.Lines,new(Id(),extra,41),new(Id(),none,1000000)]}};var before=await Snapshot(setup.Variant);var extraBefore=await Stock(extra);Assert.Equal("fulfillment_order_capacity_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Hold(failed))).Code);Assert.Equal(before,await Snapshot(setup.Variant));Assert.Equal(extraBefore.Reserved,(await Stock(extra)).Reserved);Assert.Equal(extraBefore.Version,(await Stock(extra)).Version);
        var corrected=failed with{Request=failed.Request with{Lines=failed.Request.Lines.Select(l=>l.VariantId==extra?l with{Quantity=40}:l).ToArray()}};var hold=await Hold(corrected);Assert.Equal(100,hold.Lines.Where(l=>l.TrackingMode!="none").Sum(l=>l.Quantity));Assert.Equal(1000000,hold.Lines.Single(l=>l.VariantId==none).Quantity);
        await Scope(db=>V2(db).ReleaseAsync(setup.Request.OwnerId,hold.Id,"order-inventory-qa",default));
    }
    [Fact]public async Task OldOversizedVersionTwoReceiptStillReadsAndReplaysWithoutNewCapacityMutation()
    {
        var setup=await Prepare(tracked:false,first:100,second:100,ordinary:0);var hold=await Hold(setup);
        // Equivalent pre-limit history. Do not gate old replay/read or rewrite
        // immutable entitlements; only this generated fixture is injected.
        await Scope(async db=>{await db.Stock.Where(x=>x.VariantId==setup.Variant).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.TrackingMode,"serial"));await db.ReservationLineEntitlements.Where(x=>x.ReservationId==hold.Id).ExecuteUpdateAsync(s=>s.SetProperty(x=>x.TrackingMode,"serial"));return true;});var before=await Snapshot(setup.Variant);
        var replay=await Hold(setup);Assert.Equal(hold.Id,replay.Id);Assert.Equal(200,replay.Lines.Sum(x=>x.Quantity));Assert.Equal(hold.Id,(await Scope(db=>V2(db).ReadAsync(setup.Request.OwnerId,hold.Id,default))).Id);Assert.Equal(before,await Snapshot(setup.Variant));
    }
}

using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Positive custody/concurrency evidence requires real SQL. Never infer it from compilation.
public sealed class SerialInventorySqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private string Path(string variant)=>"/api/admin/inventory/variants/"+variant;
    private async Task<SerialUnitPage> Page(string variant,string? cursor=null,string state="all",string? query=null){using var response=await fixture.Admin.GetAsync(Path(variant)+"/serials?state="+state+(cursor is null?"":"&cursor="+cursor)+(query is null?"":"&query="+Uri.EscapeDataString(query)));Assert.Equal(HttpStatusCode.OK,response.StatusCode);return (await response.Content.ReadFromJsonAsync<SerialUnitPage>())!;}
    private static async Task<SerialCommandResult> Result(HttpResponseMessage response){using(response){Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());return (await response.Content.ReadFromJsonAsync<SerialCommandResult>())!;}}
    private async Task<string> Tracked(string mode="serial"){var item=await fixture.Product(stock:0);var page=await Page(item.Variant);await Result(await fixture.Admin.PutAsJsonAsync(Path(item.Variant)+"/serial-mode",new SerialModeInput(mode,page.Stock.Version,Id())));return item.Variant;}
    private async Task<SerialCommandResult> Receive(string variant,params SerialUnitInput[] rows){var page=await Page(variant);return await Result(await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials",new SerialReceiptInput(rows,"Receipt test",page.Stock.Version,Id())));}
    private async Task<T> InScope<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await action(scope.ServiceProvider);}
    private async Task<StockReservationData> HoldFor(string owner,string order,string variant,int count=1)=>await InScope(sp=>sp.GetRequiredService<IStockReservations>().HoldAsync(new(owner,order,Id(),[new(variant,count)],TimeSpan.FromMinutes(10)),default));
    private async Task Assign(string owner,StockReservationData hold,StockSerialPick[] picks,string? request=null)=>await InScope(async sp=>{await sp.GetRequiredService<IStockSerialAssignments>().AssignAsync(new(owner,hold.Id,"serial-test",request??Id(),picks),default);return true;});

    [Fact] public async Task NativeReceiptAndRetirementReplayExactlyWithoutDuplicateStockLedgerOrAliases()
    {
        var variant=await Tracked();var page=await Page(variant);var input=new SerialReceiptInput([new(" case-۱۲۳ ")],"Receipt test",page.Stock.Version,Id());var first=await Result(await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials",input));var replay=await Result(await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials",input));Assert.Equal(System.Text.Json.JsonSerializer.Serialize(first),System.Text.Json.JsonSerializer.Serialize(replay));Assert.Equal("CASE-123",Assert.Single(first.Units).Serial);
        using var changed=await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials",input with{Reason="Different reason"});Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);Assert.Contains("idempotency_conflict",await changed.Content.ReadAsStringAsync());var unit=first.Units[0];var retire=new SerialRetireInput(unit.Version,"Retirement test",first.Stock.Version,Id());await Result(await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials/"+unit.Id+"/retire",retire));await Result(await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials/"+unit.Id+"/retire",retire));
        using var historyResponse=await fixture.Admin.GetAsync(Path(variant)+"/serials/"+unit.Id+"/history");Assert.Equal(HttpStatusCode.OK,historyResponse.StatusCode);var history=(await historyResponse.Content.ReadFromJsonAsync<SerialHistoryPage>())!;Assert.Equal(new[]{"retired","available"},history.Items.Select(e=>e.State));Assert.Null(history.NextBefore);
        await InScope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();Assert.Equal(0,(await db.Stock.SingleAsync(s=>s.VariantId==variant)).OnHand);Assert.Equal("retired",(await db.SerialUnits.SingleAsync(u=>u.VariantId==variant)).State);Assert.Equal(1,await db.SerialIdentifiers.CountAsync(a=>a.UnitId==unit.Id));Assert.Equal(2,await db.Movements.CountAsync(m=>m.VariantId==variant));Assert.Equal(2,await db.SerialEvents.CountAsync(e=>e.UnitId==unit.Id));return true;});
    }
    [Fact] public async Task DualImeiCountsAsOneDeviceAndCannotBeReusedAcrossVariantsOrSlots()
    {
        var one=await Tracked("imei");var two=await Tracked("imei");var received=await Receive(one,new SerialUnitInput("device","490154203237518","356938035643809"));Assert.Equal(1,received.Stock.OnHand);var second=await Page(two);using var conflict=await fixture.Admin.PostAsJsonAsync(Path(two)+"/serials",new SerialReceiptInput([new(null,"356938035643809")],"Duplicate test",second.Stock.Version,Id()));Assert.Equal(HttpStatusCode.Conflict,conflict.StatusCode);Assert.Contains("serial_identifier_conflict",await conflict.Content.ReadAsStringAsync());Assert.Equal(0,(await Page(two)).Stock.OnHand);await InScope(async sp=>{Assert.Equal(3,await sp.GetRequiredService<InventoryDbContext>().SerialIdentifiers.CountAsync(a=>a.UnitId==received.Units[0].Id));return true;});
    }
    [Fact] public async Task ModeChangesRequireEmptyStockAndDigitalOrCountOnlyWritesCannotBypassTracking()
    {
        var nonempty=await fixture.Product(stock:2);var page=await Page(nonempty.Variant);using var rejected=await fixture.Admin.PutAsJsonAsync(Path(nonempty.Variant)+"/serial-mode",new SerialModeInput("serial",page.Stock.Version,Id()));Assert.Equal(HttpStatusCode.Conflict,rejected.StatusCode);Assert.Equal("none",(await Page(nonempty.Variant)).Stock.Mode);
        var digital=await fixture.Product(stock:0,digital:true);using var denied=await fixture.Admin.PutAsJsonAsync(Path(digital.Variant)+"/serial-mode",new SerialModeInput("imei",(await Page(digital.Variant)).Stock.Version,Id()));Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);Assert.Contains("serial_digital_conflict",await denied.Content.ReadAsStringAsync());
        var tracked=await Tracked();using var adjustment=await fixture.Admin.PostAsJsonAsync("/api/admin/inventory/"+tracked+"/adjust",new StockAdjustment(1,"Count bypass test",Id(),(await Page(tracked)).Stock.Version));Assert.Equal(HttpStatusCode.BadRequest,adjustment.StatusCode);Assert.Contains("serial_tracking_required",await adjustment.Content.ReadAsStringAsync());
        var product=await InScope(async sp=>await sp.GetRequiredService<CatalogDbContext>().Products.AsNoTracking().SingleAsync(p=>p.Variants.Any(v=>v.Id==tracked)));using var conversion=await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+product.Id,new ProductInput(product.CategoryId,product.BrandId,product.Slug,"Published",true,false,[new("fa","دیجیتال آزمون"),new("en","Digital test")],[],[],[],[],[],Convert.ToBase64String(product.Version)));Assert.Equal(HttpStatusCode.Conflict,conversion.StatusCode);Assert.Contains("serial_digital_conflict",await conversion.Content.ReadAsStringAsync());
    }
    [Fact] public async Task AuditFailureRollsBackUnitsAliasesLedgerCommandAndStockVersionTogether()
    {
        var variant=await Tracked();var before=await Page(variant);var input=new SerialReceiptInput([new("rollback-unit")],"Rollback receipt",before.Stock.Version,Id());await InScope(async sp=>{var db=sp.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_SerialAuditFailure] CHECK (1=0);");return true;});
        try{using var failed=await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials",input);Assert.Equal(HttpStatusCode.Conflict,failed.StatusCode);}finally{await InScope(async sp=>{await sp.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_SerialAuditFailure];");return true;});}
        var after=await Page(variant);Assert.Equal(before.Stock,after.Stock);Assert.Empty(after.Items);await InScope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();Assert.False(await db.Movements.AnyAsync(m=>m.VariantId==variant));Assert.False(await db.SerialCommands.AnyAsync(c=>c.RequestId==input.RequestId));return true;});await Result(await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials",input));
    }
    [Fact] public async Task AllocationAssignmentReleaseAndFulfillmentKeepPhysicalCustodyAndExactQuantities()
    {
        var variant=await Tracked();var received=await Receive(variant,new SerialUnitInput("first"),new("second"));var owner=Id();var hold=await HoldFor(owner,Id(),variant,2);var picks=received.Units.Select(u=>new StockSerialPick(u.Id,u.Version)).ToArray();Assert.Equal("serial_state_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>Assign(owner,hold,picks))).Code);
        await InScope(sp=>sp.GetRequiredService<IStockReservations>().AllocateAsync(owner,hold.Id,"serial-test",default));Assert.Equal("serial_assignment_required",(await Assert.ThrowsAsync<BusinessException>(()=>InScope(sp=>sp.GetRequiredService<IStockReservations>().FulfillAsync(owner,hold.Id,"serial-test",default)))).Code);var request=Id();await Assign(owner,hold,picks,request);await Assign(owner,hold,picks,request);await InScope(sp=>sp.GetRequiredService<IStockReservations>().ReleaseAsync(owner,hold.Id,"serial-test",default));var released=await Page(variant);Assert.All(released.Items,u=>{Assert.Equal("available",u.State);Assert.Null(u.OrderId);Assert.Null(u.WarrantyUntil);});
        var next=await HoldFor(owner,Id(),variant,2);await InScope(sp=>sp.GetRequiredService<IStockReservations>().AllocateAsync(owner,next.Id,"serial-test",default));var until=DateTimeOffset.UtcNow.AddYears(1);await Assign(owner,next,released.Items.Select((u,i)=>new StockSerialPick(u.Id,u.Version,i==0?until:null)).ToArray());await InScope(sp=>sp.GetRequiredService<IStockReservations>().FulfillAsync(owner,next.Id,"serial-test",default));await InScope(sp=>sp.GetRequiredService<IStockReservations>().FulfillAsync(owner,next.Id,"serial-test",default));var delivered=await Page(variant);Assert.Equal(0,delivered.Stock.OnHand);Assert.Equal(0,delivered.Stock.Reserved);Assert.All(delivered.Items,u=>{Assert.Equal("delivered",u.State);Assert.Equal(next.OrderId,u.OrderId);Assert.Equal(next.Id,u.ReservationId);});Assert.Single(delivered.Items,u=>u.WarrantyUntil==until);Assert.Single(delivered.Items,u=>u.WarrantyUntil is null);
    }
    [Fact] public async Task ConcurrentOrdersCannotAssignTheSamePhysicalUnitTwice()
    {
        var variant=await Tracked();var receipt=await Receive(variant,new SerialUnitInput("race-first"),new("race-second"));var owner1=Id();var owner2=Id();var first=await HoldFor(owner1,Id(),variant);var second=await HoldFor(owner2,Id(),variant);await InScope(sp=>sp.GetRequiredService<IStockReservations>().AllocateAsync(owner1,first.Id,"serial-test",default));await InScope(sp=>sp.GetRequiredService<IStockReservations>().AllocateAsync(owner2,second.Id,"serial-test",default));var unit=receipt.Units[0];
        async Task<bool> Try(string owner,StockReservationData hold){try{await Assign(owner,hold,[new(unit.Id,unit.Version)]);return true;}catch(BusinessException e)when(e.Code is "version_conflict" or "serial_state_conflict"){return false;}}
        var results=await Task.WhenAll(Try(owner1,first),Try(owner2,second));Assert.Single(results,r=>r);var page=await Page(variant);Assert.Single(page.Items,u=>u.State=="assigned");Assert.Single(page.Items,u=>u.State=="available");Assert.Equal(2,page.Stock.Reserved);
    }
    [Fact] public async Task RetirementCannotRemoveQuantityHeldByAnUnassignedReservation()
    {
        var variant=await Tracked();var receipt=await Receive(variant,new SerialUnitInput("held"));var owner=Id();var hold=await HoldFor(owner,Id(),variant);var page=await Page(variant);var input=new SerialRetireInput(receipt.Units[0].Version,"Held retirement test",page.Stock.Version,Id());using var denied=await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials/"+receipt.Units[0].Id+"/retire",input);Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);Assert.Equal(1,(await Page(variant)).Stock.OnHand);await InScope(sp=>sp.GetRequiredService<IStockReservations>().ReleaseAsync(owner,hold.Id,"serial-test",default));await Result(await fixture.Admin.PostAsJsonAsync(Path(variant)+"/serials/"+receipt.Units[0].Id+"/retire",input with{Version=(await Page(variant)).Stock.Version}));
    }
    [Fact] public async Task NativeSeekPagingAndCanonicalSearchCoverAllUnitsWithoutRepeatingARecord()
    {
        var variant=await Tracked();await Receive(variant,Enumerable.Range(0,53).Select(i=>new SerialUnitInput("unit-"+i.ToString("D3"))).ToArray());var first=await Page(variant);Assert.Equal(50,first.Items.Length);Assert.NotNull(first.NextCursor);var second=await Page(variant,first.NextCursor);Assert.Equal(3,second.Items.Length);Assert.Null(second.NextCursor);Assert.Equal(53,first.Items.Concat(second.Items).Select(u=>u.Id).Distinct().Count());Assert.Equal(10,(await Page(variant,query:"unit-۰۰")).Items.Length);using var invalid=await fixture.Admin.GetAsync(Path(variant)+"/serials?state=retired&cursor="+first.NextCursor);Assert.Equal(HttpStatusCode.BadRequest,invalid.StatusCode);
    }
    [Fact] public async Task CallerTransactionOwnsSerialCommitAndRollbackPreservesTheSameRequestForRetry()
    {
        var variant=await Tracked();var before=await Page(variant);var input=new SerialReceiptInput([new("parent-rollback")],"Parent transaction test",before.Stock.Version,Id());await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();await using var parent=await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);await scope.ServiceProvider.GetRequiredService<SerialInventoryService>().ReceiveAsync(variant,false,input,"serial-test",default);Assert.Same(parent,db.Database.CurrentTransaction);Assert.Equal(1,await db.SerialUnits.CountAsync(u=>u.VariantId==variant));await parent.RollbackAsync();}
        Assert.Equal(before.Stock,(await Page(variant)).Stock);await InScope(async sp=>{Assert.False(await sp.GetRequiredService<InventoryDbContext>().SerialCommands.AnyAsync(c=>c.RequestId==input.RequestId));return true;});await InScope(async sp=>{var row=await sp.GetRequiredService<SerialInventoryService>().ReceiveAsync(variant,false,input,"serial-test",default);Assert.Equal(1,row.Stock.OnHand);return true;});
    }
}

using System.Data;
using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// HTTP reads use real JWT/MFA policies and the fixture-owned GUID SQL database.
// Trusted allocation plans below exercise Inventory only, not Market consent.
public sealed class SerialInventoryV2SqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static readonly string Hash=new('A',64);
    private const string V="AAAAAAAAAAA=";
    private sealed class Clock:TimeProvider
    {
        private long ticks=DateTimeOffset.UtcNow.UtcTicks;
        public override DateTimeOffset GetUtcNow()=>new(Interlocked.Read(ref ticks),TimeSpan.Zero);
        public void Advance(TimeSpan by)=>Interlocked.Add(ref ticks,by.Ticks);
    }
    private readonly Clock clock=new();
    private sealed record Core(InventoryDbContext Db,StockReservationService Holds,SerialInventoryService Serials,SourcingAllocationService Allocations);
    private Core Services(IServiceProvider sp){var db=sp.GetRequiredService<InventoryDbContext>();var holds=new StockReservationService(db,clock);return new(db,holds,new(db,holds,clock),new(db,holds,clock,true));}
    private async Task<T> Scope<T>(Func<IServiceProvider,Task<T>> action){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await action(scope.ServiceProvider);}
    private async Task<T> Tx<T>(Func<Core,Task<T>> action){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var c=Services(scope.ServiceProvider);Assert.StartsWith("SaymanTest_",c.Db.Database.GetDbConnection().Database);await using var transaction=await c.Db.Database.BeginTransactionAsync(IsolationLevel.Serializable);var result=await action(c);await transaction.CommitAsync();return result;}
    private static string Path(string variant)=>"/api/admin/inventory/variants/"+variant+"/serials";
    private async Task<SerialUnitPageV2> Page(HttpClient client,string variant,string state="all",string? cursor=null,string? query=null,string? capture=null)
    {
        var route=Path(variant)+"/v2?state="+state+(cursor is null?"":"&cursor="+Uri.EscapeDataString(cursor))+(query is null?"":"&query="+Uri.EscapeDataString(query));using var response=await client.GetAsync(route);var raw=await response.Content.ReadAsStringAsync();Assert.True(response.StatusCode==HttpStatusCode.OK,$"HTTP {(int)response.StatusCode}: {raw}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());if(capture is not null&&Environment.GetEnvironmentVariable("SHOP_SERIAL_V2_WIRE_DIR") is {Length:>0} directory){Directory.CreateDirectory(directory);await File.WriteAllTextAsync(System.IO.Path.Combine(directory,capture+".json"),raw);}return JsonSerializer.Deserialize<SerialUnitPageV2>(raw,new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }
    private Task<string> Variant(int onHand=0)=>Scope(async sp=>{var catalog=sp.GetRequiredService<CatalogDbContext>();var product=await catalog.Products.Where(p=>p.Status=="Published"&&!p.IsDigital).OrderBy(p=>p.Id).Select(p=>p.Id).FirstAsync();var variant=new ProductVariant{ProductId=product,Sku="QA-SERIALV2-"+Id(),PriceRial=101,LabelFa="پیکربندی نمونه",LabelEn="Synthetic configuration"};catalog.Variants.Add(variant);await catalog.SaveChangesAsync();var db=sp.GetRequiredService<InventoryDbContext>();db.Stock.Add(new(){VariantId=variant.Id,OnHand=onHand});await db.SaveChangesAsync();return variant.Id;});
    private Task<StockItem> Stock(string variant)=>Scope(sp=>sp.GetRequiredService<InventoryDbContext>().Stock.AsNoTracking().SingleAsync(s=>s.VariantId==variant));
    private async Task<SerialCommandResult> Receipt(string variant,int count)
    {
        var stock=await Stock(variant);return await Tx(c=>c.Serials.ReceiveAsync(variant,false,new(Enumerable.Range(0,count).Select(_=>new SerialUnitInput("QA-"+Id())).ToArray(),"Synthetic V2 serial receipt",Convert.ToBase64String(stock.Version),Id()),"qa-serial-v2",default));
    }
    private async Task<(string Variant,SerialUnitData[] Units)> Tracked(int count=3)
    {
        var variant=await Variant();var stock=await Stock(variant);await Tx(c=>c.Serials.ConfigureAsync(variant,false,new("serial",Convert.ToBase64String(stock.Version),Id()),"qa-serial-v2",default));return(variant,(await Receipt(variant,count)).Units);
    }
    private async Task<SourcingAllocationMutation> Hold(string variant,SerialUnitData[] picks,int quantity=1,DateTimeOffset? expires=null)
    {
        var plan=new SourcingStockAllocationPlan(Id(),Id(),Id(),Id(),"owner-"+Id(),Hash,clock.GetUtcNow().AddHours(2),false,[new(Id(),variant,"model",quantity,Hash)]);var stock=await Stock(variant);var input=new SourcingAllocationInput(Id(),V,V,V,plan.AcceptanceId,plan.TermsHash,expires??clock.GetUtcNow().AddHours(1),"PRIVATE sourcing claim QA",[new(plan.Lines[0].OfferLineId,Convert.ToBase64String(stock.Version),stock.TrackingMode,picks.Select(u=>new SourcingAllocationUnitInput(u.Id,u.Version)).ToArray())]);return await Tx(c=>c.Allocations.AllocateAsync("qa-allocator",Id(),plan,input,default));
    }
    private Task<SourcingAllocationMutation> Release(SourcingAllocationMutation allocation)=>Tx(c=>c.Allocations.ReleaseAsync("qa-allocator",allocation.AllocationId,new(Id(),allocation.AcceptanceId,allocation.Version,"Explicit QA release"),default));
    private sealed class BeforeProjection(string kind,Func<Task> change):DbCommandInterceptor
    {
        private int claims,stocks,triggered;
        public bool Triggered=>Volatile.Read(ref triggered)==1;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken ct=default)
        {
            var sql=command.CommandText;var match=kind switch{
                "stock"=>sql.Contains("[inventory].[Stock]",StringComparison.Ordinal)&&Interlocked.Increment(ref stocks)==2,
                "unit"=>sql.Contains("[inventory].[SerialUnits]",StringComparison.Ordinal)&&!sql.Contains("[Serial]",StringComparison.Ordinal)&&sql.Contains("[Version]",StringComparison.Ordinal),
                "claim"=>sql.Contains("[inventory].[SerialUnitClaims]",StringComparison.Ordinal)&&!sql.Contains("[inventory].[SerialUnits]",StringComparison.Ordinal)&&Interlocked.Increment(ref claims)==2,
                _=>false};if(match&&Interlocked.CompareExchange(ref triggered,1,0)==0)await change();return result;
        }
    }

    [Fact] public async Task ActualHttpPageShowsSourceHeldUnitsHonestlyAndCapturesAllAvailableAndReleasedWire()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var tracked=await Tracked();var allocation=await Hold(tracked.Variant,[tracked.Units[0]]);var all=await Page(inventory,tracked.Variant,capture:"serial-v2-all");Assert.Equal(2,all.SchemaVersion);Assert.Equal(3,all.Stock.OnHand);Assert.Equal(0,all.Stock.Reserved);Assert.Equal(1,all.Stock.SourcingReserved);Assert.Equal(2,all.Stock.Available);Assert.Equal(3,all.Items.Length);var held=Assert.Single(all.Items,u=>u.HasActiveClaim);Assert.Equal(tracked.Units[0].Id,held.Unit.Id);Assert.Equal("available",held.Unit.State);Assert.Null(held.Unit.OrderId);
        var available=await Page(inventory,tracked.Variant,"available",capture:"serial-v2-available");Assert.Equal(2,available.Items.Length);Assert.All(available.Items,u=>{Assert.False(u.HasActiveClaim);Assert.Equal("available",u.Unit.State);});Assert.DoesNotContain(available.Items,u=>u.Unit.Id==held.Unit.Id);using(var legacy=await inventory.GetAsync(Path(tracked.Variant))){Assert.Equal(HttpStatusCode.Conflict,legacy.StatusCode);Assert.Contains("serial_contract_upgrade_required",await legacy.Content.ReadAsStringAsync());}
        await Release(allocation);var free=await Page(inventory,tracked.Variant,capture:"serial-v2-claim-free");Assert.Equal(0,free.Stock.SourcingReserved);Assert.Equal(3,free.Stock.Available);Assert.All(free.Items,u=>Assert.False(u.HasActiveClaim));using var legacyFree=await inventory.GetAsync(Path(tracked.Variant));Assert.Equal(HttpStatusCode.OK,legacyFree.StatusCode);
    }
    [Fact] public async Task CountOnlySourceHoldHasActualAvailabilityAndVersionOneReadFailsClosedWithoutSerialClaims()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var variant=await Variant(5);await Hold(variant,[],2);var page=await Page(inventory,variant);Assert.Empty(page.Items);Assert.Equal("none",page.Stock.Mode);Assert.Equal(2,page.Stock.SourcingReserved);Assert.Equal(3,page.Stock.Available);using var legacy=await inventory.GetAsync(Path(variant));Assert.Equal(HttpStatusCode.Conflict,legacy.StatusCode);Assert.Contains("serial_contract_upgrade_required",await legacy.Content.ReadAsStringAsync());
    }
    [Fact] public async Task LegacyReceiptReplayAndHistoryRemainVersionOneWhileClaimedRetirementStillFailsClosed()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var tracked=await Tracked();await Hold(tracked.Variant,[tracked.Units[0]]);var before=await Page(inventory,tracked.Variant);var input=new SerialReceiptInput([new("QA-"+Id())],"Synthetic receipt while sourcing-held",before.Stock.Version,Id());using var first=await inventory.PostAsJsonAsync(Path(tracked.Variant),input);Assert.Equal(HttpStatusCode.OK,first.StatusCode);var raw=await first.Content.ReadAsStringAsync();using var replay=await inventory.PostAsJsonAsync(Path(tracked.Variant),input);Assert.Equal(HttpStatusCode.OK,replay.StatusCode);Assert.Equal(raw,await replay.Content.ReadAsStringAsync());using(var legacy=JsonDocument.Parse(raw)){Assert.Equal(1,legacy.RootElement.GetProperty("schemaVersion").GetInt32());Assert.False(legacy.RootElement.GetProperty("stock").TryGetProperty("sourcingReserved",out _));}
        var after=await Page(inventory,tracked.Variant);Assert.Equal(4,after.Stock.OnHand);Assert.Equal(1,after.Stock.SourcingReserved);Assert.Equal(3,after.Stock.Available);using var rejected=await inventory.PostAsJsonAsync(Path(tracked.Variant)+"/"+tracked.Units[0].Id+"/retire",new SerialRetireInput(tracked.Units[0].Version,"Must not retire another entitlement",after.Stock.Version,Id()));Assert.Equal(HttpStatusCode.Conflict,rejected.StatusCode);Assert.Contains("serial_state_conflict",await rejected.Content.ReadAsStringAsync());using var history=await inventory.GetAsync(Path(tracked.Variant)+"/"+tracked.Units[0].Id+"/history");Assert.Equal(HttpStatusCode.OK,history.StatusCode);Assert.Equal(1,(await history.Content.ReadFromJsonAsync<SerialHistoryPage>())!.SchemaVersion);Assert.Equal(4,(await Page(inventory,tracked.Variant)).Stock.OnHand);
    }
    [Fact] public async Task ExpiredUnreleasedClaimRemainsProtectedAndHiddenFromAvailableUntilAtomicRelease()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var tracked=await Tracked(1);var allocation=await Hold(tracked.Variant,tracked.Units,expires:clock.GetUtcNow().AddMinutes(1));clock.Advance(TimeSpan.FromMinutes(1));Assert.Equal("Expired",(await Scope(sp=>Services(sp).Allocations.ReadAsync(allocation.AllocationId,null,default))).EffectiveState);var all=await Page(inventory,tracked.Variant);Assert.True(Assert.Single(all.Items).HasActiveClaim);Assert.Equal(0,all.Stock.Available);Assert.Empty((await Page(inventory,tracked.Variant,"available")).Items);await Release(allocation);Assert.False(Assert.Single((await Page(inventory,tracked.Variant,"available")).Items).HasActiveClaim);
    }
    [Fact] public async Task KeysetPagingUsesFiftyPlusOneSearchBindingAndFreshStockVersion()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var tracked=await Tracked(53);var first=await Page(inventory,tracked.Variant);Assert.Equal(50,first.Items.Length);Assert.NotNull(first.NextCursor);var last=await Page(inventory,tracked.Variant,cursor:first.NextCursor);Assert.Equal(3,last.Items.Length);Assert.Null(last.NextCursor);Assert.Equal(53,first.Items.Concat(last.Items).Select(u=>u.Unit.Id).Distinct().Count());using(var foreign=await inventory.GetAsync(Path(tracked.Variant)+"/v2?state=available&cursor="+Uri.EscapeDataString(first.NextCursor!)))Assert.Equal(HttpStatusCode.BadRequest,foreign.StatusCode);var search=tracked.Units[0].Serial!;Assert.Single((await Page(inventory,tracked.Variant,query:search)).Items);await Receipt(tracked.Variant,1);using var stale=await inventory.GetAsync(Path(tracked.Variant)+"/v2?cursor="+Uri.EscapeDataString(first.NextCursor!));Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);Assert.Contains("version_conflict",await stale.Content.ReadAsStringAsync());
    }
    [Fact] public async Task AvailableFilterPaginatesOnlyUnclaimedUnitsAndKeepsAggregateOrderReservationSeparate()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var tracked=await Tracked(53);await Hold(tracked.Variant,[tracked.Units[0]]);var owner=Id();await Scope(sp=>Services(sp).Holds.HoldAsync(new(owner,Id(),Id(),[new(tracked.Variant,1)],TimeSpan.FromMinutes(10)),default));var first=await Page(inventory,tracked.Variant,"available");Assert.Equal(50,first.Items.Length);Assert.Equal(51,first.Stock.Available);Assert.Equal(1,first.Stock.Reserved);Assert.Equal(1,first.Stock.SourcingReserved);var last=await Page(inventory,tracked.Variant,"available",first.NextCursor);Assert.Equal(2,last.Items.Length);Assert.Equal(52,first.Items.Concat(last.Items).Select(u=>u.Unit.Id).Distinct().Count());Assert.All(first.Items.Concat(last.Items),u=>Assert.False(u.HasActiveClaim));
    }
    [Fact] public async Task AbsentStockKeepsExplicitNullVersionAndEmptyVersionTwoShape()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var variant=await Variant();await Scope(async sp=>{await sp.GetRequiredService<InventoryDbContext>().Stock.Where(s=>s.VariantId==variant).ExecuteDeleteAsync();return true;});var page=await Page(inventory,variant);Assert.Null(page.Stock.Version);Assert.Equal("none",page.Stock.Mode);Assert.Equal(0,page.Stock.Available);Assert.Equal(0,page.Stock.SourcingReserved);Assert.Empty(page.Items);Assert.Null(page.NextCursor);
    }
    [Fact] public async Task HttpAuthorizationAndWireNeverExposeClaimOriginCustomerOrAcceptedPrice()
    {
        using var inventory=await fixture.ReuseStaff("InventoryManager");var tracked=await Tracked(1);await Hold(tracked.Variant,tracked.Units);using var anonymous=fixture.Sql.Factory.CreateClient();using var denied=await fixture.Content.GetAsync(Path(tracked.Variant)+"/v2");Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);using var unknown=await anonymous.GetAsync(Path(tracked.Variant)+"/v2");Assert.Equal(HttpStatusCode.Unauthorized,unknown.StatusCode);var json=JsonSerializer.Serialize(await Page(inventory,tracked.Variant),new JsonSerializerOptions(JsonSerializerDefaults.Web));foreach(var field in new[]{"ownerId","allocationId","originAllocationId","offerLineId","priceRial","unitPriceRial","sourceKey","termsHash","reason"})Assert.DoesNotContain("\""+field+"\":",json);
    }
    [Theory][InlineData("stock")][InlineData("unit")][InlineData("claim")]
    public async Task BoundedFinalProjectionRejectsDeterministicStockUnitOrClaimDrift(string kind)
    {
        var tracked=await Tracked();StockReservationData? reservation=null;var owner=Id();if(kind=="claim")await Hold(tracked.Variant,[tracked.Units[0]]);if(kind=="unit"){reservation=await Scope(sp=>Services(sp).Holds.HoldAsync(new(owner,Id(),Id(),[new(tracked.Variant,1)],TimeSpan.FromMinutes(10)),default));await Scope(sp=>Services(sp).Holds.AllocateAsync(owner,reservation.Id,"verified-QA-payment",default));}
        var interceptor=new BeforeProjection(kind,async()=>{if(kind=="stock")await Receipt(tracked.Variant,1);else if(kind=="unit")await Scope(async sp=>{await Services(sp).Serials.AssignAsync(new(owner,reservation!.Id,"qa-assignment",Id(),[new(tracked.Units[0].Id,tracked.Units[0].Version)]),default);return true;});else await Scope(async sp=>{var db=sp.GetRequiredService<InventoryDbContext>();var claim=await db.SerialUnitClaims.SingleAsync(c=>c.UnitId==tracked.Units[0].Id&&c.IsActive);claim.ChangedAt=claim.ChangedAt.AddTicks(1);await db.SaveChangesAsync();return true;});});var options=new DbContextOptionsBuilder<InventoryDbContext>().UseSqlServer(fixture.Sql.Connection).AddInterceptors(interceptor).Options;await using var db=new InventoryDbContext(options);Assert.Equal("version_conflict",(await Assert.ThrowsAsync<BusinessException>(()=>new SerialInventoryV2Reader(db).PageAsync(SerialPageQuery.Create(tracked.Variant,"all",null),null,default))).Code);Assert.True(interceptor.Triggered,"The test mutation must run at the named bounded final projection.");
    }
}

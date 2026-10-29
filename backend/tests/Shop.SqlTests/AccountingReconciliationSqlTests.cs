using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class AccountingReconciliationSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private const string Base="/api/admin/accounting/holoo";
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static AccountingWarehouseInput Warehouse(string company,bool active=false,string? version=null)=>new(Id(),company,"000-WH","انبار مصنوعی","Synthetic warehouse",active,active,version);
    private async Task<HttpClient> Inventory()=>await fixture.ReuseStaff("InventoryManager");
    private static Task<JsonNode> Json(HttpResponseMessage r)=>MarketFixture.Json(r);
    private async Task<JsonNode> PutWarehouse(string id,AccountingWarehouseInput input){using var client=await Inventory();return await Json(await client.PutAsJsonAsync(Base+"/warehouses/"+id,input));}
    private async Task<JsonNode> Read(string path){using var client=await Inventory();return await Json(await client.GetAsync(Base+path));}
    private async Task Deactivate(string id){var current=await Read("/warehouses/"+id);await PutWarehouse(id,new(Id(),current["companyKey"]!.GetValue<string>(),current["externalWarehouseKey"]!.GetValue<string>(),current["nameFa"]!.GetValue<string>(),current["nameEn"]!.GetValue<string>(),false,false,current["version"]!.GetValue<string>()));}
    private sealed record Setup(string Company,string Variant,string Batch,string Mapping,DateTimeOffset Observed);
    private async Task<Setup> Prepare(string quantity="1.5",int numerator=2,int denominator=1,string meaning="physical",int onHand=6,int reserved=2,int sourcing=1,string tracking="none",bool single=false)
    {
        var company="QA-"+Id();var variant="qa-"+Id();var batch=Id();var mapping=Id();var observed=DateTimeOffset.UtcNow.AddSeconds(-10);
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var cat=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();cat.Variants.Add(new ProductVariant{Id=variant,ProductId="p1",Sku="QA-"+Id(),IsActive=true,PriceRial=9007199254740993});await cat.SaveChangesAsync();
            var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();db.Stock.Add(new(){VariantId=variant,OnHand=onHand,Reserved=reserved,SourcingReserved=sourcing,TrackingMode=tracking,IsSingleUnit=single});db.Movements.Add(new(){VariantId=variant,Delta=onHand,Balance=onHand,ActorId="synthetic-qa",RequestId=Id(),Reason="Synthetic test baseline",At=observed.AddSeconds(-1)});await db.SaveChangesAsync();
        }
        await Json(await fixture.Writer.PutAsJsonAsync(Base+"/links/"+Id(),new AccountingProductLinkInput(company,"000-item",null,variant,true,null)));
        using(var client=await Inventory())await Json(await client.PutAsJsonAsync("/api/admin/inventory/receiving-unit-mappings/"+mapping,new ReceivingUnitMappingInput(Id(),"holoo",company,"000-WH","BOX",variant,numerator,denominator,"بسته نمونه","Sample box",true,null)));
        await Json(await fixture.Writer.PutAsJsonAsync(Base+"/imports/"+batch,new AccountingImportInput(1,company,"000-WH",meaning,"unknown",observed,true,[new("000-item",null,"مصنوعی","BOX",quantity,null)])));
        return new(company,variant,batch,mapping,observed);
    }
    private async Task<string> BusinessState(string variant){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var cat=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();return JsonSerializer.Serialize(new{Stock=await db.Stock.AsNoTracking().SingleAsync(x=>x.VariantId==variant),Movements=await db.Movements.CountAsync(x=>x.VariantId==variant),Variant=await cat.Variants.AsNoTracking().SingleAsync(x=>x.Id==variant)});}
    private static string[] Issues(JsonNode row)=>row["issues"]!.AsArray().Select(x=>x!.GetValue<string>()).ToArray();
    [Fact] public async Task WarehouseReplayIsActorBoundAndDoesNotFollowLaterEdits()
    {
        var id=Id();var input=Warehouse("QA-"+Id());var first=await PutWarehouse(id,input);Assert.False(first["replayed"]!.GetValue<bool>());var version=first["warehouse"]!["version"]!.GetValue<string>();
        await PutWarehouse(id,input with{CommandId=Id(),NameFa="نام تازه",Version=version});var replay=await PutWarehouse(id,input);Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(first["warehouse"]!.ToJsonString(),replay["warehouse"]!.ToJsonString());
        var receipt=await Read("/warehouse-commands/"+input.CommandId);Assert.Equal(first["warehouse"]!.ToJsonString(),receipt["warehouse"]!.ToJsonString());
        using var client=await Inventory();Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync(Base+"/warehouses/"+id,input with{NameFa="دیگر"})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync(Base+"/warehouses/"+id,input with{CommandId=Id(),Version=version})).StatusCode);
        using var other=await fixture.Staff("InventoryManager");Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync(Base+"/warehouse-commands/"+input.CommandId)).StatusCode);
    }
    [Fact] public async Task OnlyOneWholeStoreWarehouseCanBeActiveEvenUnderConcurrentCommands()
    {
        var a=Id();var b=Id();using var c=await Inventory();var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<HttpStatusCode> Send(string id){await start.Task;using var response=await c.PutAsJsonAsync(Base+"/warehouses/"+id,Warehouse("QA-"+Id(),true));return response.StatusCode;}
        var first=Send(a);var second=Send(b);start.SetResult();var statuses=await Task.WhenAll(first,second);Assert.Single(statuses,x=>x==HttpStatusCode.OK);Assert.Single(statuses,x=>x==HttpStatusCode.Conflict);
        var winner=statuses[0]==HttpStatusCode.OK?a:b;try{await using var s=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.Equal(1,await s.ServiceProvider.GetRequiredService<InventoryDbContext>().AccountingWarehouses.CountAsync(x=>x.IsActive));}finally{await Deactivate(winner);}
    }
    [Fact] public async Task WarehouseIdentityIsCaseSensitiveImmutableAndActivationNeedsAcknowledgement()
    {
        var company="Case-"+Id();var a=Id();var input=Warehouse(company);await PutWarehouse(a,input);await PutWarehouse(Id(),Warehouse(company.ToLowerInvariant()));using var c=await Inventory();
        Assert.Equal(HttpStatusCode.Conflict,(await c.PutAsJsonAsync(Base+"/warehouses/"+Id(),Warehouse(company))).StatusCode);
        var row=await Read("/warehouses/"+a);Assert.Equal(HttpStatusCode.Conflict,(await c.PutAsJsonAsync(Base+"/warehouses/"+a,input with{CommandId=Id(),CompanyKey="other",Version=row["version"]!.GetValue<string>()})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await c.PutAsJsonAsync(Base+"/warehouses/"+Id(),Warehouse(company,true) with{AcknowledgeWholeStorePhysical=false})).StatusCode);
    }
    [Fact] public async Task ReconciliationConvertsDecimalsExactlyKeepsCommitmentsAndNeverWrites()
    {
        var s=await Prepare();var id=Id();await PutWarehouse(id,Warehouse(s.Company,true));try{
            var before=await BusinessState(s.Variant);var one=await Read("/imports/"+s.Batch+"/reconciliation");var row=one["rows"]![0]!;
            Assert.Empty(Issues(row));Assert.Equal(3,row["targetOnHand"]!.GetValue<int>());Assert.Equal(-3,row["delta"]!.GetValue<int>());Assert.Equal(2,row["stock"]!["reserved"]!.GetValue<int>());Assert.Equal(1,row["stock"]!["sourcingReserved"]!.GetValue<int>());Assert.Equal(3,row["stock"]!["available"]!.GetValue<int>());Assert.Equal("9007199254740993",row["match"]!["priceRial"]!.GetValue<string>());Assert.False(one["canApplyManual"]!.GetValue<bool>());Assert.False(one["canSyncLive"]!.GetValue<bool>());
            Assert.Equal(one.ToJsonString(),(await Read("/imports/"+s.Batch+"/reconciliation")).ToJsonString());Assert.Equal(before,await BusinessState(s.Variant));
            await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.False(await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(x=>x.Resource==Base+"/imports/"+s.Batch+"/reconciliation"));
        }finally{await Deactivate(id);}
    }
    [Theory] [InlineData("0",0)] [InlineData("0.5",1)]
    public async Task ZeroAndFractionsAreExplicitNeverMissingOrRounded(string raw,int expected)
    {
        var s=await Prepare(raw,onHand:0,reserved:0,sourcing:0);var row=(await Read("/imports/"+s.Batch+"/reconciliation"))["rows"]![0]!;Assert.Equal(expected,row["targetOnHand"]!.GetValue<int>());Assert.DoesNotContain("accounting_quantity_conversion",Issues(row));
    }
    [Theory] [InlineData("available","available_quantity_requires_reconciliation")] [InlineData("unknown","quantity_meaning_unknown")]
    public async Task AvailableBalancesNeverBecomePhysicalBalances(string meaning,string issue)
    {
        var s=await Prepare(meaning:meaning);var row=(await Read("/imports/"+s.Batch+"/reconciliation"))["rows"]![0]!;Assert.Contains(issue,Issues(row));Assert.Contains("warehouse_mapping_required",Issues(row));
    }
    [Fact] public async Task SerialUsedBelowReservationAndNewerMovementAreVisibleBlockers()
    {
        var s=await Prepare("0",onHand:1,reserved:1,sourcing:0,tracking:"imei",single:true);await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();db.Movements.Add(new(){VariantId=s.Variant,Delta=0,Balance=1,ActorId="synthetic",Reason="QA newer event",RequestId=Id(),At=DateTimeOffset.UtcNow});await db.SaveChangesAsync();}
        var row=(await Read("/imports/"+s.Batch+"/reconciliation"))["rows"]![0]!;foreach(var issue in new[]{"tracked_stock_requires_serial_receipt","single_unit_requires_inspection_flow","stock_moved_since_observation","stock_below_commitments"})Assert.Contains(issue,Issues(row));
    }
    [Fact] public async Task UnitAndStockVersionsChangeFingerprintButRawBatchIsImmutable()
    {
        var s=await Prepare();var first=await Read("/imports/"+s.Batch+"/reconciliation");using var c=await Inventory();
        var unit=await Json(await c.GetAsync("/api/admin/inventory/receiving-unit-mappings/"+s.Mapping));await Json(await c.PutAsJsonAsync("/api/admin/inventory/receiving-unit-mappings/"+s.Mapping,new ReceivingUnitMappingInput(Id(),"holoo",s.Company,"000-WH","BOX",s.Variant,4,1,"بسته تازه","New box",true,unit["version"]!.GetValue<string>())));
        var second=await Read("/imports/"+s.Batch+"/reconciliation");Assert.NotEqual(first["fingerprint"]!.GetValue<string>(),second["fingerprint"]!.GetValue<string>());Assert.Equal(first["batchPayloadHash"]!.GetValue<string>(),second["batchPayloadHash"]!.GetValue<string>());Assert.Equal(6,second["rows"]![0]!["targetOnHand"]!.GetValue<int>());
    }
    [Fact] public async Task RolesAndUnknownFieldsCannotWriteOrExposeInventory()
    {
        using var c=await Inventory();var id=Id();using var anon=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anon.GetAsync(Base+"/warehouses")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Writer.GetAsync(Base+"/warehouses")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Writer.PutAsJsonAsync(Base+"/warehouses/"+id,Warehouse("qa"))).StatusCode);
        var s=await Prepare();Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Content.GetAsync(Base+"/imports/"+s.Batch+"/reconciliation")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Writer.GetAsync(Base+"/imports/"+s.Batch+"/reconciliation")).StatusCode);
        var node=JsonSerializer.SerializeToNode(Warehouse("QA-"+Id()),new JsonSerializerOptions(JsonSerializerDefaults.Web))!.AsObject();node["assumeAllWarehouses"]=true;Assert.Equal(HttpStatusCode.BadRequest,(await c.PutAsJsonAsync(Base+"/warehouses/"+id,node)).StatusCode);Assert.Equal(HttpStatusCode.NotFound,(await c.GetAsync(Base+"/warehouses/"+id)).StatusCode);
    }
    [Fact] public async Task WarehouseAndReceiptRollBackTogetherWhenRootAuditFails()
    {
        var id=Id();var input=Warehouse("QA-"+Id());await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_HolooWarehouseAuditQA] CHECK ([Resource] NOT LIKE N'/api/admin/accounting/holoo/warehouses/%')");}
        try{using var c=await Inventory();Assert.Equal(HttpStatusCode.Conflict,(await c.PutAsJsonAsync(Base+"/warehouses/"+id,input)).StatusCode);}finally{await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_HolooWarehouseAuditQA]");}
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var inventory=check.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.False(await inventory.AccountingWarehouses.AnyAsync(x=>x.Id==id));Assert.False(await inventory.AccountingWarehouseCommands.AnyAsync(x=>x.CommandId==input.CommandId));
    }
    [Fact] public async Task RawSqlHttpResponsesCanBeCapturedWithoutNormalization()
    {
        var directory=Environment.GetEnvironmentVariable("SHOP_HOLOO_RECONCILIATION_WIRE_DIR");if(directory is not null)Directory.CreateDirectory(directory);
        async Task Capture(string file,HttpResponseMessage response){using(response){Assert.Equal(HttpStatusCode.OK,response.StatusCode);var raw=await response.Content.ReadAsByteArrayAsync();if(directory is not null)await File.WriteAllBytesAsync(Path.Combine(directory,file+".json"),raw);}}
        using var c=await Inventory();var s=await Prepare();var id=Id();var input=Warehouse(s.Company);await Capture("warehouse-saved",await c.PutAsJsonAsync(Base+"/warehouses/"+id,input));await Capture("warehouse-replay",await c.PutAsJsonAsync(Base+"/warehouses/"+id,input));await Capture("warehouse-receipt",await c.GetAsync(Base+"/warehouse-commands/"+input.CommandId));await Capture("warehouse-page",await c.GetAsync(Base+"/warehouses?companyKey="+s.Company));await Capture("reconciliation",await c.GetAsync(Base+"/imports/"+s.Batch+"/reconciliation"));
    }
    [Fact] public async Task FailedWarehouseReceiptRollsBackTheMappingBeforeAudit()
    {
        var id=Id();await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[AccountingWarehouseCommands] WITH NOCHECK ADD CONSTRAINT [CK_HolooWarehouseReceiptQA] CHECK ([TargetId]=N'__qa_disallowed__')");}
        try{using var c=await Inventory();Assert.Equal(HttpStatusCode.Conflict,(await c.PutAsJsonAsync(Base+"/warehouses/"+id,Warehouse("QA-"+Id()))).StatusCode);}finally{await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[AccountingWarehouseCommands] DROP CONSTRAINT [CK_HolooWarehouseReceiptQA]");}
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.False(await check.ServiceProvider.GetRequiredService<InventoryDbContext>().AccountingWarehouses.AnyAsync(x=>x.Id==id));Assert.False(await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(x=>x.Resource==Base+"/warehouses/"+id));
    }
    [Fact] public async Task WarehousePagingIsBoundedAndCursorRemainsCompanyScoped()
    {
        var company="Page-"+Id();await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();for(var i=0;i<21;i++)db.AccountingWarehouses.Add(new(){Id=Id(),CompanyKey=company,ExternalWarehouseKey="WH-"+i,NameFa="انبار مصنوعی",NameEn="Synthetic warehouse",ChangedAt=DateTimeOffset.UtcNow});await db.SaveChangesAsync();}
        var first=await Read("/warehouses?companyKey="+company);Assert.Equal(20,first["items"]!.AsArray().Count);var cursor=Uri.EscapeDataString(first["nextCursor"]!.GetValue<string>());var last=await Read("/warehouses?companyKey="+company+"&cursor="+cursor);Assert.Single(last["items"]!.AsArray());Assert.Null(last["nextCursor"]);using var c=await Inventory();Assert.Equal(HttpStatusCode.BadRequest,(await c.GetAsync(Base+"/warehouses?companyKey=other&cursor="+cursor)).StatusCode);
    }
    [Fact] public async Task ProductionReaderCannotReconcileDemoBatch()
    {
        var s=await Prepare();await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var cat=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var inventory=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var coordinator=new AccountingReconciliationCoordinator(cat,inventory,new AccountingImportService(cat,TimeProvider.System,false),scope.ServiceProvider.GetRequiredService<IAccountingInventory>());var error=await Assert.ThrowsAsync<BusinessException>(()=>coordinator.ReadAsync(s.Batch,default));Assert.Equal("not_found",error.Code);
    }
}

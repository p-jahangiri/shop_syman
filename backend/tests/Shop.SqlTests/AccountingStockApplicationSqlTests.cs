using System.Net;
using System.Net.Http.Json;
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
public sealed class AccountingStockApplicationSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>,IAsyncLifetime
{
    private const string Base="/api/admin/accounting/holoo";
    private static string Id()=>Guid.NewGuid().ToString("N");
    public async Task InitializeAsync(){await using var s=fixture.Sql.Factory.Services.CreateAsyncScope();var db=s.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);foreach(var x in await db.AccountingWarehouses.Where(x=>x.IsActive).ToArrayAsync())x.IsActive=false;await db.SaveChangesAsync();}
    public Task DisposeAsync()=>Task.CompletedTask;
    private async Task<HttpClient> Staff()=>await fixture.ReuseStaff("InventoryManager");
    private static Task<JsonNode> Json(HttpResponseMessage response)=>MarketFixture.Json(response);
    private sealed record Setup(string Company,string Variant,string Batch,string Warehouse,string Mapping,DateTimeOffset ObservedAt);
    private async Task<Setup> Prepare(string raw="4",int onHand=6,int reserved=2,int sourcing=1,bool missingStock=false,string tracking="none",DateTimeOffset? observedAt=null,string? company=null,string? variant=null,string? warehouseId=null,string? mappingId=null,string item="000-item",string variantPrefix="qa-")
    {
        company??="stock-"+Id();var isNew=variant is null;var existingWarehouse=warehouseId is not null;variant??=variantPrefix+Id();var batch=Id();var observed=observedAt??DateTimeOffset.UtcNow.AddMinutes(-2);warehouseId??=Id();mappingId??=Id();
        if(isNew){await using var s=fixture.Sql.Factory.Services.CreateAsyncScope();var cat=s.ServiceProvider.GetRequiredService<CatalogDbContext>();cat.Variants.Add(new ProductVariant{Id=variant,ProductId="p1",Sku="QA-"+Id(),IsActive=true,PriceRial=9007199254740993});await cat.SaveChangesAsync();if(!missingStock){var inv=s.ServiceProvider.GetRequiredService<InventoryDbContext>();inv.Stock.Add(new(){VariantId=variant,OnHand=onHand,Reserved=reserved,SourcingReserved=sourcing,TrackingMode=tracking});inv.Movements.Add(new(){VariantId=variant,Delta=onHand,Balance=onHand,ActorId="synthetic",Reason="QA initial physical stock",RequestId=Id(),At=observed.AddSeconds(-1)});await inv.SaveChangesAsync();}
            await Json(await fixture.Writer.PutAsJsonAsync(Base+"/links/"+Id(),new AccountingProductLinkInput(company,item,null,variant,true,null)));
            using var staff=await Staff();if(!existingWarehouse)await Json(await staff.PutAsJsonAsync(Base+"/warehouses/"+warehouseId,new AccountingWarehouseInput(Id(),company,"000-WH","انبار مصنوعی","Synthetic warehouse",true,true,null)));
            await Json(await staff.PutAsJsonAsync("/api/admin/inventory/receiving-unit-mappings/"+mappingId,new ReceivingUnitMappingInput(Id(),"holoo",company,"000-WH","BOX",variant,2,1,"بسته دوتایی","Pack of two",true,null)));
        }
        await Json(await fixture.Writer.PutAsJsonAsync(Base+"/imports/"+batch,new AccountingImportInput(1,company,"000-WH","physical","IRR",observed,true,[new(item,null,"Synthetic item","BOX",raw,"9007199254740993"),new("unmapped",null,null,"EA",null,null)])));
        return new(company,variant,batch,warehouseId,mappingId,observed);
    }
    private async Task<JsonNode> Preview(Setup s){using var c=await Staff();return await Json(await c.GetAsync(Base+"/imports/"+s.Batch+"/stock-preview"));}
    private static AccountingStockApplyInput Command(JsonNode preview)=>new(Id(),preview["fingerprint"]!.GetValue<string>(),[1],"Synthetic QA physical reconciliation",true,true);
    private async Task<JsonNode> Apply(Setup s,AccountingStockApplyInput input){using var c=await Staff();return await Json(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input));}
    private async Task<string> Stock(string variant){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();return System.Text.Json.JsonSerializer.Serialize(await db.Stock.AsNoTracking().SingleOrDefaultAsync(x=>x.VariantId==variant));}
    private async Task<int> Applications(string batch){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().AccountingStockApplications.CountAsync(x=>x.BatchId==batch);}
    [Fact] public async Task ExplicitSubsetUpdatesOnlyStockAndKeepsBothCommitmentsAndExactCatalogPrice()
    {
        var s=await Prepare();var before=await Stock(s.Variant);var preview=await Preview(s);Assert.True(preview["canApplyManual"]!.GetValue<bool>());Assert.True(preview["candidates"]![0]!["canApply"]!.GetValue<bool>());Assert.False(preview["candidates"]![1]!["canApply"]!.GetValue<bool>());Assert.Equal(before,await Stock(s.Variant));
        var command=Command(preview);var result=await Apply(s,command);Assert.False(result["replayed"]!.GetValue<bool>());var line=Assert.Single(result["lines"]!.AsArray())!;Assert.Equal(6,line["beforeOnHand"]!.GetValue<int>());Assert.Equal(8,line["afterOnHand"]!.GetValue<int>());Assert.Equal(2,line["reserved"]!.GetValue<int>());Assert.Equal(1,line["sourcingReserved"]!.GetValue<int>());Assert.Equal(2,line["delta"]!.GetValue<int>());Assert.NotNull(line["movementId"]);Assert.NotEqual(line["beforeStockVersion"]!.GetValue<string>(),line["afterStockVersion"]!.GetValue<string>());
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var stock=await db.Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal((8,2,1),(stock.OnHand,stock.Reserved,stock.SourcingReserved));Assert.Equal(9007199254740993,(await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.SingleAsync(x=>x.Id==s.Variant)).PriceRial);Assert.Equal(2,await db.Movements.CountAsync(x=>x.VariantId==s.Variant));Assert.Equal(1,await db.AccountingStockApplicationLines.CountAsync(x=>x.BatchId==s.Batch));
        var after=await Preview(s);Assert.False(after["candidates"]![0]!["canApply"]!.GetValue<bool>());Assert.NotNull(after["candidates"]![0]!["priorApplicationId"]);Assert.NotEqual(preview["fingerprint"]!.GetValue<string>(),after["fingerprint"]!.GetValue<string>());
    }
    [Fact] public async Task ConcurrentSameActorCommandHasExactlyOneMovementAndPersistentReplay()
    {
        var s=await Prepare();var input=Command(await Preview(s));var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);async Task<JsonNode> Run(){await start.Task;return await Apply(s,input);}var a=Run();var b=Run();start.SetResult();var results=await Task.WhenAll(a,b);Assert.Single(results,x=>x["replayed"]!.GetValue<bool>());Assert.Single(results,x=>!x["replayed"]!.GetValue<bool>());Assert.Equal(results[0]["lines"]!.ToJsonString(),results[1]["lines"]!.ToJsonString());Assert.Equal(1,await Applications(s.Batch));
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.Equal(2,await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Movements.CountAsync(x=>x.VariantId==s.Variant));
    }
    [Fact] public async Task ReceiptRemainsHistoricalAndAnotherActorCannotReadTheCommandOrReapplyItsRow()
    {
        var s=await Prepare();var input=Command(await Preview(s));var first=await Apply(s,input);await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var stock=await db.Stock.SingleAsync(x=>x.VariantId==s.Variant);stock.OnHand++;db.Movements.Add(new(){VariantId=s.Variant,Delta=1,Balance=stock.OnHand,ActorId="synthetic",Reason="Later QA physical correction",RequestId=Id(),At=DateTimeOffset.UtcNow});await db.SaveChangesAsync();}
        var replay=await Apply(s,input);Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(first["lines"]!.ToJsonString(),replay["lines"]!.ToJsonString());using var c=await Staff();var receipt=await Json(await c.GetAsync(Base+"/imports/"+s.Batch+"/stock-commands/"+input.CommandId));Assert.Equal(first["lines"]!.ToJsonString(),receipt["lines"]!.ToJsonString());
        using var other=await fixture.Staff("InventoryManager");Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync(Base+"/imports/"+s.Batch+"/stock-commands/"+input.CommandId)).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await other.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input with{CommandId=Id()})).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input with{Reason="different"})).StatusCode);
    }
    [Theory][InlineData(false)][InlineData(true)]
    public async Task ZeroDeltaCreatesAReceiptWithoutInventingAMovementOrAnAbsentStockRow(bool absent)
    {
        var s=await Prepare("0",onHand:0,reserved:0,sourcing:0,missingStock:absent);var before=await Stock(s.Variant);var result=await Apply(s,Command(await Preview(s)));var line=result["lines"]![0]!;Assert.Equal(0,line["delta"]!.GetValue<int>());Assert.Null(line["movementId"]);Assert.Equal(before,await Stock(s.Variant));if(absent){Assert.Null(line["beforeStockVersion"]);Assert.Null(line["afterStockVersion"]);}
    }
    [Fact] public async Task ANewFileCannotReapplyAnOlderOrEqualObservationEvenForZeroDelta()
    {
        var s=await Prepare("3");await Apply(s,Command(await Preview(s)));var later=await Prepare("4",company:s.Company,variant:s.Variant,warehouseId:s.Warehouse,mappingId:s.Mapping,observedAt:s.ObservedAt);var preview=await Preview(later);Assert.Contains(preview["candidates"]![0]!["issues"]!.AsArray(),x=>x!.GetValue<string>()=="accounting_observation_not_newer");using var c=await Staff();Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+later.Batch+"/stock-commands",Command(preview))).StatusCode);Assert.Equal(0,await Applications(later.Batch));
    }
    [Theory][InlineData("stock")][InlineData("unit")][InlineData("warehouse")][InlineData("catalog")]
    public async Task StaleDependencyFingerprintRejectsTheWholeApplication(string dependency)
    {
        var s=await Prepare();var input=Command(await Preview(s));await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();if(dependency=="stock"){var x=await db.Stock.SingleAsync(x=>x.VariantId==s.Variant);x.Reserved++;}
            if(dependency=="unit"){var x=await db.ReceivingUnitMappings.SingleAsync(x=>x.Id==s.Mapping);x.Numerator=3;}
            if(dependency=="warehouse"){var x=await db.AccountingWarehouses.SingleAsync(x=>x.Id==s.Warehouse);x.NameFa="نام دیگر";}
            if(dependency=="catalog"){var cat=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var x=await cat.Variants.SingleAsync(x=>x.Id==s.Variant);x.PriceRial++;await cat.SaveChangesAsync();}
            await db.SaveChangesAsync();
        }
        var before=await Stock(s.Variant);using var c=await Staff();Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input)).StatusCode);Assert.Equal(before,await Stock(s.Variant));Assert.Equal(0,await Applications(s.Batch));
    }
    [Theory][InlineData("1","none")][InlineData("4","imei")]
    public async Task InsufficientHeldBalanceOrTrackedStockCannotBeApplied(string raw,string tracking)
    {
        var s=await Prepare(raw,tracking:tracking);var p=await Preview(s);Assert.False(p["candidates"]![0]!["canApply"]!.GetValue<bool>());var before=await Stock(s.Variant);using var c=await Staff();Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",Command(p))).StatusCode);Assert.Equal(before,await Stock(s.Variant));Assert.Equal(0,await Applications(s.Batch));
    }
    [Fact] public async Task UsedCatalogReportBlocksApplicationEvenIfTheStockRowIsAbsent()
    {
        var s=await Prepare(onHand:1,reserved:0,sourcing:0);using var admin=await fixture.ReuseStaff("Administrator");var detail=await Json(await admin.GetAsync("/api/admin/used-items/"+s.Variant));var facts=new UsedItemConditionData(Id(),"passed","measured",87,"intact","worn","unknown","نمونه SQL","SQL sample",DateTimeOffset.UtcNow.AddMinutes(-1));await Json(await admin.PutAsJsonAsync($"/api/admin/used-items/{s.Variant}/commands/{Id()}",new SaveUsedItemInput(detail["variantVersion"]!.GetValue<string>(),facts)));
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.Where(x=>x.VariantId==s.Variant).ExecuteDeleteAsync();
        var p=await Preview(s);Assert.Contains(p["candidates"]![0]!["issues"]!.AsArray(),x=>x!.GetValue<string>()=="single_unit_requires_inspection_flow");Assert.Null(p["reconciliation"]!["rows"]![0]!["stock"]);using var c=await Staff();Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",Command(p))).StatusCode);
    }
    [Fact] public async Task CorruptedRawStagingFailsClosedBeforeItCanChangeStock()
    {
        var s=await Prepare();await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().AccountingImportRows.Where(x=>x.BatchId==s.Batch&&x.RowNumber==1).ExecuteUpdateAsync(set=>set.SetProperty(x=>x.QuantityRaw,"99"));
        var before=await Stock(s.Variant);using var c=await Staff();Assert.Equal(HttpStatusCode.ServiceUnavailable,(await c.GetAsync(Base+"/imports/"+s.Batch+"/stock-preview")).StatusCode);Assert.Equal(before,await Stock(s.Variant));Assert.Equal(0,await Applications(s.Batch));
    }
    [Theory][InlineData(false)][InlineData(true)]
    public async Task ReceiptOrAuditFailureRollsBackStockLedgerHeaderAndLines(bool audit)
    {
        var s=await Prepare();var input=Command(await Preview(s));var before=await Stock(s.Variant);await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            if(audit)await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_StockApplyAuditQA] CHECK ([Resource] NOT LIKE N'/api/admin/accounting/holoo/imports/%/stock-commands')");
            else await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[AccountingStockApplicationLines] WITH NOCHECK ADD CONSTRAINT [CK_StockApplyReceiptQA] CHECK ([RowNumber]<0)");
        }
        try{using var c=await Staff();Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input)).StatusCode);}finally{await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();if(audit)await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_StockApplyAuditQA]");else await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[AccountingStockApplicationLines] DROP CONSTRAINT [CK_StockApplyReceiptQA]");}
        Assert.Equal(before,await Stock(s.Variant));Assert.Equal(0,await Applications(s.Batch));await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.Equal(1,await check.ServiceProvider.GetRequiredService<InventoryDbContext>().Movements.CountAsync(x=>x.VariantId==s.Variant));Assert.False(await check.ServiceProvider.GetRequiredService<InventoryDbContext>().AccountingStockApplicationLines.AnyAsync(x=>x.BatchId==s.Batch));
    }
    [Fact] public async Task RoleMalformedInputAndMissingAcknowledgementCannotChangeStock()
    {
        var s=await Prepare();var input=Command(await Preview(s));using var c=await Staff();Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Writer.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input)).StatusCode);Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input with{AcknowledgeUnpostedSalesReconciled=false})).StatusCode);Assert.Equal(HttpStatusCode.BadRequest,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input with{RowNumbers=[1,1]})).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input with{RowNumbers=[1,2]})).StatusCode);Assert.Equal(0,await Applications(s.Batch));
    }
    [Fact] public async Task ApplicationHistoryCannotBeModifiedThroughAnySaveChangesOverload()
    {
        var s=await Prepare();var result=await Apply(s,Command(await Preview(s)));var id=result["id"]!.GetValue<string>();
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var header=await db.AccountingStockApplications.SingleAsync(x=>x.Id==id);header.Reason="tamper";Assert.Throws<InvalidOperationException>(()=>db.SaveChanges(false));}
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();db.Remove(await db.AccountingStockApplicationLines.FirstAsync(x=>x.ApplicationId==id));await Assert.ThrowsAsync<InvalidOperationException>(()=>db.SaveChangesAsync(false,default));}
    }
    [Fact] public async Task OriginalStockApplicationHttpResponsesCanBeCapturedForProductionDecoders()
    {
        var s=await Prepare();var directory=Environment.GetEnvironmentVariable("SHOP_HOLOO_STOCK_WIRE_DIR");if(directory is not null)Directory.CreateDirectory(directory);async Task<JsonNode> Capture(string name,HttpResponseMessage response){using(response){Assert.Equal(HttpStatusCode.OK,response.StatusCode);var raw=await response.Content.ReadAsByteArrayAsync();if(directory is not null)await File.WriteAllBytesAsync(Path.Combine(directory,name+".json"),raw);return JsonNode.Parse(raw)!;}}
        using var c=await Staff();var p=await Capture("preview",await c.GetAsync(Base+"/imports/"+s.Batch+"/stock-preview"));var input=Command(p);if(directory is not null)await File.WriteAllBytesAsync(Path.Combine(directory,"command.input.json"),System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(input,new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));var first=await Capture("applied",await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input));await Capture("replay",await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input));await Capture("receipt",await c.GetAsync(Base+"/imports/"+s.Batch+"/stock-commands/"+input.CommandId));await Capture("application",await c.GetAsync(Base+"/stock-applications/"+first["id"]!.GetValue<string>()));await Capture("after-preview",await c.GetAsync(Base+"/imports/"+s.Batch+"/stock-preview"));
    }
    [Fact] public async Task PositivePhysicalCountCanCreateAnActualCatalogSkusMissingStockBalance()
    {
        var s=await Prepare(missingStock:true);var result=await Apply(s,Command(await Preview(s)));var line=result["lines"]![0]!;Assert.Equal(0,line["beforeOnHand"]!.GetValue<int>());Assert.Equal(8,line["afterOnHand"]!.GetValue<int>());Assert.Null(line["beforeStockVersion"]);Assert.NotNull(line["afterStockVersion"]);await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var stock=await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal((8,0,0),(stock.OnHand,stock.Reserved,stock.SourcingReserved));Assert.Equal("none",stock.TrackingMode);
    }
    [Fact] public async Task ConcurrentCustomerHoldAndPhysicalCorrectionCannotLoseOrOverbookCommitments()
    {
        var s=await Prepare("2",reserved:0,sourcing:0);var input=Command(await Preview(s));var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<bool> Correct(){await start.Task;using var c=await Staff();using var response=await c.PostAsJsonAsync(Base+"/imports/"+s.Batch+"/stock-commands",input);Assert.Contains(response.StatusCode,new[]{HttpStatusCode.OK,HttpStatusCode.Conflict});return response.IsSuccessStatusCode;}
        async Task<bool> Hold(){await start.Task;await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();try{await scope.ServiceProvider.GetRequiredService<StockReservationService>().HoldAsync(new("qa-owner-"+Id(),Id(),Id(),[new(s.Variant,5)],TimeSpan.FromMinutes(1)),default);return true;}catch(BusinessException e){Assert.Equal("insufficient_stock",e.Code);return false;}}
        var correction=Correct();var reservation=Hold();start.SetResult();var results=await Task.WhenAll(correction,reservation);Assert.Single(results,x=>x);await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var stock=await check.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(x=>x.VariantId==s.Variant);Assert.Equal(results[0]?4:6,stock.OnHand);Assert.Equal(results[1]?5:0,stock.Reserved);Assert.True(StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved)>=0);
    }
    [Fact] public async Task FailureOnTheSecondSelectedSkuRollsBackBothBalancesAndEveryReceiptLine()
    {
        var first=await Prepare();var second=await Prepare(company:first.Company,warehouseId:first.Warehouse,observedAt:first.ObservedAt,item:"second-item",variantPrefix:"qa-block-stock-");var batch=Id();await Json(await fixture.Writer.PutAsJsonAsync(Base+"/imports/"+batch,new AccountingImportInput(1,first.Company,"000-WH","physical","IRR",first.ObservedAt,true,[new("000-item",null,null,"BOX","4",null),new("second-item",null,null,"BOX","4",null)])));var combined=first with{Batch=batch};var input=Command(await Preview(combined)) with{RowNumbers=[1,2]};var beforeA=await Stock(first.Variant);var beforeB=await Stock(second.Variant);
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope())await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[Movements] WITH NOCHECK ADD CONSTRAINT [CK_StockApplySecondSkuQA] CHECK ([VariantId] NOT LIKE N'qa-block-stock-%' OR [Reason] NOT LIKE N'Holoo manual stock reconciliation %')");
        try{using var c=await Staff();Assert.Equal(HttpStatusCode.Conflict,(await c.PostAsJsonAsync(Base+"/imports/"+batch+"/stock-commands",input)).StatusCode);}finally{await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [inventory].[Movements] DROP CONSTRAINT [CK_StockApplySecondSkuQA]");}
        Assert.Equal(beforeA,await Stock(first.Variant));Assert.Equal(beforeB,await Stock(second.Variant));Assert.Equal(0,await Applications(batch));await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.False(await check.ServiceProvider.GetRequiredService<InventoryDbContext>().AccountingStockApplicationLines.AnyAsync(x=>x.BatchId==batch));
    }
    [Fact] public async Task ProductionReadersHideDemonstrationApplicationsAndActorReceipts()
    {
        var s=await Prepare();var result=await Apply(s,Command(await Preview(s)));var id=result["id"]!.GetValue<string>();await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var header=await db.AccountingStockApplications.AsNoTracking().SingleAsync(x=>x.Id==id);var locks=new StockReservationService(db,TimeProvider.System);var inventory=new AccountingInventoryService(db,locks,TimeProvider.System);var production=new AccountingStockApplicationService(db,locks,inventory,TimeProvider.System,false);
        Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>production.ApplicationAsync(id,default))).Code);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>production.CommandAsync(header.ActorId,s.Batch,header.CommandId,default))).Code);
    }
}

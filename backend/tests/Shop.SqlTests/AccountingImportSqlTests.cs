using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class AccountingImportSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private const string Base="/api/admin/accounting/holoo/imports";
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static AccountingImportInput Input(string? company=null)=>new(1,company??"qa-"+Id(),"000-WH","physical","IRR",DateTimeOffset.UtcNow.AddMinutes(-1),true,[new("0001-A","DISPLAY","کالای مصنوعی هلو","EA","2","9007199254740993"),new("0001-a",null,null,"BOX","1.5",null)]);
    private async Task<JsonNode> Save(string id,AccountingImportInput input){using var response=await fixture.Writer.PutAsJsonAsync(Base+"/"+id,input);return await MarketFixture.Json(response);}
    private async Task<JsonNode> Read(string path){using var response=await fixture.Writer.GetAsync(path);return await MarketFixture.Json(response);}
    private async Task Capture(string file,HttpResponseMessage response){var directory=Environment.GetEnvironmentVariable("SHOP_HOLOO_STAGE_WIRE_DIR");if(string.IsNullOrEmpty(directory))return;Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,file+".json"),await response.Content.ReadAsStringAsync());}
    [Fact] public async Task StageIsImmutableReplayAndNeverChangesCatalogStockOrLiveStatus()
    {
        var id=Id();var input=Input();string prices;int stock,reserved,sourcing;
        await using(var s=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<CatalogDbContext>();prices=string.Join("|",await db.Variants.OrderBy(v=>v.Id).Select(v=>v.Id+":"+v.PriceRial).ToArrayAsync());var inv=s.ServiceProvider.GetRequiredService<InventoryDbContext>();stock=await inv.Stock.SumAsync(x=>x.OnHand);reserved=await inv.Stock.SumAsync(x=>x.Reserved);sourcing=await inv.Stock.SumAsync(x=>x.SourcingReserved);}
        var first=await Save(id,input);Assert.False(first["applied"]!.GetValue<bool>());Assert.False(first["replayed"]!.GetValue<bool>());var replay=await Save(id,input);Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(first["payloadHash"]!.GetValue<string>(),replay["payloadHash"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict,(await fixture.Writer.PutAsJsonAsync(Base+"/"+id,input with{ExternalWarehouseKey="other"})).StatusCode);
        var detail=await Read(Base+"/"+id);Assert.False(detail["canApply"]!.GetValue<bool>());Assert.False(detail["canSyncLive"]!.GetValue<bool>());Assert.Equal(2,detail["rows"]!.AsArray().Count);Assert.Equal("0001-A",detail["rows"]![0]!["externalItemId"]!.GetValue<string>());Assert.Equal("9007199254740993",detail["rows"]![0]!["priceRial"]!.GetValue<string>());Assert.Null(detail["rows"]![1]!["quantity"]);Assert.Equal("1.5",detail["rows"]![1]!["quantityRaw"]!.GetValue<string>());
        await using var c=fixture.Sql.Factory.Services.CreateAsyncScope();var catalog=c.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.Equal(1,await catalog.AccountingImports.CountAsync(x=>x.Id==id));Assert.Equal(2,await catalog.AccountingImportRows.CountAsync(x=>x.BatchId==id));Assert.Equal(prices,string.Join("|",await catalog.Variants.OrderBy(v=>v.Id).Select(v=>v.Id+":"+v.PriceRial).ToArrayAsync()));var inventory=c.ServiceProvider.GetRequiredService<InventoryDbContext>();Assert.Equal(stock,await inventory.Stock.SumAsync(x=>x.OnHand));Assert.Equal(reserved,await inventory.Stock.SumAsync(x=>x.Reserved));Assert.Equal(sourcing,await inventory.Stock.SumAsync(x=>x.SourcingReserved));
        Assert.True(await c.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(a=>a.Resource==Base+"/"+id&&a.Action=="PUT"));var status=await Read("/api/admin/accounting/holoo/status");Assert.False(status["liveConfigured"]!.GetValue<bool>());Assert.False(status["canReceive"]!.GetValue<bool>());
    }
    [Fact] public async Task CurrentMappingIsCompanyCaseScopedAndReadDoesNotApplyExternalPrice()
    {
        string variant;await using(var s=fixture.Sql.Factory.Services.CreateAsyncScope())variant=await s.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.Where(x=>x.ProductId=="p1").OrderBy(x=>x.Id).Select(x=>x.Id).FirstAsync();
        var company="Case-"+Id();var linkId=Id();using(var response=await fixture.Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+linkId,new AccountingProductLinkInput(company,"0001-A",null,variant,true,null)))Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var id=Id();await Save(id,Input(company));var detail=await Read(Base+"/"+id);Assert.Equal(variant,detail["rows"]![0]!["currentMatch"]!["variantId"]!.GetValue<string>());Assert.NotNull(detail["rows"]![0]!["priceDifferenceRial"]);Assert.Null(detail["rows"]![1]!["currentMatch"]);
        var other=Id();await Save(other,Input(company.ToLowerInvariant()));Assert.Null((await Read(Base+"/"+other))["rows"]![0]!["currentMatch"]);
        var link=await Read("/api/admin/accounting/holoo/links/"+linkId);using(var response=await fixture.Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+linkId,new AccountingProductLinkInput(company,"0001-A",null,variant,false,link["version"]!.GetValue<string>())))Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var refreshed=await Read(Base+"/"+id);Assert.Null(refreshed["rows"]![0]!["currentMatch"]);Assert.Equal(detail["batch"]!.ToJsonString(),refreshed["batch"]!.ToJsonString());
    }
    [Fact] public async Task UnauthorizedOrMalformedCommandsCannotCreateImports()
    {
        var id=Id();using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.PutAsJsonAsync(Base+"/"+id,Input())).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Content.PutAsJsonAsync(Base+"/"+id,Input())).StatusCode);Assert.Equal(HttpStatusCode.OK,(await fixture.Content.GetAsync(Base)).StatusCode);
        var input=Input();Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Writer.PutAsJsonAsync(Base+"/"+id,input with{Rows=[input.Rows[0],input.Rows[0]]})).StatusCode);Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Writer.PutAsJsonAsync(Base+"/"+id,input with{ObservedAt=DateTimeOffset.UtcNow.AddHours(1)})).StatusCode);
        var body=JsonSerializerNode(input);body["unrecognizedField"]=true;using(var response=await fixture.Writer.PutAsJsonAsync(Base+"/"+id,body))Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);
        await using var c=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.False(await c.ServiceProvider.GetRequiredService<CatalogDbContext>().AccountingImports.AnyAsync(x=>x.Id==id));Assert.False(await c.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(x=>x.Resource==Base+"/"+id));
    }
    private static JsonObject JsonSerializerNode(AccountingImportInput input)=>System.Text.Json.JsonSerializer.SerializeToNode(input,new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!.AsObject();
    [Fact] public async Task ConcurrentSameIdHasOneImmutableBatchAndExactReplay()
    {
        var id=Id();var input=Input();var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<JsonNode> Command(){await start.Task;return await Save(id,input);}var a=Command();var b=Command();start.SetResult();var responses=await Task.WhenAll(a,b);Assert.Single(responses,x=>!x["replayed"]!.GetValue<bool>());Assert.Single(responses,x=>x["replayed"]!.GetValue<bool>());Assert.Equal(responses[0]["payloadHash"]!.GetValue<string>(),responses[1]["payloadHash"]!.GetValue<string>());
        await using var c=fixture.Sql.Factory.Services.CreateAsyncScope();var db=c.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.Equal(1,await db.AccountingImports.CountAsync(x=>x.Id==id));Assert.Equal(2,await db.AccountingImportRows.CountAsync(x=>x.BatchId==id));
    }
    [Fact] public async Task FailedRootAuditRollsBackAllStagingRows()
    {
        var id=Id();var route=Base+"/"+id;await using(var s=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);Assert.Matches("^/api/admin/accounting/holoo/imports/[a-f0-9]{32}$",route);var sql="ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_HolooStageAuditFailure] CHECK ([Resource]<>N'"+route+"')";await db.Database.ExecuteSqlRawAsync(sql);}
        try{using var response=await fixture.Writer.PutAsJsonAsync(route,Input());Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);}finally{await using var s=fixture.Sql.Factory.Services.CreateAsyncScope();await s.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_HolooStageAuditFailure]");}
        await using var c=fixture.Sql.Factory.Services.CreateAsyncScope();var db2=c.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.False(await db2.AccountingImports.AnyAsync(x=>x.Id==id));Assert.False(await db2.AccountingImportRows.AnyAsync(x=>x.BatchId==id));
    }
    [Fact] public async Task PagingIsBoundedAndCursorCannotMoveToAnotherCompany()
    {
        var company="page-"+Id();await using(var s=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=s.ServiceProvider.GetRequiredService<CatalogDbContext>();for(var i=0;i<21;i++)db.AccountingImports.Add(new(){Id=Id(),CompanyKey=company,ExternalWarehouseKey="WH",QuantityMeaning="unknown",PriceCurrency="unknown",ObservedAt=DateTimeOffset.UtcNow.AddMinutes(-1),CreatedAt=DateTimeOffset.UtcNow,CreatedBy="qa",IsDemo=true,RowCount=1,PayloadHash=new string('A',64),Rows=[new(){RowNumber=1,ExternalItemId="item",ExternalUnitKey="unit"}]});await db.SaveChangesAsync();}
        var first=await Read(Base+"?companyKey="+company);Assert.Equal(20,first["items"]!.AsArray().Count);var cursor=Uri.EscapeDataString(first["nextCursor"]!.GetValue<string>());var last=await Read(Base+"?companyKey="+company+"&cursor="+cursor);Assert.Single(last["items"]!.AsArray());Assert.Null(last["nextCursor"]);Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Writer.GetAsync(Base+"?companyKey=another&cursor="+cursor)).StatusCode);
    }
    [Fact] public async Task ProductionServiceHidesDemoAndRejectsDemoReplay()
    {
        var id=Id();var input=Input();await Save(id,input);await using var s=fixture.Sql.Factory.Services.CreateAsyncScope();var service=new AccountingImportService(s.ServiceProvider.GetRequiredService<CatalogDbContext>(),TimeProvider.System,false);Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>service.ReadAsync(id,CancellationToken.None))).Code);Assert.Equal("invalid_accounting_import",(await Assert.ThrowsAsync<BusinessException>(()=>service.StageAsync(id,input,"qa",CancellationToken.None))).Code);Assert.Empty((await service.PageAsync(input.CompanyKey,null,CancellationToken.None)).Items);
    }
    [Fact] public async Task OriginalSqlResponseBodiesCanBeCaptured()
    {
        var id=Id();var input=Input();using(var response=await fixture.Writer.PutAsJsonAsync(Base+"/"+id,input)){Assert.Equal(HttpStatusCode.OK,response.StatusCode);await Capture("holoo-stage-saved",response);}
        using(var response=await fixture.Writer.PutAsJsonAsync(Base+"/"+id,input)){Assert.Equal(HttpStatusCode.OK,response.StatusCode);await Capture("holoo-stage-replayed",response);}
        using(var response=await fixture.Writer.GetAsync(Base+"/"+id)){Assert.Equal(HttpStatusCode.OK,response.StatusCode);await Capture("holoo-stage-detail",response);}
        using(var response=await fixture.Writer.GetAsync(Base+"?companyKey="+input.CompanyKey)){Assert.Equal(HttpStatusCode.OK,response.StatusCode);await Capture("holoo-stage-page",response);}
    }
}

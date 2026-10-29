using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class AccountingLinkSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private HttpClient Writer=>fixture.Writer;
    private static string Id()=>Guid.NewGuid().ToString("N");
    private Task<JsonNode> Json(HttpResponseMessage response)=>MarketFixture.Json(response);
    private async Task<string> Variant(){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.ProductId=="p1").OrderBy(v=>v.Id).Select(v=>v.Id).FirstAsync();}
    private Task<JsonNode> Detail(string id)=>Read("/api/admin/accounting/holoo/links/"+id);
    private async Task<JsonNode> Read(string path)=>await Json(await Writer.GetAsync(path));
    private async Task Save(string id,AccountingProductLinkInput input)=>_ = await Json(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input));
    private async Task<AdminEditableProduct> Product(string id){using var response=await Writer.GetAsync("/api/admin/products/"+id);Assert.Equal(HttpStatusCode.OK,response.StatusCode);return (await response.Content.ReadFromJsonAsync<AdminProductDetail>())!.Product;}
    private static ProductInput ProductInput(AdminEditableProduct p)=>new(p.CategoryId,p.BrandId,p.Slug,p.Status,p.IsDigital,p.Featured,p.Translations.Select(t=>new TranslationInput(t.Locale,t.Name,t.Description,t.Badge)).ToArray(),[],p.Variants.Select(v=>new VariantInput(v.Id,v.Sku,v.PriceRial,v.CompareAtPriceRial,v.Color,v.ColorNameFa,v.ColorNameEn,v.LabelFa,v.LabelEn,v.WarrantyFa,v.WarrantyEn,v.IsActive,[],[],v.Version)).ToArray(),[],[],[],p.Version);
    private async Task<AdminEditableProduct> NewProduct(bool digital=false)
    {
        var key=Id();var input=new ProductInput("phones","samsung","holoo-"+key,"Draft",digital,false,[new("fa","کالای مصنوعی هلو "+key),new("en","Synthetic Holoo product "+key)],[],[new(null,"HOLOO-"+key,"123456789",null,"#777777","خاکستری","Grey","نمونه","Sample","نمونهٔ آزمون","Synthetic test",true,[],[],null)],[],[],[],null);
        var saved=await Json(await Writer.PostAsJsonAsync("/api/admin/products",input));return await Product(saved["id"]!.GetValue<string>());
    }
    private async Task<long> AuditCount(string route){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();return await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(a=>a.Resource==route&&a.Action=="PUT");}
    private static async Task Capture(string name,string body){var directory=Environment.GetEnvironmentVariable("SHOP_HOLOO_WIRE_DIR");if(string.IsNullOrEmpty(directory))return;Directory.CreateDirectory(directory);await File.WriteAllTextAsync(Path.Combine(directory,name+".json"),body);}
    [Fact] public async Task LiveProviderRemainsUnavailableAndContentReadersCannotWriteLinks()
    {
        var status=await Read("/api/admin/accounting/holoo/status");Assert.False(status["liveConfigured"]!.GetValue<bool>());Assert.False(status["canReceive"]!.GetValue<bool>());Assert.False(status["canWrite"]!.GetValue<bool>());Assert.Equal("holoo_contract_required",status["reason"]!.GetValue<string>());
        using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/admin/accounting/holoo/status")).StatusCode);
        var input=new AccountingProductLinkInput("company-"+Id(),"000012",null,await Variant(),true,null);Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Content.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+Id(),input)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.GetAsync("/api/admin/accounting/holoo/links/not-a-guid")).StatusCode);
    }
    [Fact] public async Task MappingReplaysByIdPreservesStockPricesAndEnforcesOneActiveItemPerSku()
    {
        var before=await Read("/api/admin/products/p1");int onHand,reserved;
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var stock=scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock;onHand=await stock.SumAsync(s=>s.OnHand);reserved=await stock.SumAsync(s=>s.Reserved);}
        var id=Id();var input=new AccountingProductLinkInput("company-"+Id(),"000012","CODE-A",await Variant(),true,null);await Save(id,input);var first=await Detail(id);await Save(id,input);Assert.Equal(first["version"]!.GetValue<string>(),(await Detail(id))["version"]!.GetValue<string>());
        Assert.Equal("000012",first["externalItemId"]!.GetValue<string>());Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+Id(),input)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+Id(),input with{ExternalItemId="other-item"})).StatusCode);
        await Save(id,input with{IsActive=false,Version=first["version"]!.GetValue<string>()});await Save(Id(),input with{ExternalItemId="other-item"});
        Assert.Equal(before["product"]!["variants"]!.ToJsonString(),(await Read("/api/admin/products/p1"))["product"]!["variants"]!.ToJsonString());
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var stockAfter=check.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock;Assert.Equal(onHand,await stockAfter.SumAsync(s=>s.OnHand));Assert.Equal(reserved,await stockAfter.SumAsync(s=>s.Reserved));Assert.True(await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(a=>a.Resource=="/api/admin/accounting/holoo/links/"+id));
    }
    [Fact] public async Task OpaqueIdentityIsCaseSensitiveCompanyScopedAndCannotMoveOnUpdate()
    {
        var company="Case"+Id();var variant=await Variant();var input=new AccountingProductLinkInput(company,"001-Ab",null,variant,false,null);var id=Id();await Save(id,input);await Save(Id(),input with{ExternalItemId="001-ab"});await Save(Id(),input with{ExternalItemId="1-Ab"});await Save(Id(),input with{CompanyKey=company.ToLowerInvariant()});
        var page=await Read("/api/admin/accounting/holoo/links?companyKey="+company);Assert.Equal(3,page["items"]!.AsArray().Count);var lower=await Read("/api/admin/accounting/holoo/links?companyKey="+company.ToLowerInvariant());Assert.Single(lower["items"]!.AsArray());
        var version=(await Detail(id))["version"]!.GetValue<string>();Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input with{CompanyKey="another-company",Version=version})).StatusCode);
        await Save(id,input with{ExternalCode="changed-code",Version=version});Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input with{ExternalCode="stale-code",Version=version})).StatusCode);
    }
    [Fact] public async Task SeekPagingAndVariantSearchAreBoundedAndCursorBindsCompanyAndFilter()
    {
        var company="page-"+Id();var variant=await Variant();await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();for(var i=0;i<53;i++)db.AccountingLinks.Add(new(){Id=Id(),CompanyKey=company,ExternalItemId="page-sample-"+i,VariantId=variant,SearchText="page sample "+i,CreatedBy="qa",ChangedBy="qa",CreatedAt=DateTimeOffset.UtcNow,ChangedAt=DateTimeOffset.UtcNow});await db.SaveChangesAsync();}
        var path="/api/admin/accounting/holoo/links?companyKey="+company;var first=await Read(path);Assert.Equal(50,first["items"]!.AsArray().Count);var cursor=Uri.EscapeDataString(first["nextCursor"]!.GetValue<string>());var second=await Read(path+"&cursor="+cursor);Assert.Equal(3,second["items"]!.AsArray().Count);Assert.Null(second["nextCursor"]);
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.GetAsync(path.ToLowerInvariant()+"x&cursor="+cursor)).StatusCode);
        var choices=await Read("/api/admin/accounting/holoo/variants?query=iphone");Assert.InRange(choices["items"]!.AsArray().Count,1,20);Assert.All(choices["items"]!.AsArray(),c=>Assert.False(c!.AsObject().ContainsKey("priceRial")));
        Assert.Empty((await Read("/api/admin/accounting/holoo/variants"))["items"]!.AsArray());
    }
    [Fact] public async Task UnknownSkuDoesNotCreateAMappingOrSuccessAudit()
    {
        var id=Id();var input=new AccountingProductLinkInput("company-"+Id(),"item",null,"missing-sku",true,null);Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input)).StatusCode);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.False(await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().AccountingLinks.AnyAsync(l=>l.Id==id));Assert.False(await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(a=>a.Resource=="/api/admin/accounting/holoo/links/"+id));
    }
    [Fact] public async Task ConcurrentSameIdCanBeRecoveredWithoutDuplicateLinks()
    {
        var id=Id();var input=new AccountingProductLinkInput("company-"+Id(),"concurrent-item",null,await Variant(),true,null);var responses=await Task.WhenAll(Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input),Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input));
        try{Assert.All(responses,r=>Assert.True(r.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict,r.StatusCode.ToString()));Assert.Contains(responses,r=>r.StatusCode==HttpStatusCode.OK);}finally{foreach(var r in responses)r.Dispose();}
        await Save(id,input);await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.Equal(1,await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().AccountingLinks.CountAsync(l=>l.Id==id));
    }
    [Fact] public async Task ActiveMappingBlocksDigitalConversionUntilSafelyDeactivatedEvenAfterSkuIsDisabled()
    {
        var product=await NewProduct();var id=Id();var input=new AccountingProductLinkInput("lifecycle-"+Id(),"0001",null,product.Variants.Single().Id,true,null);await Save(id,input);var link=await Detail(id);var route="/api/admin/products/"+product.Id;var audit=await AuditCount(route);
        using(var denied=await Writer.PutAsJsonAsync(route,ProductInput(product) with{IsDigital=true})){Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);Assert.Contains("accounting_target_conflict",await denied.Content.ReadAsStringAsync());}
        Assert.Equal(product.Version,(await Product(product.Id)).Version);Assert.Equal(link["version"]!.GetValue<string>(),(await Detail(id))["version"]!.GetValue<string>());Assert.Equal(audit,await AuditCount(route));
        var disabled=ProductInput(product);disabled=disabled with{Variants=disabled.Variants.Select(v=>v with{IsActive=false}).ToArray()};await Json(await Writer.PutAsJsonAsync(route,disabled));
        await Save(id,input with{IsActive=false,Version=link["version"]!.GetValue<string>()});Assert.False((await Detail(id))["isActive"]!.GetValue<bool>());
        var current=await Product(product.Id);await Json(await Writer.PutAsJsonAsync(route,ProductInput(current) with{IsDigital=true}));Assert.True((await Product(product.Id)).IsDigital);
        // Historical inactive links remain editable/removable to the same target.
        await Save(id,input with{IsActive=false,ExternalCode="HISTORICAL",Version=(await Detail(id))["version"]!.GetValue<string>()});
    }
    [Fact] public async Task LegacyDigitalMappingCanBeDeactivatedButDigitalTargetsCannotBeCreatedRetargetedOrReactivated()
    {
        var legacy=await NewProduct();var id=Id();var input=new AccountingProductLinkInput("legacy-"+Id(),"legacy-item",null,legacy.Variants.Single().Id,true,null);await Save(id,input);
        // Deliberately reproduce the previously reachable legacy state in this
        // fixture's disposable SQL database; all operations under test use HTTP.
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var row=await db.Products.SingleAsync(p=>p.Id==legacy.Id);row.IsDigital=true;await db.SaveChangesAsync();}
        await Save(id,input with{IsActive=false,Version=(await Detail(id))["version"]!.GetValue<string>()});var deactivated=await Detail(id);Assert.False(deactivated["isActive"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input with{Version=deactivated["version"]!.GetValue<string>()})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+Id(),input with{ExternalItemId="new-digital-item",IsActive=false})).StatusCode);
        var physical=await NewProduct();var other=Id();var otherInput=new AccountingProductLinkInput("retarget-"+Id(),"physical-item",null,physical.Variants.Single().Id,false,null);await Save(other,otherInput);var original=await Detail(other);
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+other,otherInput with{VariantId=input.VariantId,Version=original["version"]!.GetValue<string>()})).StatusCode);Assert.Equal(original.ToJsonString(),(await Detail(other)).ToJsonString());
    }
    [Fact] public async Task ConcurrentDigitalConversionAndLinkCreationCannotCommitAnActiveDigitalMapping()
    {
        for(var attempt=0;attempt<4;attempt++){
            var product=await NewProduct();var id=Id();var productRoute="/api/admin/products/"+product.Id;var linkRoute="/api/admin/accounting/holoo/links/"+id;var input=new AccountingProductLinkInput("race-"+Id(),"race-item",null,product.Variants.Single().Id,true,null);var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            async Task<HttpResponseMessage> Convert(){await start.Task;return await Writer.PutAsJsonAsync(productRoute,ProductInput(product) with{IsDigital=true});}
            async Task<HttpResponseMessage> Link(){await start.Task;return await Writer.PutAsJsonAsync(linkRoute,input);}
            var converting=Convert();var linking=Link();start.SetResult();var results=await Task.WhenAll(converting,linking);
            try{Assert.True(results[0].StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict,await results[0].Content.ReadAsStringAsync());Assert.True(results[1].StatusCode is HttpStatusCode.OK or HttpStatusCode.BadRequest or HttpStatusCode.Conflict,await results[1].Content.ReadAsStringAsync());Assert.Single(results,r=>r.StatusCode==HttpStatusCode.OK);}finally{foreach(var result in results)result.Dispose();}
            await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var db=check.ServiceProvider.GetRequiredService<CatalogDbContext>();var digital=await db.Products.Where(p=>p.Id==product.Id).Select(p=>p.IsDigital).SingleAsync();var active=await db.AccountingLinks.AnyAsync(l=>l.Id==id&&l.IsActive);Assert.False(digital&&active);Assert.True(digital||active);Assert.Equal(1,await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(a=>a.Action=="PUT"&&(a.Resource==productRoute||a.Resource==linkRoute)));
        }
    }
    [Fact] public async Task RootAuditFailureRollsBackBothLinkCreationAndVersionedUpdate()
    {
        var product=await NewProduct();var id=Id();var route="/api/admin/accounting/holoo/links/"+id;var input=new AccountingProductLinkInput("audit-"+Id(),"audit-item",null,product.Variants.Single().Id,true,null);
        async Task RejectAudit(bool enabled){await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<IdentityDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);var sql=enabled?"ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_HolooAuditFailure] CHECK ([Resource]<>N'"+route+"')":"ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_HolooAuditFailure]";await db.Database.ExecuteSqlRawAsync(sql);}
        await RejectAudit(true);try{Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync(route,input)).StatusCode);}finally{await RejectAudit(false);}
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope()){Assert.False(await check.ServiceProvider.GetRequiredService<CatalogDbContext>().AccountingLinks.AnyAsync(l=>l.Id==id));Assert.Equal(0,await AuditCount(route));}
        await Save(id,input);var before=await Detail(id);var audit=await AuditCount(route);await RejectAudit(true);try{Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync(route,input with{IsActive=false,ExternalCode="SHOULD-ROLL-BACK",Version=before["version"]!.GetValue<string>()})).StatusCode);}finally{await RejectAudit(false);}
        Assert.Equal(before.ToJsonString(),(await Detail(id)).ToJsonString());Assert.Equal(audit,await AuditCount(route));
        await Save(id,input with{IsActive=false,Version=before["version"]!.GetValue<string>()});Assert.False((await Detail(id))["isActive"]!.GetValue<bool>());
    }
    [Fact] public async Task ActualResponseContractsCanBeCapturedWithoutCredentialsOrSourcePayloads()
    {
        var product=await NewProduct();var id=Id();var company="wire-"+Id();var input=new AccountingProductLinkInput(company,"000012","CODE-A",product.Variants.Single().Id,true,null);
        using(var saved=await Writer.PutAsJsonAsync("/api/admin/accounting/holoo/links/"+id,input)){Assert.Equal(HttpStatusCode.OK,saved.StatusCode);await Capture("saved",await saved.Content.ReadAsStringAsync());}
        foreach(var pair in new[]{("status","/api/admin/accounting/holoo/status"),("page","/api/admin/accounting/holoo/links?companyKey="+company),("detail","/api/admin/accounting/holoo/links/"+id),("variants","/api/admin/accounting/holoo/variants?query="+product.Variants.Single().Sku)}){using var response=await Writer.GetAsync(pair.Item2);Assert.Equal(HttpStatusCode.OK,response.StatusCode);var body=await response.Content.ReadAsStringAsync();if(pair.Item1=="variants")Assert.Single(JsonNode.Parse(body)!["items"]!.AsArray());await Capture(pair.Item1,body);}
    }
}

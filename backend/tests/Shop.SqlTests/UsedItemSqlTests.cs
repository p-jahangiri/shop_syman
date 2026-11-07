using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;
namespace Shop.SqlTests;
public sealed class UsedItemSqlTests(OrderFixture fixture):IClassFixture<OrderFixture>
{
    private static string Id()=>Guid.NewGuid().ToString("N");
    private static UsedItemConditionData Facts(int? battery=87)=>new(Id(),"passed",battery is null?"unknown":"measured",battery,"intact","worn","unknown","دادهٔ نمونه؛ یک خط روی بدنه","Sample: one scratch",DateTimeOffset.UtcNow.AddMinutes(-1));
    private async Task<JsonNode> Detail(string variant)=>await OrderFixture.Json(await fixture.Admin.GetAsync("/api/admin/used-items/"+variant));
    private async Task<JsonNode> Save(string variant,UsedItemConditionData facts){var detail=await Detail(variant);return await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync($"/api/admin/used-items/{variant}/commands/{Id()}",new SaveUsedItemInput(detail["variantVersion"]!.GetValue<string>(),facts)));}
    [Fact]
    public async Task ConditionScopesMatchingSkuAndPricesBeforePagingWithoutChangingTheModel()
    {
        var item = await fixture.Product(price: 299, stock: 1);
        var used = Facts();
        await Save(item.Variant, used);
        var usedOnly = await fixture.Product(stock: 1);
        await Save(usedOnly.Variant, Facts());
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var original = await db.Variants.AsNoTracking().SingleAsync(v => v.Id == item.Variant);
        var category = new Category {
            Slug = "condition-" + Id(), IsActive = true, ImageUrl = "/products/charger.svg",
            Translations = [new() { Locale = "en", Name = "Condition catalogue" }, new() { Locale = "fa", Name = "دستهٔ وضعیت کالا" }],
        };
        db.Categories.Add(category);
        var model = await db.Products.Include(p => p.Translations).SingleAsync(p => p.Id == original.ProductId);
        model.CategoryId = category.Id;
        var fresh = new ProductVariant { ProductId = model.Id, Sku = "FRESH-" + Id(), IsActive = true, PriceRial = 501, LabelEn = "New unit", LabelFa = "نو" };
        db.Variants.Add(fresh);
        await db.SaveChangesAsync();
        var name = model.Translations.Single(t => t.Locale == "en").Name;
        using var client = fixture.Sql.Factory.CreateClient(new() { HandleCookies = false });
        async Task<JsonNode> Search(CatalogSearchInput input) => await OrderFixture.Json(await client.PostAsJsonAsync("/api/catalog/en/search", input));
        var input = new CatalogSearchInput(CategoryId: model.CategoryId, Query: name, PageSize: 1);
        var secondHand = await Search(input with { Condition = "used" });
        Assert.Equal(item.Variant, secondHand["matchingVariantIds"]![model.Id]!.GetValue<string>());
        Assert.Equal(2, secondHand["products"]![0]!["variants"]!.AsArray().Count);
        Assert.Equal(fresh.Id, (await Search(input with { Condition = "new" }))["matchingVariantIds"]![model.Id]!.GetValue<string>());
        Assert.Equal(0, (await Search(input with { Condition = "new", MaxPriceRial = "300" }))["total"]!.GetValue<int>());
        Assert.Equal(0, (await Search(input with { Condition = "used", Query = fresh.Sku }))["total"]!.GetValue<int>());
        using var invalid = await client.PostAsJsonAsync("/api/catalog/en/search", input with { Condition = "invalid" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var filters = await OrderFixture.Json(await client.GetAsync($"/api/catalog/en/filters?categoryId={model.CategoryId}&condition=used"));
        Assert.Equal("299", filters["maxPriceRial"]!.GetValue<string>());

        var usedOnlySlug = await db.Products.Where(p => p.Variants.Any(v => v.Id == usedOnly.Variant))
            .Select(p => p.Slug).SingleAsync();
        const string contentPath = "/api/admin/content/site/fa";
        async Task<JsonNode> Document() =>
            (await OrderFixture.Json(await fixture.Admin.GetAsync("/api/admin/content")))["documents"]!.AsArray()
                .Single(doc => (string?)doc!["key"] == "site" && (string?)doc["locale"] == "fa")!;
        async Task Draft(JsonObject content)
        {
            using var response = await fixture.Admin.PutAsJsonAsync(contentPath, new ContentInput(content, (string?)(await Document())["version"]));
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        }
        async Task Publish()
        {
            using var response = await fixture.Admin.PostAsJsonAsync(contentPath + "/publish", new { version = (string?)(await Document())["version"] });
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        }
        var oldContent = JsonNode.Parse((string)(await Document())["draftJson"]!)!.AsObject();
        var changed = oldContent.DeepClone().AsObject();
        var appearance = changed["appearance"] as JsonObject;
        if (appearance is null) changed["appearance"] = appearance = new JsonObject();
        appearance["showUsedProducts"] = false;
        try
        {
            await Draft(changed);
            Assert.Equal(item.Variant, (await Search(input with { Condition = "used" }))["matchingVariantIds"]![model.Id]!.GetValue<string>());
            await Publish();

            using var hidden = await client.PostAsJsonAsync("/api/catalog/en/search", input with { Condition = "used" });
            Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
            using var hiddenFilters = await client.GetAsync($"/api/catalog/en/filters?categoryId={model.CategoryId}&condition=used");
            Assert.Equal(HttpStatusCode.NotFound, hiddenFilters.StatusCode);
            var publicResults = await Search(input);
            Assert.Equal(fresh.Id, publicResults["matchingVariantIds"]![model.Id]!.GetValue<string>());
            Assert.Equal(fresh.Id, (string?)Assert.Single(publicResults["products"]![0]!["variants"]!.AsArray())!["id"]);
            Assert.Equal(0, (int?)(await Search(input with { MaxPriceRial = "300" }))["total"]);

            var lookup = new ProductLookupInput(VariantIds: [item.Variant, usedOnly.Variant]);
            Assert.Empty((await OrderFixture.Json(await client.PostAsJsonAsync("/api/catalog/en/lookup", lookup)))["products"]!.AsArray());
            Assert.Empty((await OrderFixture.Json(await client.PostAsJsonAsync("/api/catalog/fa/lookup", lookup)))["products"]!.AsArray());
            var offline = await OrderFixture.Json(await client.GetAsync("/api/catalog/en/offline"));
            Assert.DoesNotContain(offline["products"]!.AsArray(), product => (string?)product!["slug"] == usedOnlySlug);
            var sitemap = await OrderFixture.Json(await client.GetAsync("/api/catalog/fa/sitemap/products"));
            Assert.DoesNotContain(sitemap["items"]!.AsArray(), row => (string?)row!["key"] == usedOnlySlug);
            Assert.Equal(used.InspectionId, (string?)(await Detail(item.Variant))["inspection"]!["inspectionId"]);
            var checkout = await scope.ServiceProvider.GetRequiredService<ICheckoutCatalogReader>().ReadCheckoutVariantsAsync("en", [item.Variant], default);
            Assert.Equal(used.InspectionId, Assert.Single(checkout).Value.UsedCondition!.InspectionId);
        }
        finally
        {
            await Draft(oldContent);
            await Publish();
        }
        Assert.Equal(item.Variant, (await Search(input with { Condition = "used" }))["matchingVariantIds"]![model.Id]!.GetValue<string>());
    }
    [Fact]
    public async Task VariantChoicesSeparateReportedDevicesAndSearchTheProductName()
    {
        var item = await fixture.Product(stock: 1);
        var detail = await Detail(item.Variant);
        await using var scope = fixture.Sql.Factory.Services.CreateAsyncScope();
        var catalog = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var productId = detail["productId"]!.GetValue<string>();
        var productName = await catalog.Products.Where(p => p.Id == productId)
            .SelectMany(p => p.Translations).Where(t => t.Locale == "fa").Select(t => t.Name).SingleAsync();

        async Task<JsonArray> Choices(bool reported)
        {
            var path = "/api/admin/used-items/variants?reported=" + reported + "&query=" + Uri.EscapeDataString(productName);
            return (await OrderFixture.Json(await fixture.Admin.GetAsync(path)))["items"]!.AsArray();
        }
        bool SameVariant(JsonNode? row) => row?["variantId"]?.GetValue<string>() == item.Variant;

        Assert.DoesNotContain(await Choices(true), SameVariant);
        Assert.Equal(productName, Assert.Single(await Choices(false), SameVariant)!["productNameFa"]!.GetValue<string>());
        await Save(item.Variant, Facts());
        Assert.DoesNotContain(await Choices(false), SameVariant);
        Assert.Contains(await Choices(true), SameVariant);
    }
    [Fact]public async Task DatabaseCheckRejectsMeasuredBatteryWithNullEvenWhenSqlWouldOtherwiseTreatItAsUnknown()
    {
        var item=await fixture.Product(stock:1);await Save(item.Variant,Facts(null));await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var error=await Assert.ThrowsAsync<SqlException>(()=>db.Set<UsedItemInspection>().Where(i=>i.VariantId==item.Variant).ExecuteUpdateAsync(s=>s.SetProperty(i=>i.BatteryState,"measured")));Assert.Equal(547,error.Number);Assert.Equal("unknown",(await db.Set<UsedItemInspection>().SingleAsync(i=>i.VariantId==item.Variant)).BatteryState);
    }
    [Fact]public async Task RevisionReplayPublicSkuAndSingleUnitConstraintAreRealSql()
    {
        var item=await fixture.Product(stock:1);var before=await Detail(item.Variant);var command=Id();var input=new SaveUsedItemInput(before["variantVersion"]!.GetValue<string>(),Facts(0));var path=$"/api/admin/used-items/{item.Variant}/commands/{command}";
        var first=await UsedItemWire.Body(await fixture.Admin.PutAsJsonAsync(path,input),"save-first","used-result");var replay=await UsedItemWire.Body(await fixture.Admin.PutAsJsonAsync(path,input),"save-replay","used-result");Assert.False(first["replayed"]!.GetValue<bool>());Assert.True(replay["replayed"]!.GetValue<bool>());Assert.Equal(first["detail"]!.ToJsonString(),replay["detail"]!.ToJsonString());Assert.NotEqual(before["variantVersion"]!.GetValue<string>(),first["detail"]!["variantVersion"]!.GetValue<string>());
        using(var mismatch=await fixture.Admin.PutAsJsonAsync(path,input with{Inspection=Facts(1)}))Assert.Equal(HttpStatusCode.Conflict,mismatch.StatusCode);
        using(var stale=await fixture.Admin.PutAsJsonAsync($"/api/admin/used-items/{item.Variant}/commands/{Id()}",input with{Inspection=Facts(90)}))Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        var second=await Save(item.Variant,Facts(100));await UsedItemWire.Body(await fixture.Admin.GetAsync("/api/admin/used-items/"+item.Variant),"detail","used-detail");await UsedItemWire.Body(await fixture.Admin.GetAsync("/api/admin/used-items/variants"),"choices","used-choices");using(var anon=fixture.Sql.Factory.CreateClient(new(){HandleCookies=false})){await UsedItemWire.Body(await anon.PostAsJsonAsync("/api/catalog/en/lookup",new{VariantIds=new[]{item.Variant}}),"public-lookup","lookup");}Assert.Equal(100,second["detail"]!["inspection"]!["batteryHealthPercent"]!.GetValue<int>());
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.Equal(2,await catalog.Set<UsedItemInspection>().CountAsync(i=>i.VariantId==item.Variant));var stock=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();var row=await stock.Stock.SingleAsync(s=>s.VariantId==item.Variant);Assert.True(row.IsSingleUnit);Assert.Equal(1,row.OnHand);Assert.Equal(0,row.Reserved);Assert.False(await stock.Movements.AnyAsync(m=>m.VariantId==item.Variant));
        var sql=await Assert.ThrowsAsync<SqlException>(()=>stock.Stock.Where(s=>s.VariantId==item.Variant).ExecuteUpdateAsync(s=>s.SetProperty(s=>s.OnHand,2)));Assert.Equal(547,sql.Number);
        var publicCatalog=await scope.ServiceProvider.GetRequiredService<ICheckoutCatalogReader>().ReadCheckoutVariantsAsync("en",[item.Variant],CancellationToken.None);Assert.Equal(100,Assert.Single(publicCatalog).Value.UsedCondition!.BatteryHealthPercent);
    }
    [Theory][InlineData(2,0,false)][InlineData(1,1,false)][InlineData(1,0,true)]
    public async Task MultiUnitReservedAndDigitalSkuCannotAcquireUsedHistory(int onHand,int reserved,bool digital)
    {
        var item=await fixture.Product(stock:onHand,digital:digital);if(reserved>0){await using var setup=fixture.Sql.Factory.Services.CreateAsyncScope();await setup.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.Where(s=>s.VariantId==item.Variant).ExecuteUpdateAsync(s=>s.SetProperty(s=>s.Reserved,reserved));}
        var before=await Detail(item.Variant);using var denied=await fixture.Admin.PutAsJsonAsync($"/api/admin/used-items/{item.Variant}/commands/{Id()}",new SaveUsedItemInput(before["variantVersion"]!.GetValue<string>(),Facts()));Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.False(await catalog.Set<UsedItemInspection>().AnyAsync(i=>i.VariantId==item.Variant));Assert.Null((await catalog.Variants.SingleAsync(v=>v.Id==item.Variant)).UsedInspectionId);var stock=await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(s=>s.VariantId==item.Variant);Assert.False(stock.IsSingleUnit);Assert.Equal(onHand,stock.OnHand);Assert.Equal(reserved,stock.Reserved);
    }
    [Fact]public async Task OrderKeepsHistoricalInspectionAndOldQuoteCannotBuyReinspectedDevice()
    {
        await fixture.Settings(max:2);var item=await fixture.Product(price:9007199254740993,stock:1);var original=Facts(87);await Save(item.Variant,original);var person=await fixture.Customer();using var client=person.Client;
        async Task<JsonNode> Quote(){var cart=await OrderFixture.Json(await client.GetAsync("/api/cart/en"));cart=await OrderFixture.Json(await client.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],cart["version"]?.GetValue<string>())));return await UsedItemWire.Body(await client.PostAsJsonAsync("/api/cart/en/quote",new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),item.Method,null,Guid.NewGuid().ToString())),"quote3-"+(await Detail(item.Variant))["inspection"]!["batteryHealthPercent"]!.GetValue<int>(),"quote3");}
        CreateOrderInput Input(JsonNode quote)=>new(quote["quoteId"]!.GetValue<string>(),Guid.NewGuid().ToString(),"QA customer","09121234567",new("IR","QA province","QA city","QA address long enough","1234567890"),"Synthetic SQL QA",true);
        var old=await Quote();Assert.Equal(original.InspectionId,old["lines"]![0]!["usedCondition"]!["inspectionId"]!.GetValue<string>());var current=Facts(0);await Save(item.Variant,current);using(var denied=await client.PostAsJsonAsync("/api/orders",Input(old)))Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);
        var quote=await Quote();var result=await UsedItemWire.Body(await client.PostAsJsonAsync("/api/orders",Input(quote)),"order1-created","order1-create",HttpStatusCode.Created);var order=result["order"]!;var orderId=order["summary"]!["id"]!.GetValue<string>();Assert.Equal(current.InspectionId,order["lines"]![0]!["usedCondition"]!["inspectionId"]!.GetValue<string>());Assert.Equal("9007199254740993",order["lines"]![0]!["unitPriceRial"]!.GetValue<string>());
        var canceled=await OrderFixture.Json(await client.PostAsJsonAsync($"/api/orders/{orderId}/cancel",new CancelOrderInput(order["summary"]!["version"]!.GetValue<string>())));await Save(item.Variant,Facts(99));
        foreach(var route in new[]{"/api/orders/","/api/orders/v2/"}){var read=await UsedItemWire.Body(await client.GetAsync(route+orderId),route.Contains("v2")?"order1-via2-history":"order1-history",route.Contains("v2")?"order2":"order1");Assert.Equal(current.InspectionId,read["lines"]![0]!["usedCondition"]!["inspectionId"]!.GetValue<string>());Assert.Equal(0,read["lines"]![0]!["usedCondition"]!["batteryHealthPercent"]!.GetValue<int>());}
    }
    [Fact]public async Task AuditFailureRollsBackCatalogStockAndReceiptAtomically()
    {
        var item=await fixture.Product(stock:1);var before=await Detail(item.Variant);var command=Id();var path=$"/api/admin/used-items/{item.Variant}/commands/{command}";var input=new SaveUsedItemInput(before["variantVersion"]!.GetValue<string>(),Facts());
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var identity=scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>();Assert.StartsWith("SaymanTest_",identity.Database.GetDbConnection().Database);var sql="ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT [CK_UsedAuditFailure] CHECK ([Resource]<>N'"+path+"')";await identity.Database.ExecuteSqlRawAsync(sql);}
        try{using var denied=await fixture.Admin.PutAsJsonAsync(path,input);Assert.Equal(HttpStatusCode.Conflict,denied.StatusCode);}finally{await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<Shop.Modules.Identity.IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT [CK_UsedAuditFailure]");}
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.Null((await catalog.Variants.SingleAsync(v=>v.Id==item.Variant)).UsedInspectionId);Assert.False(await catalog.Set<UsedItemInspection>().AnyAsync(i=>i.VariantId==item.Variant));Assert.False(await catalog.Set<UsedItemCommand>().AnyAsync(i=>i.CommandId==command));Assert.False((await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.SingleAsync(s=>s.VariantId==item.Variant)).IsSingleUnit);}
        Assert.False((await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync(path,input)))["replayed"]!.GetValue<bool>());
    }
}

using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.Mvc.Testing;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class OfflineCatalogSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private sealed class ForbiddenCommerceReads : IInventoryReader, IPurchaseConfiguration
    {
        public Task<IReadOnlyDictionary<string,int>> AvailableAsync(IEnumerable<string> ids,CancellationToken ct)=>throw new InvalidOperationException("Offline reads must not consult stock.");
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("Offline reads must not consult purchase methods.");
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("Offline reads must not consult credit plans.");
    }
    private WebApplicationFactory<Program> PublicOnlyFactory()=>fixture.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(services=>{
        services.RemoveAll<IInventoryReader>();services.RemoveAll<IPurchaseConfiguration>();var guard=new ForbiddenCommerceReads();services.AddSingleton<IInventoryReader>(guard);services.AddSingleton<IPurchaseConfiguration>(guard);
    }));
    private async Task ResetOwnedCatalogue()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);
        await db.Products.ExecuteUpdateAsync(s=>s.SetProperty(p=>p.Status,"Hidden"));await db.Categories.ExecuteUpdateAsync(s=>s.SetProperty(c=>c.IsActive,false));
    }
    private static Category Category(string id,int sort=0)=>new(){Id=id,Slug="cat-"+id,SortOrder=sort,IsActive=true,Translations=[new(){Locale="fa",Name="دستهٔ عمومی",Description="توضیح عمومی"}]};
    private static Product Product(string id,string category,string brand)=>new(){Id=id,Slug="product-"+id,CategoryId=category,BrandId=brand,Status="Published",CreatedAt=DateTimeOffset.Parse("2026-01-01T00:00:00Z"),Translations=[new(){Locale="fa",Name="نام عمومی",Description=new string('ت',900)}],Variants=[new(){Id="v"+id,Sku="SKU-"+id,PriceRial=long.MaxValue,WarrantyFa="private-warranty"}],Media=[new(){Url="https://private.example/image?signature=secret"}]};
    private static async Task<JsonNode> Json(HttpResponseMessage response)
    {
        using(response){Assert.True(response.IsSuccessStatusCode,await response.Content.ReadAsStringAsync());Assert.Contains("no-store",response.Headers.CacheControl!.ToString());Assert.DoesNotContain(response.Headers,h=>string.Equals(h.Key,"Set-Cookie",StringComparison.OrdinalIgnoreCase));return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;}
    }
    [Fact] public async Task PublicProjectionBoundsProductsAndEnforcesPublicationWithoutFinancialFields()
    {
        await ResetOwnedCatalogue();var key=Guid.NewGuid().ToString("N");var category="c"+key;var brand="b"+key;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();db.Categories.AddRange(Category(category),new Category{Id="inactive"+key,Slug="inactive-"+key,IsActive=false,Translations=[new(){Locale="fa",Name="غیرفعال"}]});db.Brands.AddRange(new Brand{Id=brand,Slug="brand-"+key,Name="Public brand"},new Brand{Id="inactive"+brand,Slug="inactive-brand-"+key,Name="Inactive brand",IsActive=false});
            for(var i=0;i<205;i++)db.Products.Add(Product(key+i.ToString("D3"),category,brand));
            var draft=Product(key+"draft",category,brand);draft.Status="Draft";
            var future=Product(key+"future",category,brand);future.PublishAt=DateTimeOffset.UtcNow.AddDays(2);
            var disabled=Product(key+"disabled",category,brand);disabled.Variants[0].IsActive=false;
            db.Products.AddRange(draft,future,disabled,Product(key+"brand",category,"inactive"+brand),Product(key+"category","inactive"+key,brand));await db.SaveChangesAsync();
        }
        await using var publicFactory=PublicOnlyFactory();using var client=publicFactory.CreateClient(new(){HandleCookies=false});
        var data=await Json(await client.GetAsync("/api/catalog/en/offline"));Assert.Equal(200,data["products"]!.AsArray().Count);Assert.True(data["truncated"]!.GetValue<bool>());Assert.Equal("en",data["locale"]!.GetValue<string>());Assert.True(data["isPreview"]!.GetValue<bool>());
        foreach(var product in data["products"]!.AsArray()){
            Assert.Equal("نام عمومی",product!["name"]!.GetValue<string>());Assert.Equal(800,product["description"]!.GetValue<string>().Length);Assert.Equal(category,product["category"]!.GetValue<string>());Assert.Null(product["image"]);
            foreach(var forbidden in new[]{"priceRial","stock","variants","warranty","purchaseMethodIds","sellerId","attributes"})Assert.Null(product[forbidden]);
        }
        var all=await Json(await client.GetAsync("/api/catalog/fa/offline?limit=500"));Assert.Equal(205,all["products"]!.AsArray().Count);Assert.False(all["truncated"]!.GetValue<bool>());Assert.DoesNotContain("private-warranty",all.ToJsonString());Assert.DoesNotContain("signature",all.ToJsonString());Assert.DoesNotContain(long.MaxValue.ToString(),all.ToJsonString());
        Assert.Equal(data["products"]![0]!["id"]!.GetValue<string>(),all["products"]![0]!["id"]!.GetValue<string>());
    }
    [Fact] public async Task CategoryProjectionIsCappedAndProductsCannotReferenceOmittedCategories()
    {
        await ResetOwnedCatalogue();var key=Guid.NewGuid().ToString("N");var first="c000"+key;var omitted="c500"+key;var brand="b"+key;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();for(var i=0;i<501;i++)db.Categories.Add(Category("c"+i.ToString("D3")+key,i));db.Brands.Add(new(){Id=brand,Slug="brand-"+key,Name="Public brand"});
            var included=Product(key+"included",first,brand);included.Media[0].Url="/media/catalog/"+new string('a',32)+"/zoom.webp";db.Products.AddRange(included,Product(key+"omitted",omitted,brand));await db.SaveChangesAsync();
        }
        await using var publicFactory=PublicOnlyFactory();using var client=publicFactory.CreateClient(new(){HandleCookies=false});var data=await Json(await client.GetAsync("/api/catalog/fa/offline?limit=1"));Assert.Equal(500,data["categories"]!.AsArray().Count);Assert.True(data["truncated"]!.GetValue<bool>());var product=Assert.Single(data["products"]!.AsArray());Assert.Equal(first,product!["category"]!.GetValue<string>());Assert.Equal("/media/catalog/"+new string('a',32)+"/thumb.webp",product["image"]!.GetValue<string>());Assert.DoesNotContain(data["categories"]!.AsArray(),c=>c!["key"]!.GetValue<string>()==omitted);
    }
}

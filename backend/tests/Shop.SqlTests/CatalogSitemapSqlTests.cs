using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class CatalogSitemapSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private sealed class NoCommerce : IInventoryReader,IPurchaseConfiguration
    {
        public Task<IReadOnlyDictionary<string,int>> AvailableAsync(IEnumerable<string> ids,CancellationToken ct)=>throw new InvalidOperationException("Sitemap must not read inventory.");
        public Task<IReadOnlyList<PurchaseMethodData>> MethodsAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("Sitemap must not read finance.");
        public Task<IReadOnlyList<CreditPlanData>> PlansAsync(string locale,CancellationToken ct)=>throw new InvalidOperationException("Sitemap must not read credit.");
    }
    private WebApplicationFactory<Program> PublicFactory()=>fixture.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IInventoryReader>();s.RemoveAll<IPurchaseConfiguration>();var guard=new NoCommerce();s.AddSingleton<IInventoryReader>(guard);s.AddSingleton<IPurchaseConfiguration>(guard);}));
    private async Task Prepare()
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();Assert.StartsWith("SaymanTest_",db.Database.GetDbConnection().Database);await db.Products.ExecuteUpdateAsync(s=>s.SetProperty(p=>p.Status,"Hidden"));await db.Categories.ExecuteUpdateAsync(s=>s.SetProperty(c=>c.IsActive,false));
        var cms=scope.ServiceProvider.GetRequiredService<CmsDbContext>();foreach(var doc in await cms.Documents.Where(d=>d.Key=="site").ToListAsync()){var value=JsonNode.Parse(doc.PublishedJson!)!.AsObject();value["seo"]=new JsonObject{["allowIndexing"]=true};doc.PublishedJson=value.ToJsonString();}await cms.SaveChangesAsync();
    }
    private static Category Category(string id,bool english=true)=>new(){Id=id,Slug="category-"+id,Translations=english?[new(){Locale="fa",Name="دستهٔ نقشه"},new(){Locale="en",Name="Sitemap category"}]:[new(){Locale="fa",Name="دستهٔ فارسی"}]};
    private static async Task<JsonNode> Json(HttpResponseMessage response){using(response){Assert.True(response.IsSuccessStatusCode,await response.Content.ReadAsStringAsync());Assert.Contains("no-store",response.Headers.CacheControl!.ToString());return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;}}
    [Fact] public async Task ProductCountsAndPagesCoverBoundaryAndOnlyRealTranslationsWithoutCommerceReads()
    {
        await Prepare();var key=Guid.NewGuid().ToString("N");var category="c"+key;var brand="b"+key;
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();db.Categories.Add(Category(category));db.Brands.Add(new(){Id=brand,Slug="brand-"+key,Name="Sitemap brand"});
            for(var i=0;i<1001;i++)db.Products.Add(new(){Id=key+i.ToString("D4"),Slug="product-"+key+"-"+i.ToString("D4"),CategoryId=category,BrandId=brand,Status="Published",Translations=i<1000?[new(){Locale="fa",Name="کالای عمومی"},new(){Locale="en",Name="Public product"}]:[new(){Locale="fa",Name="فقط فارسی"}],Variants=[new(){Id="v"+key+i,Sku="SITEMAP-"+key+"-"+i,PriceRial=long.MaxValue,WarrantyFa="must-not-be-returned"}]});
            db.Products.Add(new(){Id=key+"future",Slug="future-"+key,CategoryId=category,BrandId=brand,Status="Published",PublishAt=DateTimeOffset.UtcNow.AddDays(1),Translations=[new(){Locale="fa",Name="آینده"},new(){Locale="en",Name="Future"}],Variants=[new(){Sku="FUTURE-"+key}]});await db.SaveChangesAsync();
        }
        await using var factory=PublicFactory();using var client=factory.CreateClient(new(){HandleCookies=false});
        var fa=await Json(await client.GetAsync("/api/catalog/fa/sitemap"));var en=await Json(await client.GetAsync("/api/catalog/en/sitemap"));Assert.Equal("1001",fa["productCount"]!.GetValue<string>());Assert.Equal("1000",en["productCount"]!.GetValue<string>());Assert.True(fa["isPreview"]!.GetValue<bool>());
        var first=await Json(await client.GetAsync("/api/catalog/fa/sitemap/products?page=1"));var last=await Json(await client.GetAsync("/api/catalog/fa/sitemap/products?page=2"));Assert.Equal(1000,first["items"]!.AsArray().Count);var row=Assert.Single(last["items"]!.AsArray());Assert.True(row!["fa"]!.GetValue<bool>());Assert.False(row["en"]!.GetValue<bool>());Assert.DoesNotContain(first["items"]!.AsArray(),r=>r!["key"]!.GetValue<string>()==row["key"]!.GetValue<string>());
        foreach(var value in new[]{first,last}){Assert.DoesNotContain("priceRial",value.ToJsonString());Assert.DoesNotContain("must-not-be-returned",value.ToJsonString());Assert.DoesNotContain("description",value.ToJsonString());}
        Assert.Empty((await Json(await client.GetAsync("/api/catalog/en/sitemap/products?page=2")))["items"]!.AsArray());
    }
    [Fact] public async Task CategoriesBeyondOnePageRemainDiscoverableAndMissingTranslationsHaveNoAlternate()
    {
        await Prepare();var key=Guid.NewGuid().ToString("N");await using(var scope=fixture.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();for(var i=0;i<1001;i++)db.Categories.Add(Category("c"+i.ToString("D4")+key,i<1000));var inactive=Category("inactive"+key);inactive.IsActive=false;db.Categories.Add(inactive);await db.SaveChangesAsync();}
        await using var factory=PublicFactory();using var client=factory.CreateClient(new(){HandleCookies=false});var fa=await Json(await client.GetAsync("/api/catalog/fa/sitemap"));var en=await Json(await client.GetAsync("/api/catalog/en/sitemap"));Assert.Equal("1001",fa["categoryCount"]!.GetValue<string>());Assert.Equal("1000",en["categoryCount"]!.GetValue<string>());Assert.Equal("0",fa["productCount"]!.GetValue<string>());
        var first=await Json(await client.GetAsync("/api/catalog/fa/sitemap/categories?page=1"));var second=await Json(await client.GetAsync("/api/catalog/fa/sitemap/categories?page=2"));Assert.Equal(1000,first["items"]!.AsArray().Count);var row=Assert.Single(second["items"]!.AsArray());Assert.False(row!["en"]!.GetValue<bool>());Assert.Equal("c1000"+key,row["key"]!.GetValue<string>());Assert.Empty((await Json(await client.GetAsync("/api/catalog/en/sitemap/categories?page=2")))["items"]!.AsArray());
    }
}

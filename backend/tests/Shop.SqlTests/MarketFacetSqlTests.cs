using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class MarketFacetSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private readonly string prefix="facet"+Guid.NewGuid().ToString("N")[..12];
    private async Task Seed(int count,bool separateCategories=false)
    {
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();
        var catalog=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();
        for(var i=0;i<count;i++){
            var key=prefix+i.ToString("D3");var category=separateCategories?key+"c":prefix+"c";
            if(separateCategories||i==0)catalog.Categories.Add(new(){Id=category,Slug=category,Translations=[new(){Locale="fa",Name="دسته نمونه "+key},new(){Locale="en",Name="Sample category "+key}]});
            catalog.Brands.Add(new(){Id=key+"b",Slug=key+"b",Name="Sample brand "+i});
            catalog.Products.Add(new(){Id=key+"p",CategoryId=category,BrandId=key+"b",Slug=key,Translations=[new(){Locale="fa",Name="گوشی نمونه ۱۲ "+prefix},new(){Locale="en",Name="Sample phone 12 "+prefix}],Media=[new(){Url="/products/phone-green.svg"}]});
            market.Listings.Add(new(){Id=key+"l",ModelId=key+"p",Status="Published",SourceKey="qa-facets",SourceItemKey=key,SourceNameFa="منبع نمونه",SourceNameEn="Sample source",IsDemo=true});
        }
        await catalog.SaveChangesAsync();await market.SaveChangesAsync();
    }
    private static async Task<JsonNode> Capture(HttpResponseMessage response,string name,string kind="facets")
    {
        using(response){var bytes=await response.Content.ReadAsByteArrayAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}: {System.Text.Encoding.UTF8.GetString(bytes)}");Assert.Contains("no-store",response.Headers.CacheControl!.ToString());
            if(Environment.GetEnvironmentVariable("SHOP_MARKET_FACET_WIRE_DIR") is {Length:>0} dir){Assert.True(Path.IsPathFullyQualified(dir));Directory.CreateDirectory(dir);using(var f=new FileStream(Path.Combine(dir,name+".json"),FileMode.CreateNew))f.Write(bytes);var path=Path.Combine(dir,"manifest.json");var entries=File.Exists(path)?JsonNode.Parse(File.ReadAllText(path))!["entries"]!.AsArray():new JsonArray();entries.Add(new JsonObject{["file"]=name+".json",["kind"]=kind,["sha256"]=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()});File.WriteAllText(path,new JsonObject{["actualSqlHttpBodies"]=true,["entries"]=entries.DeepClone()}.ToJsonString(new(){WriteIndented=true}));}
            return JsonNode.Parse(bytes)!;}
    }
    private async Task<JsonNode> Facets(MarketSearchInput input,string name,string locale="fa")=>await Capture(await fixture.Writer.PostAsJsonAsync("/api/market/"+locale+"/facets",input),name);
    [Fact] public async Task FacetsUseAllMatchingModelsAndIgnoreOnlyTheirOwnSelection()
    {
        await Seed(3,true);
        var all=await Facets(new(Query:prefix,Page:2,PageSize:1),"all-paged");Assert.Equal(3,all["brands"]!.AsArray().Count);Assert.Equal(3,all["categories"]!.AsArray().Count);Assert.Null(all["scope"]!["brandId"]);Assert.Null(all["scope"]!["categoryId"]);
        var scoped=await Facets(new(Query:prefix,CategoryId:prefix+"000c",BrandId:prefix+"001b"),"disjoint-filters","en");Assert.Single(scoped["categories"]!.AsArray());Assert.Equal(prefix+"001c",scoped["categories"]![0]!["id"]!.GetValue<string>());Assert.Single(scoped["brands"]!.AsArray());Assert.Equal(prefix+"000b",scoped["brands"]![0]!["id"]!.GetValue<string>());
        var empty=await Facets(new(Query:prefix,CategoryId:prefix+"000c",BrandId:prefix+"001b",PageSize:1),"same-filter-facets");Assert.Equal(scoped["brands"]!.ToJsonString(),empty["brands"]!.ToJsonString());
        var page=await Capture(await fixture.Writer.PostAsJsonAsync("/api/market/fa/search",new MarketSearchInput(Query:prefix,CategoryId:prefix+"000c",BrandId:prefix+"001b")),"disjoint-page","page");Assert.Empty(page["items"]!.AsArray());Assert.Equal(0,page["total"]!.GetValue<int>());
        var normalized=await Facets(new(Query:"گوشي 12 "+prefix),"normalized");Assert.Equal(all["brands"]!.ToJsonString(),normalized["brands"]!.ToJsonString());
    }
    [Fact] public async Task FacetsExcludeDraftHiddenInactiveDigitalAndAvailableStoreModelsAndDemoOutsideDevelopment()
    {
        await Seed(8);
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();
            var p=await db.Products.Where(p=>p.Id.StartsWith(prefix)).OrderBy(p=>p.Id).ToArrayAsync();
            (await market.Listings.SingleAsync(l=>l.ModelId==p[1].Id)).Status="Draft";
            (await market.Listings.SingleAsync(l=>l.ModelId==p[2].Id)).Status="Hidden";
            p[3].Status="Hidden";p[4].IsDigital=true;
            (await db.Brands.SingleAsync(b=>b.Id==p[5].BrandId)).IsActive=false;
            var inactive=prefix+"inactive";db.Categories.Add(new(){Id=inactive,Slug=inactive,IsActive=false,Translations=[new(){Locale="fa",Name="غیرفعال"},new(){Locale="en",Name="Inactive"}]});p[6].CategoryId=inactive;
            p[7].Status="Published";var variant=new ProductVariant{Id=prefix+"v",Sku=prefix+"sku",PriceRial=12345};p[7].Variants.Add(variant);await db.SaveChangesAsync();await market.SaveChangesAsync();
            var stock=scope.ServiceProvider.GetRequiredService<InventoryDbContext>();stock.Stock.Add(new(){VariantId=variant.Id,OnHand=1});await stock.SaveChangesAsync();
        }
        var facets=await Facets(new(Query:prefix),"eligibility");Assert.Single(facets["brands"]!.AsArray());Assert.Equal(prefix+"000b",facets["brands"]![0]!["id"]!.GetValue<string>());Assert.Equal(1,facets["categories"]![0]!["count"]!.GetValue<int>());
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();var production=new MarketService(check.ServiceProvider.GetRequiredService<MarketDbContext>(),check.ServiceProvider.GetRequiredService<IMarketModelCatalog>(),TimeProvider.System,false);var hidden=await production.FacetsAsync("en",new(Query:prefix),CancellationToken.None);Assert.Empty(hidden.Brands);Assert.Empty(hidden.Categories);
    }
    [Fact] public async Task BothFacetListsAreBoundedAndKeepTheSelectedEligibleOptionBeyondTheLimit()
    {
        await Seed(205,true);
        var all=await Facets(new(Query:prefix),"bounded");Assert.Equal(200,all["brands"]!.AsArray().Count);Assert.True(all["moreBrands"]!.GetValue<bool>());Assert.Equal(200,all["categories"]!.AsArray().Count);Assert.True(all["moreCategories"]!.GetValue<bool>());
        var selected=await Facets(new(Query:prefix,BrandId:prefix+"204b"),"selected-last");Assert.Equal(prefix+"204b",selected["brands"]![0]!["id"]!.GetValue<string>());Assert.Single(selected["categories"]!.AsArray());Assert.False(selected["moreCategories"]!.GetValue<bool>());
        var category=await Facets(new(Query:prefix,CategoryId:prefix+"204c"),"selected-last-category");Assert.Equal(prefix+"204c",category["categories"]![0]!["id"]!.GetValue<string>());Assert.Single(category["brands"]!.AsArray());
    }
    [Fact] public async Task AdminBrandFilterBindsItsCursorAndPublicFacetsRejectUnboundedOrPrivateFields()
    {
        await Seed(2);
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var market=scope.ServiceProvider.GetRequiredService<MarketDbContext>();
            for(var i=2;i<53;i++){var key=prefix+i.ToString("D3");db.Products.Add(new(){Id=key+"p",CategoryId=prefix+"c",BrandId=prefix+"000b",Slug=key,Translations=[new(){Locale="fa",Name=prefix},new(){Locale="en",Name=prefix}]});market.Listings.Add(new(){Id=key+"l",ModelId=key+"p",SourceKey="qa-facets",SourceItemKey=key,SourceNameFa="نمونه",SourceNameEn="Sample",IsDemo=true});}await db.SaveChangesAsync();await market.SaveChangesAsync();
        }
        var path="/api/admin/market?query="+prefix+"&brandId="+prefix+"000b";
        var first=await Capture(await fixture.Content.GetAsync(path),"admin-brand-page","adminPage");Assert.Equal(50,first["items"]!.AsArray().Count);var cursor=Uri.EscapeDataString(first["nextCursor"]!.GetValue<string>());
        var second=await Capture(await fixture.Content.GetAsync(path+"&cursor="+cursor),"admin-brand-next","adminPage");Assert.Equal(2,second["items"]!.AsArray().Count);
        Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Content.GetAsync("/api/admin/market?query="+prefix+"&cursor="+cursor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Content.GetAsync("/api/admin/market?query="+prefix+"&brandId="+prefix+"001b&cursor="+cursor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await fixture.Content.GetAsync("/api/admin/market?brandId=bad%2Fid")).StatusCode);
        using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync(path)).StatusCode);
        foreach(var input in new object[]{new{PageSize=25},new{Stock=1},new{Query=new string('x',121)},new{BrandId="bad/id"}})Assert.Equal(HttpStatusCode.BadRequest,(await anonymous.PostAsJsonAsync("/api/market/fa/facets",input)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await anonymous.PostAsJsonAsync("/api/market/en/facets",new MarketSearchInput(Query:prefix))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await anonymous.PostAsJsonAsync("/api/market/de/facets",new{})).StatusCode);
    }
}

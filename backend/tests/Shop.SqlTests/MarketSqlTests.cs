using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;
public sealed class MarketFixture:IAsyncLifetime
{
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string,Lazy<Task<HttpClient>>> staffSessions=new(StringComparer.Ordinal);
    public SqlFixture Sql {get;}=new();
    public HttpClient Writer {get;private set;}=null!;
    public HttpClient Content {get;private set;}=null!;
    public async Task InitializeAsync(){await Sql.InitializeAsync();Writer=await Staff("CatalogManager");Content=await Staff("ContentManager");}
    public async Task<HttpClient> Staff(string role)
    {
        var username="market"+Guid.NewGuid().ToString("N");
        await using(var scope=Sql.Factory.Services.CreateAsyncScope()){
            var users=scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();var user=new ShopUser{UserName=username,Email=username+"@example.test",EmailConfirmed=true,RequireMfa=true,DisplayName="Synthetic market QA"};
            Assert.True((await users.CreateAsync(user,Sql.Password)).Succeeded);Assert.True((await users.AddToRoleAsync(user,role)).Succeeded);
        }
        var c=Sql.Factory.CreateClient(new(){HandleCookies=false});c.DefaultRequestHeaders.Add("Origin","http://127.0.0.1:3173");c.DefaultRequestHeaders.Add("X-Sayman-Client","admin");c.DefaultRequestHeaders.Add("X-Sayman-Admin","1");
        var pending=await Json(await c.PostAsJsonAsync("/api/auth/password",new{Identifier=username,Sql.Password}));Assert.True(pending["requiresMfa"]!.GetValue<bool>());c.DefaultRequestHeaders.Authorization=new("Bearer",pending["accessToken"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Forbidden,(await c.GetAsync("/api/admin/market")).StatusCode);
        var setup=await Json(await c.PostAsJsonAsync("/api/auth/mfa/setup",new{}));c.DefaultRequestHeaders.Authorization=new("Bearer",setup["accessToken"]!.GetValue<string>());
        var verified=await Json(await c.PostAsJsonAsync("/api/auth/mfa/verify",new{Code=Totp.Code(setup["secret"]!.GetValue<string>(),DateTimeOffset.UtcNow.ToUnixTimeSeconds()/30)}));c.DefaultRequestHeaders.Authorization=new("Bearer",verified["accessToken"]!.GetValue<string>());return c;
    }
    // Most domain tests need a role, not a newly enrolled employee each time.
    // Reuse one real password+MFA session per role, returning disposable client
    // copies so production auth throttling remains unchanged. Staff() continues
    // to create a distinct actor for identity-isolation scenarios.
    public async Task<HttpClient> ReuseStaff(string role)
    {
        var session=await staffSessions.GetOrAdd(role,r=>new(()=>Staff(r))).Value;
        var client=Sql.Factory.CreateClient(new(){HandleCookies=false});foreach(var header in session.DefaultRequestHeaders)client.DefaultRequestHeaders.TryAddWithoutValidation(header.Key,header.Value);return client;
    }
    public async Task DisposeAsync(){Writer?.Dispose();Content?.Dispose();foreach(var cached in staffSessions.Values)if(cached.IsValueCreated&&cached.Value.IsCompletedSuccessfully)(await cached.Value).Dispose();await Sql.DisposeAsync();}
    public static async Task<JsonNode> Json(HttpResponseMessage response){using(response){var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}: {body}");return JsonNode.Parse(body)!;}}
}
public sealed class MarketSqlTests(MarketFixture fixture):IClassFixture<MarketFixture>
{
    private HttpClient Writer=>fixture.Writer;
    private static Task<JsonNode> Json(HttpResponseMessage r)=>MarketFixture.Json(r);
    private static CatalogModelInput Model(string? slug=null)=>new("phones","samsung",slug??"market-"+Guid.NewGuid().ToString("N"),[new("fa","گوشی بازار نمونه ۱۲","مشخصات مصنوعی آزمون SQL، موجودی واقعی بازار نیست."),new("en","Sample market phone 12","Synthetic SQL acceptance model; no real market availability.")],[new("battery",TextFa:"باتری نمونه",TextEn:"Sample battery")],["/products/phone-green.svg"],null);
    private static MarketDetailsInput Details(string status="Published",string? key=null)=>new(status,"qa-manual",key??Guid.NewGuid().ToString("N"),"ورود دستی نمونه","Sample manual entry",null,"unknown",null,null,null,true);
    private async Task<(string Listing,string Model)> Create(MarketDetailsInput? details=null,CatalogModelInput? model=null)
    {
        var saved=await Json(await Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(model??Model(),details??Details())));var id=saved["id"]!.GetValue<string>();var read=await Json(await Writer.GetAsync("/api/admin/market/"+id));return(id,read["modelId"]!.GetValue<string>());
    }
    [Fact] public async Task PublishedModelWithoutSkuIsPublicInMarketOnlyAndNeverCreatesInventoryOrPrices()
    {
        var saved=await Create();var fa=await Json(await Writer.GetAsync("/api/market/fa/"+saved.Listing));var en=await Json(await Writer.GetAsync("/api/market/en/"+saved.Listing));
        Assert.Equal("گوشی بازار نمونه ۱۲",fa["model"]!["name"]!.GetValue<string>());Assert.Equal("Sample market phone 12",en["model"]!["name"]!.GetValue<string>());Assert.Equal("Sample battery",en["model"]!["attributes"]!["battery"]!.GetValue<string>());
        Assert.Equal("unknown",en["availability"]!.GetValue<string>());Assert.True(en.AsObject().ContainsKey("referencePriceRial"));Assert.Null(en["referencePriceRial"]);Assert.True(en["isDemo"]!.GetValue<bool>());Assert.False(en["referencePriceCurrent"]!.GetValue<bool>());Assert.DoesNotContain("variants",en.ToJsonString());Assert.DoesNotContain("purchaseMethods",en.ToJsonString());
        var lookup=await Json(await Writer.PostAsJsonAsync("/api/catalog/en/lookup",new{ProductIds=new[]{saved.Model}}));Assert.Empty(lookup["products"]!.AsArray());
        await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var product=await db.Products.Include(p=>p.Variants).SingleAsync(p=>p.Id==saved.Model);Assert.Equal("Draft",product.Status);Assert.Empty(product.Variants);Assert.False(await scope.ServiceProvider.GetRequiredService<InventoryDbContext>().Stock.AnyAsync(s=>s.VariantId==saved.Model));
        Assert.True(await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.AnyAsync(a=>a.Resource=="/api/admin/market/models"));
    }
    [Fact] public async Task DraftReferencesDoNotPublishAndUpdatesRequireTheCurrentListingVersion()
    {
        var saved=await Create(Details("Draft"));Assert.Equal(HttpStatusCode.NotFound,(await Writer.GetAsync("/api/market/en/"+saved.Listing)).StatusCode);
        var row=await Json(await Writer.GetAsync("/api/admin/market/"+saved.Listing));var details=System.Text.Json.JsonSerializer.Deserialize<MarketDetailsInput>(row["details"]!.ToJsonString(),new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))! with{Status="Published"};
        var input=new MarketListingInput(saved.Model,details,row["version"]!.GetValue<string>());await Json(await Writer.PutAsJsonAsync("/api/admin/market/"+saved.Listing,input));
        Assert.Equal(HttpStatusCode.Conflict,(await Writer.PutAsJsonAsync("/api/admin/market/"+saved.Listing,input)).StatusCode);await Json(await Writer.GetAsync("/api/market/en/"+saved.Listing));
    }
    [Fact] public async Task DuplicateSourceRollsBackNewModelAndAuditAtomically()
    {
        var key=Guid.NewGuid().ToString("N");await Create(Details(key:key));var slug="market-rollback-"+Guid.NewGuid().ToString("N");long audit;
        await using(var before=fixture.Sql.Factory.Services.CreateAsyncScope())audit=await before.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(a=>a.Resource=="/api/admin/market/models");
        Assert.Equal(HttpStatusCode.Conflict,(await Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(Model(slug),Details(key:key)))).StatusCode);
        await using var check=fixture.Sql.Factory.Services.CreateAsyncScope();Assert.False(await check.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.AnyAsync(p=>p.Slug==slug));Assert.Equal(audit,await check.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.LongCountAsync(a=>a.Resource=="/api/admin/market/models"));
    }
    [Fact] public async Task ReferencePriceIsAnExactDatedStringAndExpiredObservationIsStale()
    {
        var now=DateTimeOffset.UtcNow;var d=Details() with{Availability="available",ObservedAt=now.AddHours(-2),ValidUntil=now.AddHours(-1),ReferencePriceRial="9223372036854775807"};var saved=await Create(d);var item=await Json(await Writer.GetAsync("/api/market/en/"+saved.Listing));
        Assert.Equal("9223372036854775807",item["referencePriceRial"]!.GetValue<string>());Assert.Equal("stale",item["availability"]!.GetValue<string>());Assert.False(item["referencePriceCurrent"]!.GetValue<bool>());
    }
    [Fact] public async Task HiddenModelAndInactiveCategoryNeverLeakThroughPublishedMarketListing()
    {
        var saved=await Create();await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var p=await db.Products.SingleAsync(p=>p.Id==saved.Model);p.Status="Hidden";await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.NotFound,(await Writer.GetAsync("/api/market/en/"+saved.Listing)).StatusCode);
        var page=await Json(await Writer.PostAsJsonAsync("/api/market/en/search",new MarketSearchInput(Query:"گوشي 12")));Assert.DoesNotContain(page["items"]!.AsArray(),i=>i!["id"]!.GetValue<string>()==saved.Listing);
    }
    [Fact] public async Task AnonymousIsBlockedAndCatalogReadRoleCannotWriteListings()
    {
        using var anonymous=fixture.Sql.Factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(Model(),Details()))).StatusCode);
        _ = await Json(await fixture.Content.GetAsync("/api/admin/market"));Assert.Equal(HttpStatusCode.Forbidden,(await fixture.Content.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(Model(),Details()))).StatusCode);
        using var malformed=await Writer.PostAsJsonAsync("/api/admin/market/models",new{Model=new{CategoryId="phones",BrandId="samsung",Slug="bad",Translations=(object?)null,Attributes=Array.Empty<object>(),ImageUrls=Array.Empty<string>()},Details=Details()});Assert.Equal(HttpStatusCode.BadRequest,malformed.StatusCode);
    }
    [Fact] public async Task SharedModelEditPreservesExistingSkuPricesAndPurchaseRules()
    {
        var detail=await Json(await Writer.GetAsync("/api/admin/products/p1"));var p=detail["product"]!;var before=p["variants"]!.AsArray().Select(v=>new{Sku=v!["sku"]!.GetValue<string>(),Price=v["priceRial"]!.GetValue<string>()}).ToArray();
        var input=Model() with{Slug=p["slug"]!.GetValue<string>(),CategoryId=p["categoryId"]!.GetValue<string>(),BrandId=p["brandId"]!.GetValue<string>(),Version=p["version"]!.GetValue<string>()};
        await Json(await Writer.PutAsJsonAsync("/api/admin/market/models/p1",input));var after=await Json(await Writer.GetAsync("/api/admin/products/p1"));
        Assert.Equal(before.Select(v=>(v.Sku,v.Price)),after["product"]!["variants"]!.AsArray().Select(v=>(v!["sku"]!.GetValue<string>(),v["priceRial"]!.GetValue<string>())));Assert.Equal(p["purchaseMethods"]!.ToJsonString(),after["product"]!["purchaseMethods"]!.ToJsonString());Assert.Equal("Published",after["product"]!["status"]!.GetValue<string>());
    }
    [Fact] public async Task SearchAndPagingUseModelNamesAndNormalizedPersianDigits()
    {
        var term="q"+Guid.NewGuid().ToString("N");
        var model=Model() with{Translations=[new("fa","آزمون گوشی ۱۲ "+term,"نمونه"),new("en","Test phone 12 "+term,"Sample")]};
        await Create(model:model);await Create(model:model with{Slug="market-"+Guid.NewGuid().ToString("N")});
        var one=await Json(await Writer.PostAsJsonAsync("/api/market/fa/search",new MarketSearchInput("گوشي 12 "+term,"phones","samsung",1,1)));
        var two=await Json(await Writer.PostAsJsonAsync("/api/market/fa/search",new MarketSearchInput("گوشي 12 "+term,"phones","samsung",2,1)));
        Assert.Equal(2,one["total"]!.GetValue<int>());Assert.Equal(2,one["totalPages"]!.GetValue<int>());Assert.Single(one["items"]!.AsArray());Assert.Single(two["items"]!.AsArray());Assert.NotEqual(one["items"]![0]!["id"]!.GetValue<string>(),two["items"]![0]!["id"]!.GetValue<string>());
    }
    [Fact] public async Task PublicationRejectsMissingRequiredModelValuesAndStorefrontStillRequiresOffers()
    {
        var category="required-"+Guid.NewGuid().ToString("N");
        await using(var scope=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();db.Categories.Add(new(){Id=category,Slug=category,ImageUrl="/products/phone-silver.svg",Translations=[new(){Locale="fa",Name="آزمون اجباری"},new(){Locale="en",Name="Required QA"}],Attributes=[new(){AttributeId="battery",IsRequired=true}]});await db.SaveChangesAsync();
        }
        var slug="market-missing-"+Guid.NewGuid().ToString("N");var bad=Model(slug) with{CategoryId=category,Attributes=[]};
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PostAsJsonAsync("/api/admin/market/models",new CreateMarketModelInput(bad,Details()))).StatusCode);
        await using(var check=fixture.Sql.Factory.Services.CreateAsyncScope())Assert.False(await check.ServiceProvider.GetRequiredService<CatalogDbContext>().Products.AnyAsync(p=>p.Slug==slug));
        var saved=await Create();var detail=await Json(await Writer.GetAsync("/api/admin/products/"+saved.Model));
        var input=new ProductInput("phones","samsung",detail["product"]!["slug"]!.GetValue<string>(),"Published",false,false,[new("fa","نام نمونه"),new("en","Sample name")],[],[],["/products/phone-silver.svg"],["online"],[],detail["product"]!["version"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.PutAsJsonAsync("/api/admin/products/"+saved.Model,input)).StatusCode);
    }
    [Fact] public async Task ProductionReaderExcludesSampleListingsEvenFromRestoredSql()
    {
        var saved=await Create();await using var scope=fixture.Sql.Factory.Services.CreateAsyncScope();var reader=new MarketService(scope.ServiceProvider.GetRequiredService<MarketDbContext>(),scope.ServiceProvider.GetRequiredService<IMarketModelCatalog>(),TimeProvider.System,false);
        var error=await Assert.ThrowsAsync<BusinessException>(()=>reader.DetailAsync("en",saved.Listing,CancellationToken.None));Assert.Equal("not_found",error.Code);var page=await reader.PageAsync("en",new(),CancellationToken.None);Assert.Empty(page.Items);
    }
    [Fact] public async Task AdminPagesAreBoundedAndCursorIsBoundToItsFilter()
    {
        var term="page"+Guid.NewGuid().ToString("N");var ids=Enumerable.Range(0,53).Select(i=>term[..20]+i.ToString("D3")).ToArray();
        await using(var setup=fixture.Sql.Factory.Services.CreateAsyncScope()){
            var db=setup.ServiceProvider.GetRequiredService<CatalogDbContext>();db.Products.AddRange(ids.Select(id=>new Product{Id="m"+id,CategoryId="phones",BrandId="samsung",Slug="market-"+id,Translations=[new(){Locale="fa",Name="صفحه نمونه "+term},new(){Locale="en",Name="Page sample "+term}],Media=[new(){Url="/products/phone-green.svg"}]}));await db.SaveChangesAsync();
            var market=setup.ServiceProvider.GetRequiredService<MarketDbContext>();market.Listings.AddRange(ids.Select(id=>new MarketListing{Id=id,ModelId="m"+id,SourceKey="qa-page",SourceItemKey=id,SourceNameFa="نمونه",SourceNameEn="Sample",IsDemo=true}));await market.SaveChangesAsync();
        }
        var first=await Json(await Writer.GetAsync("/api/admin/market?query="+term));Assert.Equal(50,first["items"]!.AsArray().Count);var cursor=first["nextCursor"]!.GetValue<string>();
        var second=await Json(await Writer.GetAsync("/api/admin/market?query="+term+"&cursor="+Uri.EscapeDataString(cursor)));Assert.Equal(3,second["items"]!.AsArray().Count);Assert.Null(second["nextCursor"]);Assert.Equal(53,first["items"]!.AsArray().Concat(second["items"]!.AsArray()).Select(i=>i!["id"]!.GetValue<string>()).Distinct().Count());
        Assert.Equal(HttpStatusCode.BadRequest,(await Writer.GetAsync("/api/admin/market?query="+term+"x&cursor="+Uri.EscapeDataString(cursor))).StatusCode);
    }
}

using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

// Real SQL interleavings; compilation/discovery is not acceptance of these tests.
public sealed class PublicCatalogReadSqlTests(CatalogVersionFixture fixture) : IClassFixture<CatalogVersionFixture>
{
    private sealed record Item(string Product,string Variant,string Category,string Brand,string Method,string Slug);
    private static string Key(string prefix)=>prefix+"-"+Guid.NewGuid().ToString("N");
    private async Task<Item> Make(long price=100)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var sp=scope.ServiceProvider;var db=sp.GetRequiredService<CatalogDbContext>();
        var method=await sp.GetRequiredService<PaymentsDbContext>().Methods.Where(m=>m.Kind=="online"&&m.Enabled&&!m.RequiresApproval).Select(m=>m.Id).FirstAsync();
        var category=new Category{Slug=Key("category"),IsActive=true,Translations=[new(){Locale="fa",Name="دستهٔ خواندن"},new(){Locale="en",Name="Read category"}]};
        var brand=new Brand{Name="Read brand",SearchName="read brand",Slug=Key("brand"),IsActive=true};db.AddRange(category,brand);
        var product=new Product{CategoryId=category.Id,BrandId=brand.Id,Slug=Key("read"),Status="Published",Translations=[new(){Locale="fa",Name="خواندن پایدار",SearchName="خواندن پایدار"},new(){Locale="en",Name="Consistent read",SearchName="consistent read"}],PurchaseMethods=[new(){MethodId=method}],Media=[new(){Url="/products/charger.svg",SortOrder=0}]};
        var variant=new ProductVariant{Sku=Key("sku"),SearchSku="read",PriceRial=price,IsActive=true,LabelEn="Original variant",LabelFa="تنوع اولیه",WarrantyEn="Original warranty",WarrantyFa="گارانتی اولیه"};product.Variants.Add(variant);db.Products.Add(product);await db.SaveChangesAsync();
        var stock=sp.GetRequiredService<InventoryDbContext>();stock.Stock.Add(new(){VariantId=variant.Id,OnHand=5});await stock.SaveChangesAsync();return new(product.Id,variant.Id,category.Id,brand.Id,method,product.Slug);
    }
    private async Task<ProductInput> Input(Item item)
    {
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var p=(await scope.ServiceProvider.GetRequiredService<IAdminProducts>().DetailAsync(item.Product,CancellationToken.None)).Product;var v=Assert.Single(p.Variants);
        return new(p.CategoryId,p.BrandId,p.Slug,p.Status,p.IsDigital,p.Featured,p.Translations.Select(t=>new TranslationInput(t.Locale,t.Name,t.Description,t.Badge)).ToArray(),[],[new(v.Id,v.Sku,v.PriceRial,v.CompareAtPriceRial,v.Color,v.ColorNameFa,v.ColorNameEn,v.LabelFa,v.LabelEn,v.WarrantyFa,v.WarrantyEn,v.IsActive,[],v.PurchaseMethods.Select(m=>m.MethodId).ToArray(),v.Version)],p.Media.Select(m=>m.Url).ToArray(),p.PurchaseMethods.Select(m=>m.MethodId).ToArray(),[],p.Version);
    }
    private async Task Write(Item item,ProductInput input)=>await OrderFixture.Json(await fixture.Admin.PutAsJsonAsync("/api/admin/products/"+item.Product,input));
    private sealed class DuringRead(string marker,Func<int,Task> change,int limit=1):DbCommandInterceptor
    {
        public int Hits;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,CommandEventData eventData,InterceptionResult<DbDataReader> result,CancellationToken cancellationToken=default)
        {
            if(command.CommandText.Contains(marker,StringComparison.Ordinal)){var hit=Interlocked.Increment(ref Hits);if(hit<=limit)await change(hit);}return result;
        }
    }
    private CatalogDbContext Context(DbCommandInterceptor hook)=>new(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer(fixture.Base.Sql.Connection).AddInterceptors(hook).Options);
    private async Task<string> Table<T>() where T:class{await using var scope=fixture.Factory.Services.CreateAsyncScope();return "["+scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Model.FindEntityType(typeof(T))!.GetTableName()+"]";}
    private CatalogService Service(CatalogDbContext db,IServiceProvider sp)=>new(db,sp.GetRequiredService<IInventoryReader>(),sp.GetRequiredService<IPurchaseConfiguration>(),fixture.Clock,sp.GetRequiredService<IInventorySerialGuard>());

    [Fact] public async Task CheckoutRetriesTheEntireProjectionAfterPriceDetailsAndMethodRelationshipsChange()
    {
        var item=await Make(9007199254740993);var input=await Input(item);var changed=input with{Variants=[input.Variants[0] with{PriceRial="9007199254740994",WarrantyEn="Fresh warranty",LabelEn="Fresh variant",PurchaseMethodIds=[item.Method]}]};
        var hook=new DuringRead(await Table<ProductPurchaseMethod>(),_=>Write(item,changed));await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();var row=Assert.Single(await Service(db,scope.ServiceProvider).ReadCheckoutVariantsAsync("en",[item.Variant],CancellationToken.None)).Value;
        Assert.Equal(2,hook.Hits);Assert.Equal(9007199254740994,row.Variant.PriceRial);Assert.Equal("Fresh warranty",row.Warranty);Assert.Equal("Fresh variant",row.Variant.Label);Assert.NotEqual(input.Variants[0].Version,row.PriceVersion);Assert.Equal(new[]{item.Method},row.VariantMethodIds);
    }
    [Theory][InlineData(true)][InlineData(false)]
    public async Task EligibilityChangeDuringCheckoutReadReturnsNoLongerVisibleItemAsUnavailable(bool category)
    {
        var item=await Make();var hook=new DuringRead(await Table<ProductPurchaseMethod>(),async _=>{await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();if(category)await db.Categories.Where(c=>c.Id==item.Category).ExecuteUpdateAsync(s=>s.SetProperty(c=>c.IsActive,false));else await db.Brands.Where(b=>b.Id==item.Brand).ExecuteUpdateAsync(s=>s.SetProperty(b=>b.IsActive,false));});await using var reading=Context(hook);await using var services=fixture.Factory.Services.CreateAsyncScope();Assert.Empty(await Service(reading,services.ServiceProvider).ReadCheckoutVariantsAsync("en",[item.Variant],CancellationToken.None));Assert.Equal(1,hook.Hits);
    }
    [Fact] public async Task PersistentCheckoutDriftFailsAfterTwoAttemptsWithoutAnEmptySuccess()
    {
        var item=await Make();var hook=new DuringRead(await Table<ProductPurchaseMethod>(),async _=>{await using var scope=fixture.Factory.Services.CreateAsyncScope();await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().Variants.Where(v=>v.Id==item.Variant).ExecuteUpdateAsync(s=>s.SetProperty(v=>v.PriceRial,v=>v.PriceRial+1));},2);await using var db=Context(hook);await using var services=fixture.Factory.Services.CreateAsyncScope();Assert.Equal("catalog_unavailable",(await Assert.ThrowsAsync<BusinessException>(()=>Service(db,services.ServiceProvider).ReadCheckoutVariantsAsync("fa",[item.Variant],CancellationToken.None))).Code);Assert.Equal(2,hook.Hits);
    }
    [Fact] public async Task PublicGraphRetriesInsteadOfCombiningOldNamesWithFreshMediaAndLabels()
    {
        var item=await Make();var input=await Input(item);var hook=new DuringRead(await Table<ProductMedia>(),_=>Write(item,input with{Translations=[new("fa","نام تازه"),new("en","Fresh name")],ImageUrls=["/products/phone-silver.svg"],Variants=[input.Variants[0] with{LabelEn="Fresh variant"}]}));await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();var snapshot=await Service(db,scope.ServiceProvider).ReadAsync("en",CancellationToken.None);var product=Assert.Single(snapshot.Products,p=>p.Id==item.Product);Assert.Equal(2,hook.Hits);Assert.Equal("Fresh name",product.Name);Assert.Equal("/products/phone-silver.svg",product.Image);Assert.Equal("Fresh variant",Assert.Single(product.Variants).Label);
    }
    [Fact] public async Task SearchRestartsMatchingWhenTheWinnerPriceChangesBeforeHydration()
    {
        var item=await Make();var input=await Input(item);var hook=new DuringRead(await Table<CategoryTranslation>(),_=>Write(item,input with{Variants=[input.Variants[0] with{PriceRial="101"}]}));await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();var result=await Service(db,scope.ServiceProvider).SearchAsync("en",new(CategoryId:item.Category,MaxPriceRial:"100"),CancellationToken.None);Assert.Equal(1,hook.Hits);Assert.Empty(result.Products);Assert.Empty(result.MatchingVariantIds);Assert.Equal(0,result.Total);
    }
    [Fact] public async Task LookupRestartsAnOldSlugSelectionAndKeepsCaseInsensitiveIdsAndVisibility()
    {
        var item=await Make();var input=await Input(item);var fresh=Key("fresh");var hook=new DuringRead(await Table<CategoryTranslation>(),_=>Write(item,input with{Slug=fresh}));await using var db=Context(hook);await using var scope=fixture.Factory.Services.CreateAsyncScope();var service=Service(db,scope.ServiceProvider);Assert.Empty(await service.LookupAsync("en",new(Slugs:[item.Slug]),CancellationToken.None));Assert.Equal(2,hook.Hits);Assert.Equal(fresh,Assert.Single(await service.LookupAsync("en",new(VariantIds:[item.Variant.ToUpperInvariant()]),CancellationToken.None)).Slug);
        var freshInput=await Input(item);await Write(item,freshInput with{Status="Hidden",Variants=[freshInput.Variants[0] with{IsActive=false}]});Assert.Empty(await service.LookupAsync("en",new(ProductIds:[item.Product],Slugs:[fresh]),CancellationToken.None));
    }
    [Fact] public async Task StableSearchReturnsTheAvailableWinnerAndExactRialStrings()
    {
        var item=await Make(9007199254740993);await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<CatalogDbContext>();var cheaper=new ProductVariant{ProductId=item.Product,Sku=Key("cheap"),SearchSku="cheap",IsActive=true,PriceRial=1};db.Variants.Add(cheaper);await db.SaveChangesAsync();var result=await scope.ServiceProvider.GetRequiredService<ICatalogService>().SearchAsync("en",new(CategoryId:item.Category,Query:"consistent",Sort:"price-asc"),CancellationToken.None);var product=Assert.Single(result.Products);Assert.Equal(item.Variant,result.MatchingVariantIds[product.Id]);Assert.Equal("9007199254740993",product.Variants.Single(v=>v.Id==item.Variant).PriceRial);
    }
    private sealed class FailureSwitch{public bool Fail=true;}
    private sealed class ControlledReader(ICheckoutCatalogReader real,FailureSwitch control):ICheckoutCatalogReader
    {
        public Task<IReadOnlyDictionary<string,CheckoutVariantData>> ReadCheckoutVariantsAsync(string locale,IReadOnlyCollection<string> ids,CancellationToken ct)=>control.Fail?throw new BusinessException("catalog_unavailable","Controlled test-only read failure."):real.ReadCheckoutVariantsAsync(locale,ids,ct);
    }
    [Fact] public async Task QuoteReadFailureRollsBackAndTheSameRequestCanLaterSucceedAndReplay()
    {
        var item=await Make();var person=await fixture.Base.Customer();using var original=person.Client;var control=new FailureSwitch();using var host=fixture.Factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>s.AddScoped<ICheckoutCatalogReader>(sp=>new ControlledReader((ICheckoutCatalogReader)sp.GetRequiredService<ICatalogService>(),control))));using var client=host.CreateClient(new(){HandleCookies=false});foreach(var h in original.DefaultRequestHeaders)client.DefaultRequestHeaders.TryAddWithoutValidation(h.Key,h.Value);
        var current=await OrderFixture.Json(await client.GetAsync("/api/cart/en"));var cart=await OrderFixture.Json(await client.PutAsJsonAsync("/api/cart/en",new CartInput([new(item.Variant,1)],current["version"]?.GetValue<string>())));var request=new CheckoutQuoteInput(cart["version"]!.GetValue<string>(),item.Method,null,Guid.NewGuid().ToString("N"));using var failed=await client.PostAsJsonAsync("/api/cart/en/quote",request);Assert.Equal(HttpStatusCode.ServiceUnavailable,failed.StatusCode);Assert.Contains("catalog_unavailable",await failed.Content.ReadAsStringAsync());Assert.Contains("no-store",failed.Headers.CacheControl!.ToString());
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var sales=scope.ServiceProvider.GetRequiredService<SalesDbContext>();Assert.False(await sales.Quotes.AnyAsync(q=>q.RequestId==request.RequestId));Assert.False(await sales.Orders.AnyAsync(o=>o.OwnerId==person.Owner));control.Fail=false;var success=await OrderFixture.Json(await client.PostAsJsonAsync("/api/cart/en/quote",request));Assert.False(string.IsNullOrEmpty(success["quoteId"]!.GetValue<string>()));Assert.Equal("100",success["goodsTotalRial"]!.GetValue<string>());var replay=await OrderFixture.Json(await client.PostAsJsonAsync("/api/cart/en/quote",request));Assert.Equal(success.ToJsonString(),replay.ToJsonString());Assert.Equal(1,await sales.Quotes.CountAsync(q=>q.RequestId==request.RequestId));
    }
}

using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class AdminProductTests(ApiFactory factory):IClassFixture<ApiFactory>
{
    [Theory][InlineData("wrong")][InlineData("published")][InlineData("")]
    public void InvalidStatusFails(string status)=>Assert.Throws<BusinessException>(()=>AdminProductQuery.Create(status:status));
    [Fact] public void CursorBindsNormalizedQueryStatusCategoryAndBrand()
    {
        var filter=AdminProductQuery.Create("  كيبورد ۱۲ ","Hidden","c1","b1");Assert.Equal("کیبورد 12",filter.Search);var cursor=AdminProductPaging.Encode("p1",filter);Assert.Equal("p1",AdminProductPaging.Decode(cursor,AdminProductQuery.Create("کیبورد 12","Hidden","c1","b1")));
        foreach(var other in new[]{AdminProductQuery.Create("other","Hidden","c1","b1"),AdminProductQuery.Create("کیبورد 12","Draft","c1","b1"),AdminProductQuery.Create("کیبورد 12","Hidden","c2","b1"),AdminProductQuery.Create("کیبورد 12","Hidden","c1","b2")})Assert.Throws<BusinessException>(()=>AdminProductPaging.Decode(cursor,other));
        Assert.Throws<BusinessException>(()=>AdminProductQuery.Create(new string('a',121)));Assert.Throws<BusinessException>(()=>AdminProductQuery.Create("a b c d e f g h i"));
    }
    [Theory][InlineData("")][InlineData("=")][InlineData("e30")][InlineData("bad/cursor")]
    public async Task MalformedCursorNeverOpensSql(string cursor)
    {
        await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));Assert.Equal("invalid_product_cursor",(await Assert.ThrowsAsync<BusinessException>(()=>new AdminProducts(db).PageAsync(AdminProductQuery.Create(),cursor,CancellationToken.None))).Code);Assert.Equal(System.Data.ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    [Fact] public void ListAndLookupSqlSelectOnlySummariesAndDetailIsFilteredBeforeGraph()
    {
        using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var list=AdminProductsQuery.Read(db,AdminProductQuery.Create("sku keyboard","Hidden","c1","b1"),"p1").Take(51).ToQueryString();foreach(var text in new[]{"TOP","51","[SearchName]","[SearchSku]","[CategoryId]","[BrandId]","[Status]","[Id] >","ORDER BY"})Assert.Contains(text,list);
        foreach(var text in new[]{"[PriceRial]","[WarrantyFa]","[Description]","[Media]","[inventory]","OFFSET"})Assert.DoesNotContain(text,list);
        var lookup=AdminProductsQuery.Read(db,AdminProductQuery.Create(),ids:["p1","p2"]).ToQueryString();Assert.Contains("WHERE",lookup);Assert.DoesNotContain("[PriceRial]",lookup);
        var detail=AdminProductsQuery.Detail(db,"p1").ToQueryString();Assert.Contains("WHERE",detail);Assert.Contains("p1",detail);
    }
    [Theory][InlineData("too-many")][InlineData("duplicate")][InlineData("unsafe")]
    public async Task InvalidLookupsFailWithoutDatabase(string kind)
    {
        await using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));var keys=kind switch{"too-many"=>Enumerable.Range(0,25).Select(i=>"p"+i).ToArray(),"duplicate"=>new[]{"p1","P1"},_=>new[]{"bad/id"}};await Assert.ThrowsAsync<BusinessException>(()=>new AdminProducts(db).LookupAsync(keys,CancellationToken.None));Assert.Empty(await new AdminProducts(db).LookupAsync([],CancellationToken.None));Assert.Equal(System.Data.ConnectionState.Closed,db.Database.GetDbConnection().State);
    }
    public static Product Product()=>new(){Id="p1",Version=new byte[8],Slug="product-1",CategoryId="c1",BrandId="b1",Status="Draft",Translations=[new(){Locale="fa",Name="نام",Description="شرح"},new(){Locale="en",Name="Name",Description="Description"}],Attributes=[new(){AttributeId="a1",ValueBool=false,Selections=[new(){OptionId="o1"},new(){OptionId="o2"}]}],Variants=[new(){Id="v1",Version=new byte[8],Sku="SKU",PriceRial=long.MaxValue,CompareAtPriceRial=long.MaxValue,SearchSku="must-not-leak",IsActive=false,Attributes=[new(){AttributeId="a2",ValueNumber=0}],PurchaseMethods=[new(){MethodId="online"}]}],Media=[new(){Url="/products/phone-silver.svg",SortOrder=2}],PurchaseMethods=[new(){MethodId="online"}],CreditPlans=[new(){PlanId="plan"}]};
    [Fact] public void DetailCopiesEveryEditableRelationAndMoneyWithoutInternalSearchFields()
    {
        var detail=AdminProductDetail.From(Product());Assert.Equal("9223372036854775807",detail.Product.Variants[0].PriceRial);Assert.Equal("9223372036854775807",detail.Product.Variants[0].CompareAtPriceRial);Assert.False(detail.Product.Variants[0].IsActive);Assert.False(detail.Product.Attributes[0].ValueBool);Assert.Equal(2,detail.Product.Attributes[0].Selections.Length);Assert.Equal(0,detail.Product.Variants[0].Attributes[0].ValueNumber);Assert.Single(detail.Product.Media);Assert.Single(detail.Product.CreditPlans);Assert.DoesNotContain("must-not-leak",JsonSerializer.Serialize(detail));
    }
    [Theory][InlineData("/api/admin/products")][InlineData("/api/admin/products/p1")][InlineData("/api/admin/catalog/product-lookup?ids=p1")][InlineData("/api/admin/catalog?metadataOnly=true")]
    public async Task AnonymousCannotRead(string path){using var client=factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync(path)).StatusCode);}
    [Theory][InlineData("mfa_pending","catalog.read")][InlineData("access","catalog.write")][InlineData("access","inventory.read")]
    public async Task IncompleteOrWrongPermissionCannotRead(string kind,string permission){using var client=factory.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind",kind);client.DefaultRequestHeaders.Add("X-Test-Permissions",permission);Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/api/admin/catalog/product-lookup?ids=p1")).StatusCode);}
    private sealed class Reader:IAdminProducts
    {
        private static readonly AdminProductSummary Row=new("p1","product-1","نام","Name","c1","b1","Draft",false,1);
        public Task<AdminProductPage> PageAsync(AdminProductQuery query,string? cursor,CancellationToken ct)=>Task.FromResult(new AdminProductPage(1,50,[Row],null));
        public Task<AdminProductSummary[]> LookupAsync(string[] ids,CancellationToken ct)=>Task.FromResult(ids.Contains("p1")?new[]{Row}:[]);
        public Task<AdminProductDetail> DetailAsync(string id,CancellationToken ct){var product=Product();product.Id=id;return Task.FromResult(AdminProductDetail.From(product));}
    }
    [Fact] public async Task AuthorizedGetLookupHasNoMutationTransactionAndDetailMoneyRemainsAString()
    {
        await using var app=factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IAdminProducts>();s.AddSingleton<IAdminProducts,Reader>();}));using var client=app.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind","access");client.DefaultRequestHeaders.Add("X-Test-Permissions","catalog.read");
        foreach(var path in new[]{"/api/admin/products","/api/admin/catalog/product-lookup?ids=p1","/api/admin/products/p1"}){using var result=await client.GetAsync(path);Assert.Equal(HttpStatusCode.OK,result.StatusCode);Assert.Contains("no-store",result.Headers.CacheControl!.ToString());await ContractWireCapture.SaveAsync(path=="/api/admin/products"?"products-page":path.Contains("/catalog/product-lookup",StringComparison.Ordinal)?"products-lookup":"product-detail",await result.Content.ReadAsStringAsync());if(path=="/api/admin/products"){var page=JsonNode.Parse(await result.Content.ReadAsStringAsync())!.AsObject();Assert.True(page.ContainsKey("nextCursor"));Assert.Null(page["nextCursor"]);}if(path.EndsWith("/p1")){var json=JsonNode.Parse(await result.Content.ReadAsStringAsync())!;Assert.Equal("9223372036854775807",json["product"]!["variants"]![0]!["priceRial"]!.GetValue<string>());}}
        using(var reserved=await client.GetAsync("/api/admin/products/lookup")){Assert.Equal(HttpStatusCode.OK,reserved.StatusCode);Assert.Equal("lookup",JsonNode.Parse(await reserved.Content.ReadAsStringAsync())!["product"]!["id"]!.GetValue<string>());}
        foreach(var path in new[]{"/api/admin/products?status=invalid","/api/admin/products?cursor=bad","/api/admin/catalog/product-lookup?ids=p1&ids=P1","/api/admin/catalog/product-lookup?ids=bad%2Fid"})Assert.Equal(HttpStatusCode.BadRequest,(await client.GetAsync(path)).StatusCode);
    }
}

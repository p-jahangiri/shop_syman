using System.Net;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class AdminStockTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory][InlineData("bad")][InlineData("")][InlineData("TRUE")]
    public void BadActivityIsRejected(string active) => Assert.Equal("invalid_stock_filter", Assert.Throws<BusinessException>(() => AdminStockQuery.Create(active: active)).Code);
    [Fact] public void SearchNormalizationAndCursorBindSearchAndActivity()
    {
        var query = AdminStockQuery.Create("  كيبورد ۱۲  ", "false"); Assert.Equal("کیبورد 12", query.Search);
        var cursor = AdminStockPaging.Encode("variant-1", query); Assert.Equal("variant-1", AdminStockPaging.Decode(cursor, AdminStockQuery.Create("کیبورد 12", "false")));
        Assert.Throws<BusinessException>(() => AdminStockPaging.Decode(cursor, AdminStockQuery.Create("کیبورد 12", "true")));
        Assert.Throws<BusinessException>(() => AdminStockPaging.Decode(cursor, AdminStockQuery.Create("different", "false")));
        Assert.Throws<BusinessException>(() => AdminStockQuery.Create(new string('a',121)));
        Assert.Throws<BusinessException>(() => AdminStockQuery.Create("a b c d e f g h i"));
    }
    [Theory][InlineData("")][InlineData("=")][InlineData("e30")][InlineData("bad/cursor")]
    public async Task InvalidCursorFailsBeforeCatalogSql(string cursor)
    {
        await using var db = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        Assert.Equal("invalid_stock_cursor", (await Assert.ThrowsAsync<BusinessException>(() => new AdminStockCatalog(db).PageAsync(AdminStockQuery.Create(),cursor,CancellationToken.None))).Code);
        Assert.Equal(System.Data.ConnectionState.Closed, db.Database.GetDbConnection().State);
    }
    [Fact] public void StockCatalogQueryPaginatesAllStatesWithoutMoneyOrGraphAndStockReadUsesOnlyIds()
    {
        using var catalog = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var sql = AdminStockCatalogQuery.Match(catalog,AdminStockQuery.Create("sku keyboard","false"),"v1").Take(51).ToQueryString();
        foreach(var expected in new[]{"TOP","51","[SearchSku]","[SearchName]","[IsActive]","ORDER BY","[Id] >"}) Assert.Contains(expected,sql);
        foreach(var forbidden in new[]{"[PriceRial]","[CompareAtPriceRial]","[WarrantyFa]","[Description]","[PurchaseMethods]","[inventory]","OFFSET","Published'"}) Assert.DoesNotContain(forbidden,sql);
        var single=AdminStockCatalogQuery.Match(catalog,AdminStockQuery.Create(),onlyId:"v1").Take(1).ToQueryString();Assert.Contains("WHERE",single);Assert.DoesNotContain("[PriceRial]",single);
        using var inventory = new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));
        var stockSql=AdminStockReader.Query(inventory,["v1","v2"]).ToQueryString(); Assert.Contains("WHERE",stockSql);Assert.DoesNotContain("[Movements]",stockSql);Assert.DoesNotContain("[catalog]",stockSql);
    }
    [Theory][InlineData("too-many")][InlineData("duplicate")][InlineData("unsafe")]
    public async Task InvalidStockBatchesNeverOpenInventorySql(string kind)
    {
        await using var db=new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory"));
        var ids=kind switch{"too-many"=>Enumerable.Range(0,51).Select(i=>"v"+i).ToArray(),"duplicate"=>new[]{"v1","V1"},_=>new[]{"bad/id"}};
        await Assert.ThrowsAsync<BusinessException>(()=>new AdminStockReader(db).ReadAsync(ids,CancellationToken.None));Assert.Equal(System.Data.ConnectionState.Closed,db.Database.GetDbConnection().State);
        Assert.Empty(await new AdminStockReader(db).ReadAsync([],CancellationToken.None));
    }
    private sealed class Catalog : IAdminStockCatalog
    {
        public static readonly StockVariantMetadata[] Rows=[new("without-stock","p1","SKU-1","بدون سابقهٔ انبار","No stock",true,"Draft"),new("with-stock","p2","SKU-2","تنوع غیرفعال","Inactive",false,"Hidden")];
        public Task<StockVariantPage> PageAsync(AdminStockQuery query,string? cursor,CancellationToken ct)=>Task.FromResult(new StockVariantPage(Rows,null));
        public Task<StockVariantMetadata?> FindAsync(string id,CancellationToken ct)=>Task.FromResult(Rows.FirstOrDefault(x=>x.Id==id));
        public Task<AdminCatalogSummary> SummaryAsync(CancellationToken ct)=>Task.FromResult(new AdminCatalogSummary("9007199254740993","2"));
    }
    private sealed class Stock : IAdminStockReader
    {
        public string[] LastIds {get;private set;}=[];
        public Task<AdminStockRecord[]> ReadAsync(string[] ids,CancellationToken ct){LastIds=ids;return Task.FromResult(ids.Contains("with-stock")?new[]{new AdminStockRecord("WITH-STOCK",7,2,"AAAAAAAAAAE=")}:[]);}
        public Task<AdminStockSummary> SummaryAsync(CancellationToken ct)=>Task.FromResult(new AdminStockSummary("9007199254740993","1","1"));
    }
    [Fact] public async Task CompositionReadsOnlyPageIdsAndDistinguishesUnstockedZeroFromUnavailable()
    {
        var stock=new Stock();var service=new AdminStockService(new Catalog(),stock);var page=await service.PageAsync(AdminStockQuery.Create(),null,CancellationToken.None);
        Assert.Equal(new[]{"without-stock","with-stock"},stock.LastIds);Assert.Equal(50,page.PageSize);Assert.Equal(2,page.Items.Length);
        Assert.Equal(0,page.Items[0].Available);Assert.Null(page.Items[0].Version);Assert.Equal(5,page.Items[1].Available);Assert.False(page.Items[1].IsActive);
        await service.FindAsync("with-stock",CancellationToken.None);Assert.Equal(new[]{"with-stock"},stock.LastIds);
        Assert.Equal("not_found",(await Assert.ThrowsAsync<BusinessException>(()=>service.FindAsync("missing",CancellationToken.None))).Code);
    }
    [Theory][InlineData("/api/admin/inventory/variants")][InlineData("/api/admin/inventory/variants/v1")][InlineData("/api/admin/inventory/v2/variants")][InlineData("/api/admin/inventory/v2/variants/v1")][InlineData("/api/admin/inventory/summary")][InlineData("/api/admin/catalog/summary")]
    public async Task AnonymousCannotRead(string path){using var client=factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync(path)).StatusCode);}
    [Theory][InlineData("mfa_pending","inventory.read")][InlineData("access","inventory.write")][InlineData("access","cms.read")]
    public async Task IncompleteOrWrongPermissionsCannotReadVariants(string kind,string permission){using var client=factory.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind",kind);client.DefaultRequestHeaders.Add("X-Test-Permissions",permission);foreach(var path in new[]{"/api/admin/inventory/variants","/api/admin/inventory/v2/variants","/api/admin/inventory/v2/variants/with-stock"})Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync(path)).StatusCode);}
    [Fact] public async Task AuthorizedRoutesUseBoundedContractsAndSummariesRetainStringCounts()
    {
        await using var app=factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IAdminStockCatalog>();s.RemoveAll<IAdminStockReader>();s.AddSingleton<IAdminStockCatalog,Catalog>();s.AddSingleton<IAdminStockReader,Stock>();}));
        using var client=app.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind","access");client.DefaultRequestHeaders.Add("X-Test-Permissions","inventory.read,catalog.read");
        var routes = new (string Path, string? Capture)[]
        {
            ("/api/admin/inventory/variants", "stock-page"),
            ("/api/admin/inventory/variants/with-stock", null),
            ("/api/admin/inventory/v2/variants", "stock-page-v2"),
            ("/api/admin/inventory/v2/variants/with-stock", null),
            ("/api/admin/inventory/summary", "stock-summary"),
            ("/api/admin/catalog/summary", "catalog-summary")
        };
        foreach (var (path, capture) in routes)
        {
            using var result = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, result.StatusCode);
            Assert.Contains("no-store", result.Headers.CacheControl!.ToString());
            var body = await result.Content.ReadAsStringAsync();
            var json = JsonNode.Parse(body)!;
            if (capture is not null)
                await ContractWireCapture.SaveAsync(capture, body);
            if (path.EndsWith("summary", StringComparison.Ordinal))
                Assert.Contains("9007199254740993", json.ToJsonString());
            Assert.DoesNotContain("priceRial", json.ToJsonString());

            if (capture is "stock-page" or "stock-page-v2")
            {
                Assert.True(json.AsObject().ContainsKey("nextCursor"));
                Assert.Null(json["nextCursor"]);
                var missing = json["items"]![0]!.AsObject();
                Assert.True(missing.ContainsKey("version"));
                Assert.Null(missing["version"]);
                if (capture == "stock-page-v2")
                {
                    Assert.Equal(2, json["version"]!.GetValue<int>());
                    Assert.Equal(0, missing["sourcingReserved"]!.GetValue<int>());
                }
                else
                {
                    Assert.False(missing.ContainsKey("sourcingReserved"));
                }
            }
        }
        foreach(var query in new[]{"active=wrong","cursor=invalid", "query="+new string('a',121)}){using var result=await client.GetAsync("/api/admin/inventory/variants?"+query);Assert.Equal(HttpStatusCode.BadRequest,result.StatusCode);}
    }
    private sealed class SourcingHeldStock:IAdminStockReader
    {
        public Task<AdminStockRecord[]> ReadAsync(string[] ids,CancellationToken ct)=>Task.FromResult(ids.Contains("with-stock")?new[]{new AdminStockRecord("with-stock",7,2,"AAAAAAAAAAE="){SourcingReserved=5}}:[]);
        public Task<AdminStockSummary> SummaryAsync(CancellationToken ct)=>Task.FromResult(new AdminStockSummary("1","0","1"));
    }
    [Fact]public async Task Version2ExposesBothHoldsAndVersion1ReturnsAnExplicitUpgradeConflict()
    {
        await using var app=factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IAdminStockCatalog>();s.RemoveAll<IAdminStockReader>();s.AddSingleton<IAdminStockCatalog,Catalog>();s.AddSingleton<IAdminStockReader,SourcingHeldStock>();}));
        using var client=app.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Kind","access");client.DefaultRequestHeaders.Add("X-Test-Permissions","inventory.read");
        foreach(var path in new[]{"/api/admin/inventory/v2/variants","/api/admin/inventory/v2/variants/with-stock"}){
            using var result=await client.GetAsync(path);Assert.Equal(HttpStatusCode.OK,result.StatusCode);Assert.Contains("no-store",result.Headers.CacheControl!.ToString());var json=JsonNode.Parse(await result.Content.ReadAsStringAsync())!;
            var row=path.EndsWith("/with-stock",StringComparison.Ordinal)?json:json["items"]!.AsArray().Single(r=>r!["variantId"]!.GetValue<string>()=="with-stock")!;
            Assert.Equal(7,row["onHand"]!.GetValue<int>());Assert.Equal(2,row["reserved"]!.GetValue<int>());Assert.Equal(5,row["sourcingReserved"]!.GetValue<int>());Assert.Equal(0,row["available"]!.GetValue<int>());
        }
        foreach(var path in new[]{"/api/admin/inventory/variants","/api/admin/inventory/variants/with-stock"}){
            using var result=await client.GetAsync(path);Assert.Equal(HttpStatusCode.Conflict,result.StatusCode);Assert.Contains("no-store",result.Headers.CacheControl!.ToString());var json=JsonNode.Parse(await result.Content.ReadAsStringAsync())!;Assert.Equal("inventory_contract_upgrade_required",json["title"]!.GetValue<string>());
        }
    }
}

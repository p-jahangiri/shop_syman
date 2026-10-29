using System.Net;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class CatalogSitemapTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory][InlineData(0,0)][InlineData(1,1)][InlineData(1000,1)][InlineData(1001,2)][InlineData(50000000,50000)]
    public void CountPagesDoesNotLoseBoundaryRows(long count,int expected)=>Assert.Equal(expected,CatalogSitemapRules.Pages(count));
    [Theory][InlineData(-1)][InlineData(50000001)][InlineData(long.MaxValue)]
    public void OverCapacityFailsInsteadOfSilentlyTruncating(long count)=>Assert.Throws<BusinessException>(()=>CatalogSitemapRules.Pages(count));
    [Theory][InlineData("fa","products")][InlineData("en","products")][InlineData("fa","categories")][InlineData("en","categories")]
    public void SqlSelectsOnlyUrlKeysAndTranslationFlagsWithBoundedPaging(string locale,string kind)
    {
        using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));var sql=CatalogSitemapQuery.Page(db,locale,kind,2,DateTimeOffset.Parse("2026-10-23T00:00:00Z")).ToQueryString();
        Assert.Contains("OFFSET",sql);Assert.Contains("FETCH NEXT",sql);Assert.Contains("1000",sql);Assert.Contains("ORDER BY",sql);Assert.Contains("[IsActive]",sql);
        foreach(var forbidden in new[]{"[PriceRial]","[CompareAtPriceRial]","[Description]","[Sku]","[WarrantyFa]","[AvailableStockV1]","[PurchaseMethods]","[identity]"})Assert.DoesNotContain(forbidden,sql,StringComparison.OrdinalIgnoreCase);
        if(kind=="products"){Assert.Contains("[PublishAt]",sql);Assert.Contains("[Slug]",sql);Assert.Contains("Published",sql);}
    }
    [Theory][InlineData("/api/catalog/fa/sitemap/products?page=0")][InlineData("/api/catalog/en/sitemap/categories?page=50001")][InlineData("/api/catalog/fa/sitemap/private?page=1")][InlineData("/api/catalog/de/sitemap")]
    public async Task MalformedPublicRequestsFailWithoutSql(string path){using var client=factory.CreateClient();using var response=await client.GetAsync(path);Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());}
}

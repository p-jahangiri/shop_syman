using Microsoft.EntityFrameworkCore;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;
namespace Shop.Tests;
public sealed class CmsPageSitemapTests
{
    [Theory][InlineData(0,0)][InlineData(1,1)][InlineData(1000,1)][InlineData(1001,2)][InlineData(50000000,50000)]
    public void CountsCoverEveryPartitionWithoutRoundingOrTruncation(long count,int expected)=>Assert.Equal(expected,CmsPageSitemapRules.Pages(count));
    [Theory][InlineData(-1L)][InlineData(50000001L)]public void OverCapacityCannotSilentlyLosePages(long count)=>Assert.Equal("sitemap_capacity_unavailable",Assert.Throws<BusinessException>(()=>CmsPageSitemapRules.Pages(count)).Code);
    [Theory][InlineData("de",1)][InlineData("FA",1)][InlineData("fa",0)][InlineData("en",50001)]public void LocaleAndPageBoundsAreExplicit(string locale,int page)=>Assert.Throws<BusinessException>(()=>CmsPageSitemapRules.Validate(locale,page));
    [Fact]public void SqlProjectionIsBoundedAndDoesNotReadCmsBodiesActorsOrCommerceGraphs()
    {
        using var db=new CmsDbContext(new DbContextOptionsBuilder<CmsDbContext>().UseSqlServer("Server=unused;Database=unused").Options);var sql=CmsPageSitemapQuery.Page(db,"fa",2).ToQueryString();Assert.Contains("[cms].[Pages]",sql);Assert.Contains("[cms].[PageRevisions]",sql);Assert.Contains("[IsDemo]",sql);Assert.Contains("[PublishedRevisionId]",sql);Assert.Contains("FETCH NEXT",sql);Assert.Contains("1000",sql);
        foreach(var forbidden in new[]{"DraftJson","BodyJson","ActorId","UpdatedBy","[catalog]","[inventory]","[sales]","[identity]","JSON_VALUE"})Assert.DoesNotContain(forbidden,sql);
    }
}

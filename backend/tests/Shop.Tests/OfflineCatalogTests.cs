using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class OfflineCatalogTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory][InlineData(0)][InlineData(-1)][InlineData(501)][InlineData(int.MaxValue)]
    public void OfflineProductLimitCannotBecomeUnbounded(int value) => Assert.Throws<BusinessException>(() => OfflineCatalogRules.Limit(value));
    [Fact] public void OfflineDefaultsAndUpperBoundsAreExplicit(){Assert.Equal(200,OfflineCatalogRules.Limit(null));Assert.Equal(1,OfflineCatalogRules.Limit(1));Assert.Equal(500,OfflineCatalogRules.Limit(500));}
    [Theory][InlineData("fa")][InlineData("en")]
    public void SqlProjectionIsBoundedAndDoesNotSelectFinancialOrPrivateColumns(string locale)
    {
        using var db=new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var categories=OfflineCatalogQuery.Categories(db,locale).Take(501).ToQueryString();
        var products=OfflineCatalogQuery.Products(db,locale,["category"],DateTimeOffset.Parse("2026-10-23T00:00:00Z")).Take(201).ToQueryString();
        Assert.Contains("501",categories);Assert.Contains("201",products);Assert.Contains("TOP(",categories);Assert.Contains("TOP(",products);Assert.Contains("SUBSTRING(",products);Assert.Contains("SUBSTRING(",categories);
        Assert.Contains("[PublishAt]",products);Assert.Contains("[IsActive]",products);Assert.Contains("["+db.Model.FindEntityType(typeof(Shop.Modules.Catalog.Domain.ProductVariant))!.GetTableName()+"]",products);Assert.Contains("ORDER BY",products);
        foreach(var forbidden in new[]{"[PriceRial]","[CompareAtPriceRial]","[WarrantyFa]","[WarrantyEn]","[Sku]","[AvailableStockV1]","[Stock]","[identity]","[PurchaseMethods]","[ProductAttributes]","[CreditPlans]"})Assert.DoesNotContain(forbidden,products,StringComparison.OrdinalIgnoreCase);
    }
    [Theory][InlineData("https://private.example/image?signature=secret")][InlineData("/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/thumb.webp?token=private")][InlineData("/products/../private.svg")][InlineData("/products/private.svg#token")][InlineData("data:image/svg+xml,private")]
    public void OfflineImageAllowlistRejectsSignedPrivateOrArbitraryMedia(string value) => Assert.Null(OfflineCatalogRules.Image(value));
    [Fact] public void ProcessedImagesUseOnlyTheirPublicThumbnail(){Assert.Equal("/media/catalog/"+new string('a',32)+"/thumb.webp",OfflineCatalogRules.Image("/media/catalog/"+new string('a',32)+"/zoom.webp"));Assert.Equal("/products/phone.svg",OfflineCatalogRules.Image("/products/phone.svg"));}
    [Fact] public void PublishedSiteProjectionDoesNotExposeContactAuthOrOtherCmsFields()
    {
        var site=JsonNode.Parse("""{"name":"Store","tagline":"Public","palette":{"primaryLight":"#aabbcc","private":"secret"},"contact":{"phone":"private-phone"},"authSettings":{"token":"private-token"},"hero":{"image":"https://private.example/?signature=secret"}}""")!.AsObject();
        var dto=OfflineCatalogEndpoints.PublicSite(site);var json=JsonSerializer.Serialize(dto,new JsonSerializerOptions(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull});
        Assert.Equal("#aabbcc",dto.Primary);foreach(var value in new[]{"private","phone","contact","authSettings","token","signature","hero"})Assert.DoesNotContain(value,json,StringComparison.OrdinalIgnoreCase);
        site["palette"]!["primaryLight"]="url(https://private.example)";Assert.Null(OfflineCatalogEndpoints.PublicSite(site).Primary);
    }
    [Theory][InlineData("/api/catalog/fa/offline?limit=0")][InlineData("/api/catalog/en/offline?limit=501")][InlineData("/api/catalog/de/offline")][InlineData("/api/catalog/fa/offline?limit=abc")]
    public async Task InvalidAnonymousProjectionRequestsFailBeforeSql(string path){using var client=factory.CreateClient();using var response=await client.GetAsync(path);Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);Assert.Contains("no-store",response.Headers.CacheControl!.ToString());}
}

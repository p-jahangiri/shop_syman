using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;
public sealed class DomainTests
{
    [Theory][InlineData(59L,"287082")][InlineData(1111111109L,"081804")][InlineData(1111111111L,"050471")][InlineData(1234567890L,"005924")][InlineData(2000000000L,"279037")][InlineData(20000000000L,"353130")]
    public void TotpMatchesRfc6238Sha1Vectors(long seconds, string expected) => Assert.Equal(expected, Totp.Code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", seconds / 30));
    [Theory]
    [InlineData("-1")][InlineData("1.2")][InlineData("9223372036854775808")][InlineData("1e10")][InlineData("۱۲۳")]
    public void RejectsInvalidMoney(string value) => Assert.Throws<BusinessException>(() => CatalogRules.Money(value));
    [Fact] public void PreservesLargeRialWithoutFloatingPoint() { Assert.Equal(long.MaxValue, CatalogRules.Money("9223372036854775807")); Assert.Throws<OverflowException>(() => { _ = new Rial(long.MaxValue) + new Rial(1); }); }
    [Fact] public void NormalizesPersianSearch() => Assert.Equal("کیف 123", PersianText.Normalize(" كِيف ۱۲٣ "));
    [Fact] public void EnforcesTypedAttributes()
    {
        var number = new AttributeDefinition { Key = "weight", DataType = AttributeDataType.Number };
        CatalogRules.AttributeValue(number, new("weight", Number: 0));
        Assert.Throws<BusinessException>(() => CatalogRules.AttributeValue(number, new("weight", TextFa: "12")));
        Assert.Throws<BusinessException>(() => CatalogRules.AttributeValue(number, new("weight", Number: 12, Bool: false)));
        Assert.Throws<BusinessException>(() => CatalogRules.AttributeValue(number, new("weight", Number: 0.000000001m)));
        var select = new AttributeDefinition { Key = "storage", DataType = AttributeDataType.MultiSelect, Options = [new() { Id = "128" }] };
        Assert.Throws<BusinessException>(() => CatalogRules.AttributeValue(select, new("storage", OptionIds: ["128", "256"])));
        Assert.Throws<BusinessException>(() => CatalogRules.AttributeValue(select, new("storage", OptionIds: ["128", "128"])));
        CatalogRules.AttributeValue(select, new("storage", OptionIds: ["128"]));
    }
    [Fact] public void RequiresBothLanguageNames() { Assert.Throws<BusinessException>(() => CatalogRules.Translations([new("fa", "گوشی")])); CatalogRules.Translations([new("fa", "گوشی"), new("en", "Phone")]); }
    [Fact] public void RejectsStaleVersion() { Assert.Throws<BusinessException>(() => CatalogRules.Version([1, 2], "AQM=")); CatalogRules.Version([1, 2], "AQI="); }
    [Theory][InlineData(0,1,100,3000)][InlineData(6,4,100,3000)][InlineData(6,1,-1,3000)][InlineData(6,1,100,10001)]
    public void RejectsInvalidChequeTerms(int months, int interval, int markup, int down) => Assert.Throws<BusinessException>(() => CreditPlanService.Validate(new("طرح", "Plan", months, markup, down, interval, true, null, null, [], null)));
    [Theory][InlineData(0)][InlineData(100)] public void RejectsUnsupportedChequeRounding(int unit) => Assert.Throws<BusinessException>(() => CreditPlanService.Validate(new("طرح","Plan",6,1234,3025,2,true,null,null,[],null,unit)));
    [Fact] public void SqlModelsContainTypedIndexesConcurrencyAndStockConstraints()
    {
        using var catalog = new CatalogDbContext(DesignTimeOptions.Create<CatalogDbContext>("catalog"));
        var sql = catalog.Database.GenerateCreateScript();
        Assert.Contains("[ValueNumber] decimal(28,8)", sql); Assert.Contains("rowversion", sql); Assert.Contains("IX_Variants_Sku", sql); Assert.DoesNotContain("Discriminator", sql);
        using var inventory = new InventoryDbContext(DesignTimeOptions.Create<InventoryDbContext>("inventory")); Assert.Contains("[Reserved] <= [OnHand]", inventory.Database.GenerateCreateScript());
        using var cms = new CmsDbContext(DesignTimeOptions.Create<CmsDbContext>("cms")); Assert.Contains("[PublishedJson]", cms.Database.GenerateCreateScript());
        using var credit = new CreditDbContext(DesignTimeOptions.Create<CreditDbContext>("credit")); Assert.Contains("CK_Plan_Terms", credit.Database.GenerateCreateScript());
        using var payments = new PaymentsDbContext(DesignTimeOptions.Create<PaymentsDbContext>("payments")); Assert.Contains("CK_Method_Amount", payments.Database.GenerateCreateScript());
        using var identity = new Shop.Modules.Identity.IdentityDbContext(DesignTimeOptions.Create<Shop.Modules.Identity.IdentityDbContext>("identity")); Assert.Contains("TokenHash", identity.Database.GenerateCreateScript());
    }
    [Fact] public void ContentRejectsExternalAndExecutableMenus()
    {
        var auth = JsonNode.Parse("{\"mobileOtp\":false,\"emailPassword\":false,\"usernamePassword\":false,\"registration\":false,\"passwordReset\":false}")!.AsObject();
        Assert.Throws<BusinessException>(() => ContentService.Validate("auth", "fa", auth));
        var site = JsonNode.Parse("{\"name\":\"S\",\"latinName\":\"S\",\"tagline\":\"S\",\"announcement\":\"S\",\"about\":\"S\",\"chequeDisclaimer\":\"S\",\"hero\":{\"eyebrow\":\"S\",\"title\":\"S\",\"description\":\"S\",\"action\":\"S\",\"secondary\":\"S\"},\"nav\":[{\"label\":\"Shop\",\"href\":\"//evil.test\"}]}")!.AsObject();
        Assert.Throws<BusinessException>(() => ContentService.Validate("site", "en", site)); site["nav"]![0]!["href"] = "/catalog"; ContentService.Validate("site", "en", site);
        site["palette"] = JsonNode.Parse("{\"primaryLight\":\"url(https://bad.test)\"}"); Assert.Throws<BusinessException>(() => ContentService.Validate("site", "en", site));
        site["palette"] = JsonNode.Parse("{\"primaryLight\":\"#ffffff\"}"); Assert.Throws<BusinessException>(() => ContentService.Validate("site", "en", site));
        site["palette"] = JsonNode.Parse("{\"primaryLight\":\"#425b36\",\"primaryDark\":\"#b9cf9e\"}"); ContentService.Validate("site", "en", site);
        site["homeBlocks"] = JsonNode.Parse("[{\"id\":\"b\",\"kind\":\"script\",\"enabled\":true}]"); Assert.Throws<BusinessException>(() => ContentService.Validate("site", "en", site));
        site["homeBlocks"] = JsonNode.Parse("[{\"id\":\"b\",\"kind\":\"products\",\"enabled\":true,\"startsAt\":\"2026-01-02T00:00:00Z\",\"endsAt\":\"2026-01-01T00:00:00Z\"}]"); Assert.Throws<BusinessException>(() => ContentService.Validate("site", "en", site));
        site["homeBlocks"] = JsonNode.Parse("[{\"id\":\"b\",\"kind\":\"products\",\"enabled\":true,\"limit\":4}]"); ContentService.Validate("site", "en", site);
    }
    [Theory]
    [InlineData("{\"allowIndexing\":\"true\"}")]
    [InlineData("{\"arbitraryScript\":\"<script>\"}")]
    [InlineData("{\"shareImage\":\"https://media.example/a.jpg?signature=secret\"}")]
    [InlineData("{\"shareImage\":\"https://user:password@media.example/a.jpg\"}")]
    [InlineData("{\"shareImage\":\"/api/credit/private.jpg\"}")][InlineData("{\"shareImage\":\"/media/public-share.jpg\"}")]
    public void SeoRejectsUnsupportedSettingsAndPrivateImages(string invalid)
    {
        var site = new JsonObject { ["name"] = "S", ["latinName"] = "S", ["tagline"] = "S", ["announcement"] = "S", ["about"] = "S", ["chequeDisclaimer"] = "S", ["hero"] = new JsonObject { ["eyebrow"] = "S", ["title"] = "S", ["description"] = "S", ["action"] = "S", ["secondary"] = "S" }, ["nav"] = new JsonArray(), ["seo"] = JsonNode.Parse(invalid) };
        Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site));
        site["seo"] = JsonNode.Parse("{\"allowIndexing\":false,\"title\":\"Shop\",\"description\":\"Description\",\"shareImage\":\"/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp\"}");
        ContentService.Validate("site", "fa", site);
    }
}

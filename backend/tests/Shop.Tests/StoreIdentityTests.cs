using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class StoreIdentityTests
{
    [Fact]
    public void ExistingSiteAndEmptyDisabledConfigurationStayCompatible()
    {
        ContentService.Validate("site", "fa", Site());
        var site = Site();
        site["storeIdentity"] = JsonNode.Parse("""{"demonstration":false,"socialLinks":[{"platform":"instagram","url":"","enabled":false}],"badges":[{"id":"enamad","kind":"enamad","title":"","verificationUrl":"","enabled":false}]}""");
        ContentService.Validate("site", "fa", site);
    }

    [Theory]
    [InlineData("instagram", "https://www.instagram.com/shop_sample")]
    [InlineData("telegram", "https://t.me/shop_sample")]
    [InlineData("whatsapp", "https://wa.me/989123456789")]
    [InlineData("aparat", "https://www.aparat.com/shop_sample")]
    [InlineData("linkedin", "https://www.linkedin.com/company/shop_sample")]
    public void SupportedSocialProfilesUseKnownHosts(string platform, string url)
    {
        var site = Site(); site["storeIdentity"] = new JsonObject { ["socialLinks"] = new JsonArray(new JsonObject { ["platform"] = platform, ["url"] = url, ["enabled"] = true }) };
        ContentService.Validate("site", "en", site);
    }

    [Theory]
    [InlineData("javascript:alert(1)")][InlineData("//instagram.com/shop")]
    [InlineData("https://instagram.com.evil.test/shop")][InlineData("https://user:pass@instagram.com/shop")]
    [InlineData("https://instagram.com:444/shop")][InlineData("https://instagram.com:443/shop")]
    [InlineData("https://instagram.com/shop#x")][InlineData("https://instagram.com/shop?next=https://evil.test")]
    [InlineData("https://instagram.com/accounts")][InlineData("https://instagram.com/shop\\x")]
    [InlineData("https://instagram.com/\u0000shop")][InlineData("https://instagram.com/\u202eshop")]
    [InlineData("https://instagram.com/shop/../accounts")]
    public void HiddenSocialFieldsStillRejectHostConfusionAndExecutableLinks(string url)
    {
        var site = Site(); site["storeIdentity"] = new JsonObject { ["socialLinks"] = new JsonArray(new JsonObject { ["platform"] = "instagram", ["url"] = url, ["enabled"] = false }) };
        Assert.Equal("invalid_store_identity", Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site)).Code);
    }

    [Theory]
    [InlineData("null")][InlineData("{\"demonstration\":\"true\"}")]
    [InlineData("{\"script\":\"<script>\"}")][InlineData("{\"badges\":null}")]
    [InlineData("{\"socialLinks\":[{\"platform\":\"whatsapp\",\"url\":\"https://wa.me/+989123456789\",\"enabled\":true}]}")]
    [InlineData("{\"socialLinks\":[{\"platform\":\"whatsapp\",\"url\":\"https://wa.me/09121234567\",\"enabled\":true}]}")]
    [InlineData("{\"badges\":[{\"id\":\"a\",\"kind\":\"enamad\",\"title\":\"نماد\",\"verificationUrl\":\"https://evil.test/fake\",\"enabled\":true}]}")]
    [InlineData("{\"badges\":[{\"id\":\"a\",\"kind\":\"license\",\"title\":\"مجوز\",\"verificationUrl\":\"https://127.0.0.1/x\",\"enabled\":true}]}")]
    [InlineData("{\"policyLinks\":[{\"id\":\"a\",\"title\":\"شرایط\",\"href\":\"//evil.test\",\"enabled\":true}]}")]
    [InlineData("{\"policyLinks\":[{\"id\":\"a\",\"title\":\"شرایط\",\"href\":\"/account\",\"enabled\":true}]}")]
    public void InvalidTypesUnknownFieldsAndUnsafeDestinationsAreRejected(string identity)
    {
        var site = Site(); site["storeIdentity"] = JsonNode.Parse(identity);
        Assert.Equal("invalid_store_identity", Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site)).Code);
    }

    [Fact]
    public void EveryBadgeImageIsPartOfReadyReferenceChecksIncludingDisabledLicenses()
    {
        var site = Site();
        site["storeIdentity"] = JsonNode.Parse("""{"badges":[{"id":"enamad","kind":"enamad","title":"نماد","enabled":true,"verificationUrl":"https://trustseal.enamad.ir/?id=123&Code=fixture","imageUrl":"https://trustseal.enamad.ir/logo.aspx?id=123&Code=fixture"},{"id":"license","kind":"license","title":"مجوز","enabled":false,"verificationUrl":"","imageUrl":"/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp"}]}""");
        ContentService.Validate("site", "fa", site);
        Assert.Equal(new[] { "https://trustseal.enamad.ir/logo.aspx?id=123&Code=fixture", "/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp" }, CmsImageReferences.Site(site));
        site["storeIdentity"]!["badges"]![1]!["imageUrl"] = "/products/fake.png";
        Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site));
    }

    [Fact]
    public void RepeatedPlatformsBadgeIdsEnamadAndExcessiveRowsAreRejected()
    {
        var identity = JsonNode.Parse("""{"socialLinks":[{"platform":"telegram","url":"https://t.me/shop_sample","enabled":true}]}""")!.AsObject();
        identity["socialLinks"]!.AsArray().Add(identity["socialLinks"]![0]!.DeepClone());
        var site = Site(); site["storeIdentity"] = identity;
        Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site));
        site["storeIdentity"] = JsonNode.Parse("""{"badges":[{"id":"a","kind":"enamad","title":"","verificationUrl":"","enabled":false},{"id":"b","kind":"enamad","title":"","verificationUrl":"","enabled":false}]}""");
        Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site));
        var rows = new JsonArray(); for (var i = 0; i < 7; i++) rows.Add(new JsonObject { ["id"] = i.ToString(), ["kind"] = "license", ["title"] = "", ["verificationUrl"] = "", ["enabled"] = false });
        site["storeIdentity"] = new JsonObject { ["badges"] = rows };
        Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site));
    }

    [Fact]
    public void DevelopmentDemonstrationNeverBecomesAProductionPublicLicense()
    {
        var site = Site(); site["storeIdentity"] = new JsonObject { ["demonstration"] = true };
        ContentService.Validate("site", "fa", site);
        StoreIdentityRules.RequireEnvironment(site, true);
        Assert.Equal("development_identity_only", Assert.Throws<BusinessException>(() => StoreIdentityRules.RequireEnvironment(site, false)).Code);
        var development = site.DeepClone().AsObject(); StoreIdentityRules.ProjectPublic(development, true);
        Assert.NotNull(development["storeIdentity"]);
        StoreIdentityRules.ProjectPublic(site, false); Assert.False(site.ContainsKey("storeIdentity"));
        Assert.Equal("Shop", site["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task DefaultServiceRejectsDemoWritesBeforeOpeningSqlOrCheckingImages()
    {
        using var db = new CmsDbContext(new DbContextOptionsBuilder<CmsDbContext>().UseSqlServer("Server=unused;Database=unused").Options);
        var service = new ContentService(db, new NoImages(), new NoLogin());
        var site = Site(); site["storeIdentity"] = new JsonObject { ["demonstration"] = true };
        Assert.Equal("development_identity_only", (await Assert.ThrowsAsync<BusinessException>(() => service.SaveAsync("site", "fa", new(site, null), "fixture", default))).Code);
        Assert.Empty(db.ChangeTracker.Entries());
    }
    private sealed class NoImages : IPublicImageReferences { public Task RequireReadyAsync(IReadOnlyCollection<string> urls, CancellationToken ct) => throw new InvalidOperationException("No image lookup is expected."); }
    private sealed class NoLogin : ICustomerLoginContinuity { public Task RequireAsync(bool emailPassword, bool usernamePassword, CancellationToken ct) => throw new InvalidOperationException("No login lookup is expected."); }
    private static JsonObject Site() => JsonNode.Parse("""{"name":"Shop","latinName":"Shop","tagline":"Shop","announcement":"Shop","about":"Shop","chequeDisclaimer":"Shop","hero":{"eyebrow":"Shop","title":"Shop","description":"Shop","action":"Shop","secondary":"Shop"},"nav":[]}""")!.AsObject();
}

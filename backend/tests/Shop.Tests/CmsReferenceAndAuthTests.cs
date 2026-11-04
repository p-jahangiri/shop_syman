using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CmsReferenceAndAuthTests
{
    private const string Issued = "/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp";

    [Fact]
    public void SiteExtractionCoversEveryImageSlotWithoutTreatingEditorialTextAsAnImage()
    {
        var value = Site();
        value["logoUrl"] = Issued;
        value["hero"]!["image"] = Issued;
        value["seo"] = new JsonObject { ["shareImage"] = "/products/share.png" };
        value["about"] = "/media/catalog/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/zoom.webp";
        value["homeBlocks"] = new JsonArray(new JsonObject {
            ["id"] = "hidden", ["kind"] = "promotions", ["enabled"] = false,
            ["items"] = new JsonArray(
                new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["action"] = "View", ["href"] = "/catalog", ["image"] = "/products/promo.png" },
                new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["action"] = "View", ["href"] = "/catalog", ["image"] = Issued })
        });
        ContentService.Validate("site", "fa", value);
        Assert.Equal(new[] { Issued, "/products/share.png", "/products/promo.png" }, CmsImageReferences.Site(value));
    }

    [Fact]
    public void PageAndBlogExtractionCoverBothLanguagesEveryVisibilityAndTheCover()
    {
        var content = new CmsPageContent(
            new("عنوان", "", [new(Id(), "Image", "Mobile", Image: Issued, Alt: "عکس"), new(Id(), "Text", "All", Heading: "شرح", Text: "/products/not-an-image.png")]),
            new("Title", "", [new(Id(), "Image", "Desktop", Image: "/products/english.png", Alt: "Photo"), new(Id(), "Image", "All", Image: Issued, Alt: "Same image")]));
        CmsPageRules.Content(content, true);
        Assert.Equal(new[] { Issued, "/products/english.png" }, CmsImageReferences.Page(content));
        var blog = new CmsBlogContent(content, "Organization", "سایمان", "Sayman", "/products/cover.png", "جلد", "Cover", []);
        CmsBlogPostRules.Content(blog, true);
        Assert.Equal(new[] { Issued, "/products/english.png", "/products/cover.png" }, CmsImageReferences.Blog(blog));
        Assert.Equal(CmsImageReferences.Page(content), CmsImageReferences.Blog(blog with { Cover = null, CoverAltFa = null, CoverAltEn = null }));
    }

    [Fact]
    public async Task SiteSaveRequiresReadyBeforeOpeningOrChangingTheCmsDatabase()
    {
        using var db = UnusedCms();
        var references = new RejectIssued();
        var service = new ContentService(db, references, new UnexpectedLoginContinuity());
        var value = Site(); value["hero"]!["image"] = Issued;
        var error = await Assert.ThrowsAsync<BusinessException>(() => service.SaveAsync("site", "fa", new(value, null), "test-editor", default));
        Assert.Equal("image_not_ready", error.Code);
        Assert.Equal(new[] { Issued }, references.Requested);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Theory]
    [InlineData("/products/bundled.png")]
    [InlineData("https://images.example.test/picture.png?size=400")]
    public async Task BundledAndExternalReferencesDoNotOpenSqlOrFetchAnExternalUrl(string url)
    {
        using var db = new CatalogDbContext(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer("Server=unused;Database=unused").Options);
        await new CatalogPublicImageReferences(db).RequireReadyAsync([url], default);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task ReferenceBoundaryRejectsMalformedOrExcessiveInputBeforeSql()
    {
        using var db = new CatalogDbContext(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer("Server=unused;Database=unused").Options);
        var references = new CatalogPublicImageReferences(db);
        foreach (var urls in new[] { new[] { "/media/not-issued.png" }, new[] { "https://user:secret@images.example.test/a.png" }, Enumerable.Repeat("/products/a.png", 257).ToArray() })
            Assert.Equal("invalid_image_url", (await Assert.ThrowsAsync<BusinessException>(() => references.RequireReadyAsync(urls, default))).Code);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public void UnavailableStoredIntentCannotReplaceOrSilentlyChangeASupportedPasswordMethod(bool email, bool username)
    {
        var settings = Auth(email, username, true);
        var original = settings.ToJsonString();
        ContentService.Validate("auth", "fa", settings);
        Assert.Equal(original, settings.ToJsonString());
        var effective = settings.DeepClone().AsObject();
        CustomerAuthSettingsRules.ApplyEffective(effective);
        Assert.False(effective["mobileOtp"]!.GetValue<bool>());
        Assert.False(effective["registration"]!.GetValue<bool>());
        Assert.False(effective["passwordReset"]!.GetValue<bool>());
        Assert.Equal(email, effective["emailPassword"]!.GetValue<bool>());
        Assert.Equal(username, effective["usernamePassword"]!.GetValue<bool>());
        Assert.Equal(original, settings.ToJsonString());
    }

    [Fact]
    public async Task DisablingEveryLoginMethodFailsBeforeAnyDatabaseWrite()
    {
        using var db = UnusedCms();
        var references = new RejectIssued();
        var service = new ContentService(db, references, new UnexpectedLoginContinuity());
        var settings = Auth(false, false, false);
        Assert.Equal("no_login_method", Assert.Throws<BusinessException>(() => ContentService.Validate("auth", "fa", settings)).Code);
        Assert.Equal("no_login_method", (await Assert.ThrowsAsync<BusinessException>(() => service.SaveAsync("auth", "fa", new(settings, null), "test-editor", default))).Code);
        Assert.Empty(references.Requested);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public void OtpOnlyDraftIntentDoesNotAdvertiseAnUnconfiguredProviderAsUsable()
    {
        var draft = Auth(false, false, true);
        ContentService.Validate("auth", "fa", draft);
        var unavailable = draft.DeepClone().AsObject();
        CustomerAuthSettingsRules.ApplyEffective(unavailable);
        Assert.False(unavailable["mobileOtp"]!.GetValue<bool>());
        Assert.False(unavailable["registration"]!.GetValue<bool>());
        Assert.True(draft["mobileOtp"]!.GetValue<bool>());
        Assert.True(draft["registration"]!.GetValue<bool>());
    }

    private sealed class UnexpectedLoginContinuity:ICustomerLoginContinuity
    {
        public Task RequireAsync(bool emailEnabled,bool usernameEnabled,CancellationToken ct)=>throw new InvalidOperationException("Draft/image validation must not check customer login reachability.");
    }
    private static CmsDbContext UnusedCms() => new(new DbContextOptionsBuilder<CmsDbContext>().UseSqlServer("Server=unused;Database=unused").Options);
    private static string Id() => Guid.NewGuid().ToString("N");
    private static JsonObject Auth(bool email, bool username, bool otp) => new() { ["mobileOtp"] = otp, ["emailPassword"] = email, ["usernamePassword"] = username, ["registration"] = true, ["passwordReset"] = true };
    private static JsonObject Site() => new() {
        ["name"] = "Sample", ["latinName"] = "Sample", ["tagline"] = "Sample", ["announcement"] = "Sample", ["about"] = "Sample", ["chequeDisclaimer"] = "Sample",
        ["hero"] = new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["description"] = "Sample", ["action"] = "Sample", ["secondary"] = "Sample" }, ["nav"] = new JsonArray()
    };
    private sealed class RejectIssued : IPublicImageReferences
    {
        public string[] Requested { get; private set; } = [];
        public Task RequireReadyAsync(IReadOnlyCollection<string> urls, CancellationToken ct)
        {
            Requested = urls.ToArray();
            if (Requested.Any(url => url.StartsWith("/media/", StringComparison.Ordinal))) throw new BusinessException("image_not_ready", "Test-only explicitly missing image.");
            return Task.CompletedTask;
        }
    }
}

using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CmsImageValidationTests
{
    [Theory]
    [InlineData("logo")]
    [InlineData("hero")]
    [InlineData("promotion")]
    [InlineData("seo")]
    public void EverySiteImageEntryRejectsCredentialsMalformedLocalPathsAndControlSuffixes(string slot)
    {
        foreach (var image in new[] {
            "https://user:password@images.example.test/phone.png",
            "https://images.example.test/phone.png#private",
            "/products/page.html",
            "/products/phone.png?download=1",
            "/media/unissued.png",
            "/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp\n"
        })
        {
            var error = Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", Site(slot, image)));
            Assert.Equal("invalid_image_url", error.Code);
        }
    }

    [Theory]
    [InlineData("logo")]
    [InlineData("hero")]
    [InlineData("promotion")]
    [InlineData("seo")]
    public void SiteImageEntriesAcceptIssuedBundledAndPublicHttpsImages(string slot)
    {
        foreach (var image in new[] {
            "/media/catalog/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.webp",
            "/products/phones/sample_Black-1.jpeg",
            "https://images.example.test/phone.png"
        }) ContentService.Validate("site", "fa", Site(slot, image));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("https://user:password@images.example.test/logo.png")]
    [InlineData("/media/unissued.png")]
    public async Task InvalidBrandLogosFailBeforeDatabaseWrites(string? logo)
    {
        using var db = new CatalogDbContext(new DbContextOptionsBuilder<CatalogDbContext>().UseSqlServer("Server=unused;Database=unused").Options);
        var service = new CatalogService(db, null!, null!, TimeProvider.System, null!);
        var error = await Assert.ThrowsAsync<BusinessException>(() => service.SaveBrandAsync(null, new BrandInput("Brand", "brand", logo!, true, null), default));
        Assert.Equal("invalid_image_url", error.Code);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    private static JsonObject Site(string slot, string image)
    {
        var hero = new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["description"] = "Sample", ["action"] = "Sample", ["secondary"] = "Sample" };
        var site = new JsonObject {
            ["name"] = "Sample", ["latinName"] = "Sample", ["tagline"] = "Sample", ["announcement"] = "Sample", ["about"] = "Sample", ["chequeDisclaimer"] = "Sample",
            ["hero"] = hero, ["nav"] = new JsonArray()
        };
        if (slot == "logo") site["logoUrl"] = image;
        if (slot == "hero") hero["image"] = image;
        if (slot == "seo") site["seo"] = new JsonObject { ["shareImage"] = image };
        if (slot == "promotion") site["homeBlocks"] = new JsonArray(new JsonObject {
            ["id"] = "sample", ["kind"] = "promotions", ["enabled"] = true,
            ["items"] = new JsonArray(new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["action"] = "Sample", ["image"] = image, ["href"] = "/fa/catalog" })
        });
        return site;
    }
}

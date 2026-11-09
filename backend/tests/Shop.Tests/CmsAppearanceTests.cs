using System.Text.Json.Nodes;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CmsAppearanceTests
{
    [Fact]
    public void ExistingSiteDocumentsWithoutAppearanceRemainValid()
    {
        foreach (var locale in new[] { "fa", "en" }) ContentService.Validate("site", locale, Site());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"surface\":\"glass\",\"density\":\"comfortable\",\"corners\":\"rounded\",\"motion\":\"subtle\",\"heroLayout\":\"split\",\"stickyHeader\":true}")]
    [InlineData("{\"surface\":\"solid\",\"density\":\"compact\",\"corners\":\"soft\",\"motion\":\"none\",\"heroLayout\":\"compact\",\"stickyHeader\":false}")]
    [InlineData("{\"motion\":\"none\"}")]
    [InlineData("{\"showUsedProducts\":false}")]
    [InlineData("{\"motion\":\"full\",\"cards\":\"editorial\",\"navigation\":\"pills\"}")]
    [InlineData("{\"motionPreset\":\"lift\"}")]
    [InlineData("{\"motionPreset\":\"glow\",\"motionBanners\":true,\"motionCards\":false,\"motionSidebar\":true}")]
    [InlineData("{\"motion\":\"none\",\"motionPreset\":\"ripple\",\"motionBanners\":false,\"motionSidebar\":false}")]
    public void BothLanguagesAcceptFiniteAppearanceOptionsAndPartialOverrides(string json)
    {
        foreach (var locale in new[] { "fa", "en" })
        {
            var site = Site();
            site["appearance"] = JsonNode.Parse(json);
            ContentService.Validate("site", locale, site);
            Assert.Equal(json, site["appearance"]!.ToJsonString());
        }
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"glass\"")]
    [InlineData("true")]
    [InlineData("{\"surface\":\"GLASS\"}")]
    [InlineData("{\"surface\":\"url(https://example.test)\"}")]
    [InlineData("{\"surface\":null}")]
    [InlineData("{\"surface\":true}")]
    [InlineData("{\"density\":\"tiny\"}")]
    [InlineData("{\"corners\":18}")]
    [InlineData("{\"corners\":\"square\"}")]
    [InlineData("{\"motion\":\"infinite\"}")]
    [InlineData("{\"cards\":\"<style>\"}")]
    [InlineData("{\"navigation\":true}")]
    [InlineData("{\"motion\":null}")]
    [InlineData("{\"motionPreset\":\"url(https://example.test)\"}")]
    [InlineData("{\"motionPreset\":null}")]
    [InlineData("{\"motionBanners\":\"true\"}")]
    [InlineData("{\"motionCards\":0}")]
    [InlineData("{\"motionSidebar\":null}")]
    [InlineData("{\"heroLayout\":\"<script>\"}")]
    [InlineData("{\"heroLayout\":{\"split\":true}}")]
    [InlineData("{\"stickyHeader\":\"false\"}")]
    [InlineData("{\"stickyHeader\":0}")]
    [InlineData("{\"stickyHeader\":null}")]
    [InlineData("{\"showUsedProducts\":\"false\"}")]
    [InlineData("{\"css\":\"body{display:none}\"}")]
    [InlineData("{\"script\":\"alert(1)\"}")]
    [InlineData("{\"surface\":\"glass\",\"unknown\":false}")]
    public void UnsafeUnknownAndMistypedAppearanceCannotEnterDraftOrPublication(string json)
    {
        var site = Site();
        site["appearance"] = JsonNode.Parse(json);
        var error = Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site));
        Assert.Equal("invalid_appearance", error.Code);
    }

    [Fact]
    public void VersionedDesignAgreesWithTheSharedContractAndBelongsToTheCommonDocument()
    {
        using var resource = typeof(CmsAppearanceTests).Assembly.GetManifestResourceStream("Shop.Tests.Fixtures.site-design-contract.json")!;
        var cases = JsonNode.Parse(resource)!.AsArray();
        foreach (var example in cases)
        {
            var site = Site();
            site["design"] = example!["value"]?.DeepClone();
            if (example["valid"]!.GetValue<bool>())
            {
                ContentService.Validate("site", "fa", site);
                Assert.Equal("invalid_site_design", Assert.Throws<BusinessException>(() => ContentService.Validate("site", "en", site)).Code);
            }
            else
                Assert.Equal("invalid_site_design", Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site)).Code);
        }
    }

    private static JsonObject Site() => new()
    {
        ["name"] = "Sample", ["latinName"] = "Sample", ["tagline"] = "Sample", ["announcement"] = "Sample",
        ["about"] = "Sample", ["chequeDisclaimer"] = "Sample", ["nav"] = new JsonArray(),
        ["hero"] = new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["description"] = "Sample", ["action"] = "Sample", ["secondary"] = "Sample" }
    };
}

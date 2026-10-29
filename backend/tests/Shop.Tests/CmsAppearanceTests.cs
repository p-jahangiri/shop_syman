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
    [InlineData("{\"motion\":\"full\"}")]
    [InlineData("{\"motion\":null}")]
    [InlineData("{\"heroLayout\":\"<script>\"}")]
    [InlineData("{\"heroLayout\":{\"split\":true}}")]
    [InlineData("{\"stickyHeader\":\"false\"}")]
    [InlineData("{\"stickyHeader\":0}")]
    [InlineData("{\"stickyHeader\":null}")]
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

    private static JsonObject Site() => new()
    {
        ["name"] = "Sample", ["latinName"] = "Sample", ["tagline"] = "Sample", ["announcement"] = "Sample",
        ["about"] = "Sample", ["chequeDisclaimer"] = "Sample", ["nav"] = new JsonArray(),
        ["hero"] = new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["description"] = "Sample", ["action"] = "Sample", ["secondary"] = "Sample" }
    };
}

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Shop.Modules.Cms;
using Shop.SharedKernel;
using Xunit;

namespace Shop.Tests;

public sealed class CmsPurchaseDependencyTests
{
    [Theory]
    [InlineData("online")]
    [InlineData("cheque")]
    [InlineData("installment")]
    public void FiniteDependencyCanBeUsedInHeroNestedMenusBlocksPromotionsAndSupportFaq(string kind)
    {
        foreach (var locale in new[] { "fa", "en" })
        {
            var site = Site();
            foreach (var slot in Slots(site)) slot["purchaseMethodKind"] = kind;
            ContentService.Validate("site", locale, site);
            Assert.All(Slots(site), slot => Assert.Equal(kind, slot["purchaseMethodKind"]!.GetValue<string>()));
            var support = SupportContentTests.Content();
            support["faqs"]![0]!["purchaseMethodKind"] = kind;
            var typed = SupportContentRules.Read(support);
            ContentService.Validate("support", locale, support);
            Assert.Equal(kind, Assert.Single(typed.Faqs).PurchaseMethodKind);
        }
    }

    [Theory]
    [InlineData("null")]
    [InlineData("true")]
    [InlineData("1")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("\"\"")]
    [InlineData("\"CHEQUE\"")]
    [InlineData("\"cash\"")]
    [InlineData("\"<script>\"")]
    [InlineData("\"cheque \"")]
    public void InvalidDependencyFailsEverySiteSlotAndSupportRatherThanSilentlyRemovingItsCondition(string invalid)
    {
        for (var index = 0; index < Slots(Site()).Length; index++)
        {
            var site = Site();
            Slots(site)[index]["purchaseMethodKind"] = JsonNode.Parse(invalid);
            var error = Assert.Throws<BusinessException>(() => ContentService.Validate("site", "fa", site));
            Assert.Equal("invalid_purchase_dependency", error.Code);
        }
        var support = SupportContentTests.Content();
        support["faqs"]![0]!["purchaseMethodKind"] = JsonNode.Parse(invalid);
        Assert.Equal("invalid_support_content", Assert.Throws<BusinessException>(() => SupportContentRules.Read(support)).Code);
    }

    [Fact]
    public void AbsentMetadataRetainsTheExactLegacyDraftAndPublicFaqPropertySetsEvenWithGlobalNeverIgnore()
    {
        ContentService.Validate("site", "fa", Site());
        var content = SupportContentRules.Read(SupportContentTests.Content());
        var faq = Assert.Single(content.Faqs);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.Never };
        var draft = JsonSerializer.SerializeToNode(faq, options)!.AsObject();
        Assert.Equal(new[] { "answer", "enabled", "id", "question" }, draft.Select(p => p.Key).Order());
        var published = JsonSerializer.SerializeToNode(new SupportFaqPublic(faq.Id, faq.Question, faq.Answer), options)!.AsObject();
        Assert.Equal(new[] { "answer", "id", "question" }, published.Select(p => p.Key).Order());
        var marked = JsonSerializer.SerializeToNode(new SupportFaqPublic(faq.Id, faq.Question, faq.Answer, "cheque"), options)!.AsObject();
        Assert.Equal("cheque", marked["purchaseMethodKind"]!.GetValue<string>());
        var missingFlag = SupportContentTests.Content();
        missingFlag["faqs"]![0]!.AsObject().Remove("enabled");
        missingFlag["faqs"]![0]!["purchaseMethodKind"] = "cheque";
        Assert.Throws<BusinessException>(() => SupportContentRules.Read(missingFlag));
    }

    private static JsonObject Site() => new()
    {
        ["name"] = "Sample", ["latinName"] = "Sample", ["tagline"] = "Sample", ["announcement"] = "Sample",
        ["about"] = "Sample", ["chequeDisclaimer"] = "Sample",
        ["hero"] = new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["description"] = "Sample", ["action"] = "Sample", ["secondary"] = "Sample" },
        ["nav"] = new JsonArray(new JsonObject { ["label"] = "Guide", ["href"] = "/guide", ["children"] = new JsonArray(new JsonObject { ["label"] = "Details", ["href"] = "/details" }) }),
        ["homeBlocks"] = new JsonArray(new JsonObject { ["id"] = "promo", ["kind"] = "promotions", ["enabled"] = true,
            ["items"] = new JsonArray(new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["action"] = "Sample", ["href"] = "/guide", ["image"] = "/products/phone-titanium.svg" }) })
    };

    private static JsonObject[] Slots(JsonObject site) => [site["hero"]!.AsObject(), site["nav"]![0]!.AsObject(),
        site["nav"]![0]!["children"]![0]!.AsObject(), site["homeBlocks"]![0]!.AsObject(), site["homeBlocks"]![0]!["items"]![0]!.AsObject()];
}

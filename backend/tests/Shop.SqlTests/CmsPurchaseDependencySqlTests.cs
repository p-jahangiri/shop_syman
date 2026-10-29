using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Shop.Modules.Cms;
using Xunit;

namespace Shop.SqlTests;

public sealed class CmsPurchaseDependencySqlTests(OrderFixture fixture) : IClassFixture<OrderFixture>
{
    [Fact]
    public async Task SiteDependenciesRoundTripOnlyAfterPublishRespectCasAndRestoreWithoutChangingAnotherLocale()
    {
        using var anonymous = fixture.Sql.Factory.CreateClient(new() { HandleCookies = false });
        var original = await Site(anonymous, "fa");
        var originalEn = await Site(anonymous, "en");
        var before = await All();
        var doc = Document(before, "site", "fa");
        var revision = Revision(before, "site", "fa", doc["revision"]!.GetValue<int>());
        var content = JsonNode.Parse(doc["draftJson"]!.GetValue<string>())!.AsObject();
        content["hero"]!["purchaseMethodKind"] = "cheque";
        content["nav"]!.AsArray().Add(new JsonObject {
            ["label"] = "Synthetic purchasing guide", ["href"] = "/guide", ["purchaseMethodKind"] = "online",
            ["children"] = new JsonArray(new JsonObject { ["label"] = "Nested guide", ["href"] = "/nested", ["purchaseMethodKind"] = "installment" })
        });
        content["homeBlocks"] ??= new JsonArray();
        content["homeBlocks"]!.AsArray().Add(new JsonObject {
            ["id"] = "sql-dependency", ["kind"] = "promotions", ["enabled"] = true, ["purchaseMethodKind"] = "cheque",
            ["items"] = new JsonArray(new JsonObject { ["eyebrow"] = "Disposable fixture", ["title"] = "Synthetic offer", ["action"] = "Guide",
                ["href"] = "/guide", ["image"] = "/products/phone-titanium.svg", ["purchaseMethodKind"] = "installment" })
        });
        var input = new ContentInput(content, doc["version"]!.GetValue<string>());
        await Save("site", "fa", input);
        Assert.Equal(original.ToJsonString(), (await Site(anonymous, "fa")).ToJsonString());
        await Rejected(await fixture.Admin.PutAsJsonAsync("/api/admin/content/site/fa", input), HttpStatusCode.Conflict, "version_conflict");
        await Publish("site", "fa");
        var published = await Site(anonymous, "fa");
        Assert.Equal(content.ToJsonString(), published.ToJsonString());
        Assert.Equal(originalEn.ToJsonString(), (await Site(anonymous, "en")).ToJsonString());
        Capture("site-dependencies-fa", published);

        doc = Document(await All(), "site", "fa");
        var invalid = content.DeepClone().AsObject();
        invalid["nav"]!.AsArray().Last()!["children"]![0]!["purchaseMethodKind"] = null;
        await Rejected(await fixture.Admin.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(invalid, doc["version"]!.GetValue<string>())),
            HttpStatusCode.BadRequest, "invalid_purchase_dependency");
        Assert.Equal(doc.ToJsonString(), Document(await All(), "site", "fa").ToJsonString());
        await Publish("site", "fa", revision["id"]!.GetValue<string>());
        Assert.Equal(original.ToJsonString(), (await Site(anonymous, "fa")).ToJsonString());
        Assert.Equal(originalEn.ToJsonString(), (await Site(anonymous, "en")).ToJsonString());
    }

    [Fact]
    public async Task SupportDependenciesPreserveLegacyJsonShapeDraftIsolationFiniteKindsAndPublishedHistory()
    {
        using var anonymous = fixture.Sql.Factory.CreateClient(new() { HandleCookies = false });
        var en = await Json(await anonymous.GetAsync("/api/content/support/en"));
        var original = Support();
        await Save("support", "fa", new(original, null));
        await Publish("support", "fa");
        var legacy = await Json(await anonymous.GetAsync("/api/content/support/fa"));
        var legacyFaq = Assert.Single(legacy["content"]!["faqs"]!.AsArray())!.AsObject();
        Assert.Equal(new[] { "answer", "id", "question" }, legacyFaq.Select(p => p.Key).Order());
        Assert.DoesNotContain("purchaseMethodKind", legacy.ToJsonString());
        var all = await All();
        var oldRevision = Revision(all, "support", "fa", 1);
        var doc = Document(all, "support", "fa");
        var marked = original.DeepClone().AsObject();
        foreach (var kind in new[] { "online", "cheque", "installment" })
            marked["faqs"]!.AsArray().Add(new JsonObject { ["id"] = Guid.NewGuid().ToString("N"), ["question"] = "Synthetic " + kind + " guide?",
                ["answer"] = "Disposable fixture answer", ["enabled"] = true, ["purchaseMethodKind"] = kind });
        marked["faqs"]!.AsArray().Add(new JsonObject { ["id"] = Guid.NewGuid().ToString("N"), ["question"] = "Hidden dependency?",
            ["answer"] = "This disabled FAQ must stay private", ["enabled"] = false, ["purchaseMethodKind"] = "cheque" });
        var input = new ContentInput(marked, doc["version"]!.GetValue<string>());
        await Save("support", "fa", input);
        Assert.Equal(legacy.ToJsonString(), (await Json(await anonymous.GetAsync("/api/content/support/fa"))).ToJsonString());
        await Rejected(await fixture.Admin.PutAsJsonAsync("/api/admin/content/support/fa", input), HttpStatusCode.Conflict, "version_conflict");
        await Publish("support", "fa");
        var published = await Json(await anonymous.GetAsync("/api/content/support/fa"));
        var faqs = published["content"]!["faqs"]!.AsArray();
        Assert.Equal(4, faqs.Count);
        Assert.Equal(3, faqs[0]!.AsObject().Count);
        Assert.Equal(new[] { "online", "cheque", "installment" }, faqs.Skip(1).Select(f => f!["purchaseMethodKind"]!.GetValue<string>()));
        Assert.DoesNotContain("enabled", published.ToJsonString());
        Assert.DoesNotContain("This disabled FAQ", published.ToJsonString());
        Assert.Equal(en.ToJsonString(), (await Json(await anonymous.GetAsync("/api/content/support/en"))).ToJsonString());
        Capture("support-dependencies-fa", published);

        doc = Document(await All(), "support", "fa");
        foreach (var bad in new[] { "null", "\"cash\"" })
        {
            var invalid = marked.DeepClone().AsObject();
            invalid["faqs"]![1]!["purchaseMethodKind"] = JsonNode.Parse(bad);
            await Rejected(await fixture.Admin.PutAsJsonAsync("/api/admin/content/support/fa", new ContentInput(invalid, doc["version"]!.GetValue<string>())),
                HttpStatusCode.BadRequest, "invalid_support_content");
            Assert.Equal(doc.ToJsonString(), Document(await All(), "support", "fa").ToJsonString());
        }
        var historical = await Json(await fixture.Admin.GetAsync("/api/admin/content/support/fa/revisions/" + oldRevision["id"]!.GetValue<string>()));
        Assert.Equal(new[] { "answer", "enabled", "id", "question" }, historical["content"]!["faqs"]![0]!.AsObject().Select(p => p.Key).Order());
        await Publish("support", "fa", oldRevision["id"]!.GetValue<string>());
        var restored = await Json(await anonymous.GetAsync("/api/content/support/fa"));
        Assert.Equal(legacy["content"]!.ToJsonString(), restored["content"]!.ToJsonString());
        Assert.Equal(en.ToJsonString(), (await Json(await anonymous.GetAsync("/api/content/support/en"))).ToJsonString());
    }

    private async Task<JsonNode> All() => await Json(await fixture.Admin.GetAsync("/api/admin/content"));
    private static JsonNode Document(JsonNode all, string key, string locale) => all["documents"]!.AsArray().Single(d =>
        d!["key"]!.GetValue<string>() == key && d["locale"]!.GetValue<string>() == locale)!;
    private static JsonNode Revision(JsonNode all, string key, string locale, int revision) => all["revisions"]!.AsArray().Single(d =>
        d!["key"]!.GetValue<string>() == key && d["locale"]!.GetValue<string>() == locale && d["revision"]!.GetValue<int>() == revision)!;
    private static async Task<JsonNode> Site(HttpClient client, string locale) => (await Json(await client.GetAsync($"/api/storefront/{locale}?metadataOnly=true")))["site"]!;
    private static Task<JsonNode> Json(HttpResponseMessage response) => OrderFixture.Json(response);
    private async Task Save(string key, string locale, ContentInput input)
    {
        using var response = await fixture.Admin.PutAsJsonAsync($"/api/admin/content/{key}/{locale}", input);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }
    private async Task Publish(string key, string locale, string? restore = null)
    {
        var doc = Document(await All(), key, locale);
        using var response = await fixture.Admin.PostAsJsonAsync($"/api/admin/content/{key}/{locale}/publish", new { Version = doc["version"]!.GetValue<string>(), RestoreRevisionId = restore });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }
    private static async Task Rejected(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var problem = await OrderFixture.Json(response, status);
        Assert.Equal(code, problem["title"]!.GetValue<string>());
    }
    private static JsonObject Support() => new() {
        ["schemaVersion"] = 1, ["isDemo"] = true, ["eyebrow"] = "Disposable SQL support", ["title"] = "Fixture guide", ["description"] = "Synthetic data only",
        ["ticketsAction"] = "Contact", ["faqTitle"] = "Fixture FAQ", ["faqDescription"] = "",
        ["faqs"] = new JsonArray(new JsonObject { ["id"] = Guid.NewGuid().ToString("N"), ["question"] = "Generic fixture guide?", ["answer"] = "Plain synthetic answer", ["enabled"] = true })
    };
    private static void Capture(string name, JsonNode value)
    {
        if (Environment.GetEnvironmentVariable("SHOP_PURCHASE_METHOD_WIRE_DIR") is not { Length: > 0 } directory) return;
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, name + ".json"), value.ToJsonString());
    }
}

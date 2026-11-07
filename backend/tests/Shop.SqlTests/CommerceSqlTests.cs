using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;
public sealed class CommerceSqlTests(SqlFixture fixture) : IClassFixture<SqlFixture>
{
    private static async Task<JsonNode> Json(HttpResponseMessage response) { var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {text}"); return JsonNode.Parse(text)!; }
    private async Task<(HttpClient Client, string Refresh, string Pending, string Secret)> SignIn()
    {
        var account = await fixture.CreateAdministratorAsync(); var client = fixture.Factory.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Json(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = account.Username, account.Password }));
        Assert.True(pending["requiresMfa"]!.GetValue<bool>()); var token = pending["accessToken"]!.GetValue<string>(); client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/catalog")).StatusCode);
        var setup = await Json(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })); var secret = setup["secret"]!.GetValue<string>();
        var setupToken = setup["accessToken"]!.GetValue<string>(); client.DefaultRequestHeaders.Authorization = new("Bearer", setupToken);
        var response = await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(secret, DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) }); var signedIn = await Json(response);
        var cookie = response.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("sayman_admin_refresh=", StringComparison.Ordinal)); Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        client.DefaultRequestHeaders.Authorization = new("Bearer", signedIn["accessToken"]!.GetValue<string>());
        return (client, cookie.Split(';')[0], setupToken, secret);
    }
    [Fact] public async Task MfaEnrollmentAndRefreshRotationRejectReplays()
    {
        var session = await SignIn(); using var client = session.Client;
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/admin/catalog")).StatusCode);
        // The setup challenge is invalid after the security stamp changes on enrollment.
        using var repeated = new HttpRequestMessage(HttpMethod.Post, "/api/auth/mfa/verify") { Content = JsonContent.Create(new { Code = Totp.Code(session.Secret, DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) }) }; repeated.Headers.Authorization = new("Bearer", session.Pending);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(repeated)).StatusCode);
        client.DefaultRequestHeaders.Add("Cookie", session.Refresh);
        var refreshed = await client.PostAsJsonAsync("/api/auth/refresh", new { }); var rotated = await Json(refreshed);
        Assert.NotEqual(session.Refresh, refreshed.Headers.GetValues("Set-Cookie").Single().Split(';')[0]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/refresh", new { })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", rotated["accessToken"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }
    [Fact] public async Task DynamicAttributesPublishingStockIdempotencyAndCmsUseRealSql()
    {
        var session = await SignIn(); using var client = session.Client; var attributeIds = new List<string>();
        for (var i = 0; i < 8; i++) { var response = await Json(await client.PostAsJsonAsync("/api/admin/attributes", new { Key = "sql-attribute-" + i, DataType = "Text", Unit = (string?)null, Translations = new[] { new { Locale = "fa", Name = "ویژگی " + i, Description = "" }, new { Locale = "en", Name = "Attribute " + i, Description = "" } }, Options = Array.Empty<object>(), Version = (string?)null })); attributeIds.Add(response["id"]!.GetValue<string>()); }
        var translations = new[] { new { Locale = "fa", Name = "دستهٔ SQL", Description = "آزمایش" }, new { Locale = "en", Name = "SQL category", Description = "Test" } };
        var category = await Json(await client.PostAsJsonAsync("/api/admin/categories", new { Slug = "sql-category", ParentId = (string?)null, ImageUrl = "/products/charger.svg", SortOrder = 99, IsActive = true, Translations = translations, Attributes = attributeIds.Select(id => new { AttributeId = id, IsRequired = true, IsFilterable = true, IsComparable = true, ShowInSpecs = true, IsVariantAxis = false, SortOrder = 0, GroupName = "test" }), Version = (string?)null })); var categoryId = category["id"]!.GetValue<string>();
        var admin = await Json(await client.GetAsync("/api/admin/catalog")); var brandId = admin["brands"]![0]!["id"]!.GetValue<string>();
        var product = await Json(await client.PostAsJsonAsync("/api/admin/products", new { CategoryId = categoryId, BrandId = brandId, Slug = "sql-dynamic-product", Status = "Published", IsDigital = false, Featured = false, Translations = translations, Attributes = attributeIds.Select(id => new { AttributeId = id, TextFa = "مقدار " + id, TextEn = "Value " + id }), Variants = new[] { new { Id = (string?)null, Sku = "SQL-DYNAMIC-1", PriceRial = "9223372036854775807", CompareAtRial = (string?)null, Color = "#ffffff", ColorNameFa = "سفید", ColorNameEn = "White", LabelFa = "استاندارد", LabelEn = "Standard", WarrantyFa = "آزمایش", WarrantyEn = "Test", IsActive = true, Attributes = Array.Empty<object>(), PurchaseMethodIds = Array.Empty<string>(), Version = (string?)null } }, ImageUrls = new[] { "/products/charger.svg" }, PurchaseMethodIds = new[] { "online" }, ChequePlanIds = Array.Empty<string>(), Version = (string?)null })); var productId = product["id"]!.GetValue<string>();
        admin = await Json(await client.GetAsync("/api/admin/catalog")); var savedProduct = admin["products"]!.AsArray().Single(p => p!["id"]!.GetValue<string>() == productId)!; var variantId = savedProduct["variants"]![0]!["id"]!.GetValue<string>();
        var requestId = Guid.NewGuid().ToString(); var adjustment = new { Delta = 5, Reason = "SQL integration receipt", RequestId = requestId, Version = (string?)null };
        _ = await Json(await client.PostAsJsonAsync($"/api/admin/inventory/{variantId}/adjust", adjustment)); _ = await Json(await client.PostAsJsonAsync($"/api/admin/inventory/{variantId}/adjust", adjustment));
        var stock = await Json(await client.GetAsync("/api/admin/inventory")); var item = stock["stock"]!.AsArray().Single(s => s!["variantId"]!.GetValue<string>() == variantId)!; Assert.Equal(5, item["onHand"]!.GetValue<int>()); Assert.Single(stock["movements"]!.AsArray(), m => m!["variantId"]!.GetValue<string>() == variantId);
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => client.PostAsJsonAsync($"/api/admin/inventory/{variantId}/adjust", new { Delta = 1, Reason = "Concurrent receipt", RequestId = Guid.NewGuid().ToString(), Version = item["version"]!.GetValue<string>() })));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK); Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict); foreach (var response in responses) response.Dispose();
        var publicData = await Json(await client.GetAsync("/api/storefront/en")); var published = publicData["products"]!.AsArray().Single(p => p!["id"]!.GetValue<string>() == productId)!;
        Assert.Equal("9223372036854775807", published["variants"]![0]!["priceRial"]!.GetValue<string>()); Assert.Equal(6, published["variants"]![0]!["stock"]!.GetValue<int>()); Assert.Equal(8, published["attributes"]!.AsObject().Count); Assert.Equal(8, publicData["categories"]!.AsArray().Single(c => c!["key"]!.GetValue<string>() == categoryId)!["filters"]!.AsArray().Count);
        var content = await Json(await client.GetAsync("/api/admin/content")); var doc = content["documents"]!.AsArray().Single(d => d!["key"]!.GetValue<string>() == "site" && d["locale"]!.GetValue<string>() == "fa")!; var draft = JsonNode.Parse(doc["draftJson"]!.GetValue<string>())!.AsObject(); var previous = draft["announcement"]!.GetValue<string>(); draft["announcement"] = "انتشار از تست SQL";
        var saveDraft = await client.PutAsJsonAsync("/api/admin/content/site/fa", new { Content = draft, Version = doc["version"]!.GetValue<string>() }); Assert.Equal(HttpStatusCode.NoContent, saveDraft.StatusCode);
        var before = await Json(await client.GetAsync("/api/storefront/fa")); Assert.Equal(previous, before["site"]!["announcement"]!.GetValue<string>());
        content = await Json(await client.GetAsync("/api/admin/content")); doc = content["documents"]!.AsArray().Single(d => d!["key"]!.GetValue<string>() == "site" && d["locale"]!.GetValue<string>() == "fa")!;
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = doc["version"]!.GetValue<string>(), RestoreRevisionId = (string?)null })).StatusCode);
        var after = await Json(await client.GetAsync("/api/storefront/fa")); Assert.Equal("انتشار از تست SQL", after["site"]!["announcement"]!.GetValue<string>());
    }
    [Fact] public async Task SpotlightTranslationPreservesSharedSelectionAndPublicLookupFiltersHiddenProducts()
    {
        var session=await SignIn();using var client=session.Client;
        using var anonymous=fixture.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.PutAsJsonAsync("/api/admin/content/site/en",new{})).StatusCode);
        var before=await Json(await client.GetAsync("/api/storefront/en"));
        Assert.Contains(before["site"]!["homeBlocks"]!.AsArray(),b=>b!["kind"]!.GetValue<string>()=="spotlight");
        var pricesBefore=await Json(await client.PostAsJsonAsync("/api/catalog/en/lookup",new{ProductIds=new[]{"p1","p2"},Slugs=Array.Empty<string>(),VariantIds=Array.Empty<string>()}));
        async Task<JsonNode> Document(){var content=await Json(await client.GetAsync("/api/admin/content"));return content["documents"]!.AsArray().Single(d=>d!["key"]!.GetValue<string>()=="site"&&d["locale"]!.GetValue<string>()=="en")!;}
        var all=await Json(await client.GetAsync("/api/admin/content"));
        var originalRevision=all["revisions"]!.AsArray().First(r=>r!["key"]!.GetValue<string>()=="site"&&r["locale"]!.GetValue<string>()=="en")!["id"]!.GetValue<string>();
        var doc=await Document();var draft=JsonNode.Parse(doc["draftJson"]!.GetValue<string>())!.AsObject();
        var block=draft["homeBlocks"]!.AsArray().Single(b=>b!["kind"]!.GetValue<string>()=="spotlight")!;
        block["title"]="SQL curated sample";block["productIds"]=new JsonArray("p2","p1","not-public");
        Assert.Equal(HttpStatusCode.NoContent,(await client.PutAsJsonAsync("/api/admin/content/site/en",new{Content=draft,Version=doc["version"]!.GetValue<string>()})).StatusCode);
        var unpublished=await Json(await client.GetAsync("/api/storefront/en"));Assert.Equal(before["site"]!.ToJsonString(),unpublished["site"]!.ToJsonString());
        doc=await Document();var stale=doc["version"]!.GetValue<string>();
        Assert.Equal(HttpStatusCode.NoContent,(await client.PostAsJsonAsync("/api/admin/content/site/en/publish",new{Version=stale,RestoreRevisionId=(string?)null})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsJsonAsync("/api/admin/content/site/en/publish",new{Version=stale,RestoreRevisionId=(string?)null})).StatusCode);
        var published=await Json(await client.GetAsync("/api/storefront/en"));var selected=published["site"]!["homeBlocks"]!.AsArray().Single(b=>b!["kind"]!.GetValue<string>()=="spotlight")!;
        Assert.Equal("SQL curated sample",selected["title"]!.GetValue<string>());var originalBlock=before["site"]!["homeBlocks"]!.AsArray().Single(b=>b!["kind"]!.GetValue<string>()=="spotlight")!;Assert.True(JsonNode.DeepEquals(originalBlock["productIds"],selected["productIds"]));
        var pricesAfter=await Json(await client.PostAsJsonAsync("/api/catalog/en/lookup",new{ProductIds=new[]{"p1","p2"},Slugs=Array.Empty<string>(),VariantIds=Array.Empty<string>()}));
        Assert.Equal(pricesBefore.ToJsonString(),pricesAfter.ToJsonString());
        await using(var scope=fixture.Factory.Services.CreateAsyncScope()){
            var db=scope.ServiceProvider.GetRequiredService<Shop.Modules.Catalog.Infrastructure.CatalogDbContext>();
            var hidden=await db.Products.SingleAsync(p=>p.Id=="p2");hidden.Status="Hidden";await db.SaveChangesAsync();
        }
        var lookup=await Json(await client.PostAsJsonAsync("/api/catalog/en/lookup",new{ProductIds=new[]{"p2","p1","not-public"},Slugs=Array.Empty<string>(),VariantIds=Array.Empty<string>()}));
        var item=Assert.Single(lookup["products"]!.AsArray());Assert.Equal("p1",item!["id"]!.GetValue<string>());Assert.Equal("689000000",item["variants"]!.AsArray().Single(v=>v!["sku"]!.GetValue<string>()=="APL-16-128-W")!["priceRial"]!.GetValue<string>());
        doc=await Document();Assert.Equal(HttpStatusCode.NoContent,(await client.PostAsJsonAsync("/api/admin/content/site/en/publish",new{Version=doc["version"]!.GetValue<string>(),RestoreRevisionId=originalRevision})).StatusCode);
        var restored=await Json(await client.GetAsync("/api/storefront/en"));Assert.Equal(before["site"]!.ToJsonString(),restored["site"]!.ToJsonString());
    }
}

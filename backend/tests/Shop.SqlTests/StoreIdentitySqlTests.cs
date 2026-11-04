using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Shop.SharedKernel;
using Xunit;

namespace Shop.SqlTests;

public sealed class StoreIdentitySqlTests(SqlFixture sql) : IClassFixture<SqlFixture>, IDisposable
{
    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>? requests;
    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> Requests => requests ??= sql.Factory.WithWebHostBuilder(_ => { });
    public void Dispose() => requests?.Dispose();

    [Fact]
    public async Task DraftIsPrivatePublishIsPublicAndStaleSaveDoesNotOverwrite()
    {
        using var staff = await Staff();
        var before = await Public();
        var document = await Document(staff);
        var content = JsonNode.Parse(S(document, "draftJson"))!.AsObject();
        content["storeIdentity"] = Example();
        await Empty(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version"))));
        Assert.Equal(before, await Public());
        var saved = await Document(staff);
        await Reject(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version"))), "version_conflict");
        Assert.Equal(saved.ToJsonString(), (await Document(staff)).ToJsonString());
        await Empty(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(saved, "version"), RestoreRevisionId = (string?)null }));
        var published = JsonNode.Parse(await Public())!.AsObject();
        Assert.True(published["storeIdentity"]!["demonstration"]!.GetValue<bool>());
        Assert.Equal("/support", published["storeIdentity"]!["policyLinks"]![0]!["href"]!.GetValue<string>());
    }

    [Fact]
    public async Task SocialPublicationUpdatesPublicLinksAndLeavesOtherDraftChangesPrivate()
    {
        using var staff = await Staff();
        const string path = "/api/admin/content/site/fa/publish";
        var initial = await Document(staff);
        var baseline = JsonNode.Parse(S(initial, "publishedJson"))!.AsObject();
        var draft = JsonNode.Parse(S(initial, "draftJson"))!.AsObject();
        draft["tagline"] = "Unpublished tagline";
        draft["storeIdentity"] = JsonNode.Parse("""
            {"socialLinks":[{"platform":"linkedin","url":"https://www.linkedin.com/company/sayman-test","enabled":true}],"policyLinks":[{"id":"terms","title":"Unpublished terms","href":"/support","enabled":true}]}
            """);
        await Empty(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(draft, S(initial, "version"))));
        var saved = await Document(staff);
        var version = S(saved, "version");
        await Reject(await staff.PostAsJsonAsync(path, new { Version = version, Section = "nav" }), "invalid_publish_section");
        await Reject(await staff.PostAsJsonAsync(path, new { Version = version, Section = "socialLinks", RestoreRevisionId = "1" }), "invalid_publish_section");
        await Reject(await staff.PostAsJsonAsync(path, new { Version = S(initial, "version"), Section = "socialLinks" }), "version_conflict");
        await Empty(await staff.PostAsJsonAsync(path, new { Version = version, Section = "socialLinks" }));
        var published = await Document(staff);
        Assert.Equal(S(saved, "draftJson"), S(published, "draftJson"));
        if (baseline["storeIdentity"] is not JsonObject identity)
        {
            identity = new JsonObject();
            baseline["storeIdentity"] = identity;
        }
        identity["socialLinks"] = draft["storeIdentity"]!["socialLinks"]!.DeepClone();
        Assert.True(JsonNode.DeepEquals(baseline, JsonNode.Parse(S(published, "publishedJson"))));
        var storefront = JsonNode.Parse(await Public())!.AsObject();
        Assert.Equal("https://www.linkedin.com/company/sayman-test", S(storefront["storeIdentity"]!["socialLinks"]![0]!, "url"));
        Assert.NotEqual("Unpublished tagline", S(storefront, "tagline"));
        await Reject(await staff.PostAsJsonAsync(path, new { Version = S(published, "version"), Section = "socialLinks" }), "no_social_link_changes");
        Assert.Equal(S(published, "version"), S(await Document(staff), "version"));
    }

    [Fact]
    public async Task ProductionProjectionHidesPersistedExampleAndProductionPublishAndRestoreRejectIt()
    {
        using var staff = await Staff();
        var document = await Document(staff); var content = JsonNode.Parse(S(document, "draftJson"))!.AsObject(); content["storeIdentity"] = Example();
        await Empty(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version"))));
        document = await Document(staff);
        await Empty(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = (string?)null }));
        document = await Document(staff);
        var before = document.ToJsonString();
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        var production = new ContentService(db, scope.ServiceProvider.GetRequiredService<IPublicImageReferences>(), scope.ServiceProvider.GetRequiredService<ICustomerLoginContinuity>());
        Assert.Null((await production.ReadAsync("site", "fa", default))["storeIdentity"]);
        var id = await db.Revisions.Where(r => r.Key == "site" && r.Locale == "fa").OrderByDescending(r => r.Id).Select(r => r.Id).FirstAsync();
        foreach (var restore in new long?[] { null, id })
            Assert.Equal("development_identity_only", (await Assert.ThrowsAsync<BusinessException>(() => production.PublishAsync("site", "fa", S(document, "version"), "fixture", restore, default))).Code);
        Assert.Equal("development_identity_only", (await Assert.ThrowsAsync<BusinessException>(() => production.SaveAsync("site", "fa", new(content, S(document, "version")), "fixture", default))).Code);
        Assert.Equal(before, (await Document(staff)).ToJsonString());
    }

    [Fact]
    public async Task UnsafeIdentityAndMissingBadgeImageCannotChangeDraftOrAudit()
    {
        using var staff = await Staff();
        foreach (var identity in new[] {
            """{"badges":[{"id":"enamad","kind":"enamad","title":"نماد","verificationUrl":"https://trustseal.enamad.ir.evil.test/check","enabled":true}]}""",
            """{"socialLinks":[{"platform":"telegram","url":"javascript:alert(1)","enabled":true}]}""",
            """{"html":"<script>alert(1)</script>"}"""
        })
        {
            var before = await State(staff); var document = await Document(staff); var content = JsonNode.Parse(S(document, "draftJson"))!.AsObject(); content["storeIdentity"] = JsonNode.Parse(identity);
            await Reject(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version"))), "invalid_store_identity");
            Assert.Equal(before, await State(staff));
        }
        var unchanged = await State(staff); var doc = await Document(staff); var imageContent = JsonNode.Parse(S(doc, "draftJson"))!.AsObject(); imageContent["storeIdentity"] = License(Id());
        await Reject(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(imageContent, S(doc, "version"))), "image_not_ready");
        Assert.Equal(unchanged, await State(staff));
    }

    [Fact]
    public async Task BadgeImageMustRemainReadyAtPublishAndRestore()
    {
        using var staff = await Staff(); var asset = await Asset();
        var document = await Document(staff); var content = JsonNode.Parse(S(document, "draftJson"))!.AsObject(); content["storeIdentity"] = License(asset);
        await Empty(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version"))));
        document = await Document(staff); await Status(asset, "Failed");
        var before = await State(staff);
        await Reject(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = (string?)null }), "image_not_ready");
        Assert.Equal(before, await State(staff)); await Status(asset, "Ready");
        await Empty(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = (string?)null }));
        long restore;
        await using (var scope = sql.Factory.Services.CreateAsyncScope()) restore = await scope.ServiceProvider.GetRequiredService<CmsDbContext>().Revisions.Where(r => r.Key == "site" && r.Locale == "fa").MaxAsync(r => r.Id);
        document = await Document(staff); content = JsonNode.Parse(S(document, "draftJson"))!.AsObject(); content.Remove("storeIdentity");
        await Empty(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version")))); document = await Document(staff);
        await Empty(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = (string?)null })); document = await Document(staff);
        await Status(asset, "Failed"); before = await State(staff);
        await Reject(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = restore.ToString() }), "image_not_ready");
        Assert.Equal(before, await State(staff));
    }

    private async Task<HttpClient> Staff()
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>(); var name = "identity" + Id();
        var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true, RequireMfa = true };
        Assert.True((await users.CreateAsync(user, sql.Password)).Succeeded); Assert.True((await users.AddToRoleAsync(user, "ContentManager")).Succeeded);
        var client = Requests.CreateClient(new() { HandleCookies = false }); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173"); client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin"); client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Read(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = name, Password = sql.Password })); client.DefaultRequestHeaders.Authorization = new("Bearer", S(pending, "accessToken"));
        var setup = await Read(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { })); client.DefaultRequestHeaders.Authorization = new("Bearer", S(setup, "accessToken"));
        var signed = await Read(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(S(setup, "secret"), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) })); client.DefaultRequestHeaders.Authorization = new("Bearer", S(signed, "accessToken")); return client;
    }
    private async Task<string> State(HttpClient staff)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        return (await Document(staff)).ToJsonString() + ":" + await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync() + ":" + await scope.ServiceProvider.GetRequiredService<CmsDbContext>().Revisions.CountAsync();
    }
    private async Task<JsonNode> Document(HttpClient staff) => (await Read(await staff.GetAsync("/api/admin/content")))["documents"]!.AsArray().Single(n => S(n!, "key") == "site" && S(n!, "locale") == "fa")!;
    private async Task<string> Public() { using var client = sql.Factory.CreateClient(new() { HandleCookies = false }); return (await Read(await client.GetAsync("/api/storefront/fa?metadataOnly=true")))["site"]!.ToJsonString(); }
    private static JsonObject Example() => JsonNode.Parse("""{"demonstration":true,"policyLinks":[{"id":"terms","title":"شرایط خرید و مرجوعی","href":"/support","enabled":true}]}""")!.AsObject();
    private static JsonObject License(string asset) => new() { ["badges"] = new JsonArray(new JsonObject { ["id"] = "fixture", ["kind"] = "license", ["title"] = "مجوز مصنوعی آزمون", ["verificationUrl"] = "https://issuer.example/fixture", ["imageUrl"] = PublicImagePaths.Url(asset, "card"), ["enabled"] = true }) };
    private async Task<string> Asset()
    {
        var id = Id(); await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        db.PublicImages.Add(new() { Id = id, Status = "Ready", CreatedBy = "identity-synthetic-fixture", InputBytes = 3, Width = 32, Height = 32, OriginalSha256 = new string('a', 64), Variants = PublicImagePaths.Names.Select(name => new PublicImageVariant { AssetId = id, Name = name, Width = 32, Height = 32, Bytes = 3, Sha256 = new string('a', 64) }).ToList() }); await db.SaveChangesAsync(); return id;
    }
    private async Task Status(string id, string status) { await using var scope = sql.Factory.Services.CreateAsyncScope(); await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().PublicImages.Where(x => x.Id == id).ExecuteUpdateAsync(x => x.SetProperty(p => p.Status, status)); }
    private static async Task<JsonNode> Read(HttpResponseMessage response) { using (response) { var body = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {body}"); return JsonNode.Parse(body)!; } }
    private static async Task Empty(HttpResponseMessage response) { using (response) Assert.Equal(HttpStatusCode.NoContent, response.StatusCode); }
    private static async Task Reject(HttpResponseMessage response, string code) { using (response) { Assert.False(response.IsSuccessStatusCode); Assert.Equal(code, S(JsonNode.Parse(await response.Content.ReadAsStringAsync())!, "title")); } }
    private static string S(JsonNode node, string key) => node[key]!.GetValue<string>(); private static string Id() => Guid.NewGuid().ToString("N");
}

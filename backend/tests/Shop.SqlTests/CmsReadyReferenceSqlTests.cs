using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Catalog.Media;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

// Only a short-lived SQL fixture is changed. Image rows below are synthetic
// readiness metadata; no scanner, object store or real account is exercised.
public sealed class CmsReadyReferenceSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>, IDisposable
{
    // xUnit creates this test class per case. Retain the real limiter, but keep
    // unrelated cases from consuming one shared host's authentication window.
    private WebApplicationFactory<Program>? requests;
    private WebApplicationFactory<Program> Requests => requests ??= sql.Factory.WithWebHostBuilder(_ => { });
    public void Dispose() => requests?.Dispose();

    [Fact]
    public async Task EverySiteImageSlotRejectsMissingAndNonReadyRowsBeforeAnyDraftOrAuditChange()
    {
        using var staff = await Staff();
        foreach (var state in new[] { "Missing", "Staged", "Failed", "Cleaning", "Purged" })
        {
            var id = await Asset(state);
            var before = await Snapshot(staff);
            var document = Document(await All(staff), "site");
            var content = SiteImages(JsonNode.Parse(S(document, "draftJson"))!.AsObject(), PublicImagePaths.Url(id, "card"));
            await Reject(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version"))), "image_not_ready");
            Assert.Equal(before, await Snapshot(staff));
        }
        var ready = await Asset("Ready");
        var doc = Document(await All(staff), "site");
        await NoContent(await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(
            SiteImages(JsonNode.Parse(S(doc, "draftJson"))!.AsObject(), PublicImagePaths.Url(ready, "zoom")), S(doc, "version"))));
        var saved = Document(await All(staff), "site");
        Assert.NotEqual(S(doc, "version"), S(saved, "version"));
    }

    [Fact]
    public async Task PublishAndRestoreRecheckRetainedSiteImagesWithoutChangingPublicationOrAnotherLocaleOnFailure()
    {
        using var staff = await Staff();
        using var anonymous = Requests.CreateClient(new() { HandleCookies = false });
        var all = await All(staff);
        var original = Document(all, "site");
        var revision = all["revisions"]!.AsArray().Single(x => S(x!, "key") == "site" && S(x!, "locale") == "fa" && x!["revision"]!.GetValue<int>() == original["revision"]!.GetValue<int>())!;
        var originalEn = (await Read(await anonymous.GetAsync("/api/storefront/en?metadataOnly=true"))).ToJsonString();
        var missing = PublicImagePaths.Url(Id(), "card");
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            var entity = await db.Documents.SingleAsync(x => x.Key == "site" && x.Locale == "fa");
            entity.DraftJson = SiteImages(JsonNode.Parse(entity.DraftJson)!.AsObject(), missing).ToJsonString();
            db.Revisions.Add(new() { Key = "site", Locale = "fa", Revision = 1_000_000, Json = entity.DraftJson, PublishedBy = "legacy-test-fixture" });
            await db.SaveChangesAsync();
        }
        var before = await Snapshot(staff);
        var current = Document(await All(staff), "site");
        await Reject(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(current, "version"), RestoreRevisionId = (string?)null }), "image_not_ready");
        Assert.Equal(before, await Snapshot(staff));
        var legacy = (await All(staff))["revisions"]!.AsArray().Single(x => S(x!, "key") == "site" && x!["revision"]!.GetValue<int>() == 1_000_000)!;
        await Reject(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(current, "version"), RestoreRevisionId = S(legacy, "id") }), "image_not_ready");
        Assert.Equal(before, await Snapshot(staff));
        Assert.Equal(originalEn, (await Read(await anonymous.GetAsync("/api/storefront/en?metadataOnly=true"))).ToJsonString());
        await NoContent(await staff.PostAsJsonAsync("/api/admin/content/site/fa/publish", new { Version = S(current, "version"), RestoreRevisionId = S(revision, "id") }));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PageAndBlogRequireReadyForCreateSavePublishRestoreButKeepReplayAndUnpublishAvailable(bool blog)
    {
        using var staff = await Staff();
        using var anonymous = Requests.CreateClient(new() { HandleCookies = false });
        var root = blog ? "/api/admin/blog-posts" : "/api/admin/pages";
        var slug = "media-" + Id();
        var missing = PublicImagePaths.Url(Id(), "card");
        var beforeCreate = await Snapshot(staff);
        await Reject(await Create(staff, root, blog, slug, missing, Id()), "image_not_ready");
        Assert.Equal(beforeCreate, await Snapshot(staff));

        var asset = await Asset("Ready");
        var url = PublicImagePaths.Url(asset, "card");
        var createCommand = Id();
        object createBody = blog
            ? new CmsBlogPostWrite("Create", Slug: slug, IsDemo: true, Content: Blog(url))
            : new CmsPageWrite("Create", Slug: slug, IsDemo: true, Content: Page(url));
        var created = await Read(await staff.PostAsJsonAsync(root + "/commands/" + createCommand, createBody));
        var identityKey = blog ? "postId" : "pageId";
        var path = root + "/" + S(created, identityKey);
        var beforeSave = await Snapshot(staff, path);
        await Reject(await Write(staff, path, blog, created, "Save", missing), "image_not_ready");
        Assert.Equal(beforeSave, await Snapshot(staff, path));

        var published = await Read(await Write(staff, path, blog, created, "Publish"));
        var publishedRevision = S(published, "revisionId");
        var beforePublic = await Read(await anonymous.GetAsync($"/api/content/{(blog ? "blog" : "pages")}/en/{slug}"));
        await Status(asset, "Failed");

        var beforeReplay = await Snapshot(staff, path);
        var replay = await Read(await staff.PostAsJsonAsync(root + "/commands/" + createCommand, createBody));
        Assert.True(replay["replayed"]!.GetValue<bool>());
        Assert.Equal(S(created, identityKey), S(replay, identityKey));
        Assert.Equal(beforeReplay, await Snapshot(staff, path));
        // Historical reads and acknowledgements remain inspectable; Ready is a
        // precondition for a fresh reference/publication, not a history rewrite.
        Assert.Equal(beforePublic.ToJsonString(), (await Read(await anonymous.GetAsync($"/api/content/{(blog ? "blog" : "pages")}/en/{slug}"))).ToJsonString());
        await Reject(await Write(staff, path, blog, published, "Publish"), "image_not_ready");
        Assert.Equal(beforeReplay, await Snapshot(staff, path));
        await Reject(await Write(staff, path, blog, published, "Restore", restore: publishedRevision), "image_not_ready");
        Assert.Equal(beforeReplay, await Snapshot(staff, path));

        var unpublished = await Read(await Write(staff, path, blog, published, "Unpublish"));
        using (var response = await anonymous.GetAsync($"/api/content/{(blog ? "blog" : "pages")}/fa/{slug}")) Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await Status(asset, "Ready");
        var restored = await Read(await Write(staff, path, blog, unpublished, "Restore", restore: publishedRevision));
        Assert.NotEqual(publishedRevision, S(restored, "revisionId"));
        var restoredPublic = await Read(await anonymous.GetAsync($"/api/content/{(blog ? "blog" : "pages")}/en/{slug}"));
        Assert.Equal(S(beforePublic, "title"), S(restoredPublic, "title"));
        Assert.Equal(beforePublic["blocks"]!.ToJsonString(), restoredPublic["blocks"]!.ToJsonString());
        Assert.Equal(S(restored, "revisionId"), S(restoredPublic, "revisionId"));
        if (blog) Assert.Equal(S(beforePublic, "firstPublishedAt"), S(restoredPublic, "firstPublishedAt"));
    }

    [Fact]
    public async Task AReadySiteImageDoesNotEscapeTheExistingAuditTransactionOnFailure()
    {
        using var staff = await Staff();
        var ready = await Asset("Ready");
        var document = Document(await All(staff), "site");
        var content = SiteImages(JsonNode.Parse(S(document, "draftJson"))!.AsObject(), PublicImagePaths.Url(ready, "card"));
        var before = await Snapshot(staff);
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync(
                "ALTER TABLE [identity].[Audit] WITH NOCHECK ADD CONSTRAINT CK_D57_CmsReadyAudit CHECK ([Resource] NOT LIKE '/api/admin/content/site/fa%')");
        try
        {
            using var failed = await staff.PutAsJsonAsync("/api/admin/content/site/fa", new ContentInput(content, S(document, "version")));
            Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode);
        }
        finally
        {
            await using var scope = sql.Factory.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Database.ExecuteSqlRawAsync("ALTER TABLE [identity].[Audit] DROP CONSTRAINT CK_D57_CmsReadyAudit");
        }
        Assert.Equal(before, await Snapshot(staff));
    }

    [Fact]
    public async Task AuthSavePublishAndLegacyRestoreCannotRemoveTheLastSupportedCustomerLogin()
    {
        using var staff = await Staff();
        using var anonymous = Requests.CreateClient(new() { HandleCookies = false });
        var document = Document(await All(staff), "auth");
        var bad = JsonNode.Parse(S(document, "draftJson"))!.AsObject();
        bad["emailPassword"] = false; bad["usernamePassword"] = false; bad["mobileOtp"] = true;
        var before = await Snapshot(staff);
        await Reject(await staff.PutAsJsonAsync("/api/admin/content/auth/fa", new ContentInput(bad, S(document, "version"))), "no_supported_login_method");
        Assert.Equal(before, await Snapshot(staff));

        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            var entity = await db.Documents.SingleAsync(x => x.Key == "auth" && x.Locale == "fa");
            entity.DraftJson = bad.ToJsonString();
            db.Revisions.Add(new() { Key = "auth", Locale = "fa", Revision = 1_000_000, Json = entity.DraftJson, PublishedBy = "legacy-test-fixture" });
            await db.SaveChangesAsync();
        }
        before = await Snapshot(staff);
        document = Document(await All(staff), "auth");
        await Reject(await staff.PostAsJsonAsync("/api/admin/content/auth/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = (string?)null }), "no_supported_login_method");
        Assert.Equal(before, await Snapshot(staff));
        var legacy = (await All(staff))["revisions"]!.AsArray().Single(x => S(x!, "key") == "auth" && x!["revision"]!.GetValue<int>() == 1_000_000)!;
        await Reject(await staff.PostAsJsonAsync("/api/admin/content/auth/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = S(legacy, "id") }), "no_supported_login_method");
        Assert.Equal(before, await Snapshot(staff));

        foreach (var email in new[] { true, false })
        {
            document = Document(await All(staff), "auth");
            var supported = bad.DeepClone().AsObject();
            supported["emailPassword"] = email; supported["usernamePassword"] = !email;
            await NoContent(await staff.PutAsJsonAsync("/api/admin/content/auth/fa", new ContentInput(supported, S(document, "version"))));
            document = Document(await All(staff), "auth");
            await NoContent(await staff.PostAsJsonAsync("/api/admin/content/auth/fa/publish", new { Version = S(document, "version"), RestoreRevisionId = (string?)null }));
            var effective = (await Read(await anonymous.GetAsync("/api/storefront/fa?metadataOnly=true")))["authSettings"]!;
            Assert.Equal(email, effective["emailPassword"]!.GetValue<bool>());
            Assert.Equal(!email, effective["usernamePassword"]!.GetValue<bool>());
            Assert.False(effective["mobileOtp"]!.GetValue<bool>());
            Assert.False(effective["registration"]!.GetValue<bool>());
            Assert.False(effective["passwordReset"]!.GetValue<bool>());
        }
    }

    private async Task<HttpClient> Staff()
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var name = "cmsready" + Id();
        var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true, RequireMfa = true };
        Assert.True((await users.CreateAsync(user, sql.Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, "ContentManager")).Succeeded);
        var client = Requests.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Read(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = name, Password = sql.Password }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", S(pending, "accessToken"));
        var setup = await Read(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", S(setup, "accessToken"));
        var signed = await Read(await client.PostAsJsonAsync("/api/auth/mfa/verify", new { Code = Totp.Code(S(setup, "secret"), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30) }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", S(signed, "accessToken"));
        return client;
    }

    private async Task<string> Asset(string status)
    {
        var id = Id(); if (status == "Missing") return id;
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
        db.PublicImages.Add(new() { Id = id, Status = status, CreatedBy = "d57-metadata-fixture", InputBytes = 3, Width = 32, Height = 32, OriginalSha256 = new string('a', 64),
            Variants = status == "Ready" ? PublicImagePaths.Names.Select(name => new PublicImageVariant { AssetId = id, Name = name, Width = 32, Height = 32, Bytes = 3, Sha256 = new string('a', 64) }).ToList() : [] });
        await db.SaveChangesAsync(); return id;
    }

    private async Task Status(string id, string status)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<CatalogDbContext>().PublicImages.Where(x => x.Id == id).ExecuteUpdateAsync(x => x.SetProperty(p => p.Status, status));
    }

    private sealed record State(string Documents, string? Detail, int Audit, int Pages, int PageRevisions, int PageCommands, int BlogPosts, int BlogRevisions, int BlogCommands);
    private async Task<State> Snapshot(HttpClient client, string? path = null)
    {
        var all = (await All(client)).ToJsonString();
        var detail = path is null ? null : (await Read(await client.GetAsync(path))).ToJsonString();
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var cms = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        return new(all, detail, await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(),
            await cms.Pages.CountAsync(), await cms.PageRevisions.CountAsync(), await cms.PageCommands.CountAsync(),
            await cms.BlogPosts.CountAsync(), await cms.BlogPostRevisions.CountAsync(), await cms.BlogPostCommands.CountAsync());
    }

    private static Task<HttpResponseMessage> Create(HttpClient client, string root, bool blog, string slug, string url, string command) => blog
        ? client.PostAsJsonAsync(root + "/commands/" + command, new CmsBlogPostWrite("Create", Slug: slug, IsDemo: true, Content: Blog(url)))
        : client.PostAsJsonAsync(root + "/commands/" + command, new CmsPageWrite("Create", Slug: slug, IsDemo: true, Content: Page(url)));
    private static Task<HttpResponseMessage> Write(HttpClient client, string path, bool blog, JsonNode head, string action, string? url = null, string? restore = null) => blog
        ? client.PostAsJsonAsync(path + "/commands/" + Id(), new CmsBlogPostWrite(action, S(head, "version"), Content: action == "Save" ? Blog(url!) : null, RestoreRevisionId: restore, Confirmed: action != "Save"))
        : client.PostAsJsonAsync(path + "/commands/" + Id(), new CmsPageWrite(action, S(head, "version"), Content: action == "Save" ? Page(url!) : null, RestoreRevisionId: restore, Confirmed: action != "Save"));
    private static CmsPageContent Page(string url) => new(new("عکس آزمون", "دادهٔ مصنوعی", [new(Id(), "Image", "Mobile", Image: url, Alt: "عکس مصنوعی")]), new("Test image", "Synthetic only", [new(Id(), "Image", "Desktop", Image: url, Alt: "Synthetic image")]));
    private static CmsBlogContent Blog(string url) => new(Page(url), "Organization", "سایمان آزمایشی", "Synthetic Sayman", url, "جلد مصنوعی", "Synthetic cover", []);
    private static JsonObject SiteImages(JsonObject value, string url)
    {
        value["logoUrl"] = url; value["hero"]!["image"] = url;
        value["seo"] ??= new JsonObject(); value["seo"]!["shareImage"] = url;
        value["homeBlocks"] ??= new JsonArray();
        value["homeBlocks"]!.AsArray().Add(new JsonObject { ["id"] = "ready-" + Id(), ["kind"] = "promotions", ["enabled"] = false,
            ["items"] = new JsonArray(new JsonObject { ["eyebrow"] = "Sample", ["title"] = "Sample", ["action"] = "View", ["href"] = "/catalog", ["image"] = url }) });
        return value;
    }
    private static Task<JsonNode> All(HttpClient client) => ReadResponse(client.GetAsync("/api/admin/content"));
    private static async Task<JsonNode> ReadResponse(Task<HttpResponseMessage> response) => await Read(await response);
    private static JsonNode Document(JsonNode all, string key) => all["documents"]!.AsArray().Single(x => S(x!, "key") == key && S(x!, "locale") == "fa")!;
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        using (response) { var raw = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {raw}"); return JsonNode.Parse(raw)!; }
    }
    private static async Task NoContent(HttpResponseMessage response) { using (response) Assert.Equal(HttpStatusCode.NoContent, response.StatusCode); }
    private static async Task Reject(HttpResponseMessage response, string code)
    {
        using (response) { Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!; Assert.Equal(code, S(body, "title")); }
    }
    private static string S(JsonNode node, string key) => node[key]!.GetValue<string>();
    private static string Id() => Guid.NewGuid().ToString("N");
}

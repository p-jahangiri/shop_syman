using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

public sealed class CmsAppearanceSqlTests : IAsyncLifetime
{
    private readonly SqlFixture sql = new();
    public Task InitializeAsync() => sql.InitializeAsync();
    public Task DisposeAsync() => sql.DisposeAsync();

    [Fact]
    public async Task AppearanceDraftIsPrivatePublicationUsesCasAndRestoreKeepsLocaleAndOtherSettings()
    {
        using var editor = await Staff("ContentManager");
        using var anonymous = sql.Factory.CreateClient(new() { HandleCookies = false });
        var originalFa = await PublicSite(anonymous, "fa");
        var originalEn = await PublicSite(anonymous, "en");
        var all = await Body(await editor.GetAsync("/api/admin/content"));
        var document = Document(all, "fa");
        var oldRevision = all["revisions"]!.AsArray().Single(x =>
            x!["key"]!.GetValue<string>() == "site" && x["locale"]!.GetValue<string>() == "fa" &&
            x["revision"]!.GetValue<int>() == document["revision"]!.GetValue<int>())!;
        var draft = JsonNode.Parse(document["draftJson"]!.GetValue<string>())!.AsObject();
        draft["appearance"] = JsonNode.Parse("""{"surface":"solid","density":"compact","corners":"soft","motion":"none","heroLayout":"compact","stickyHeader":false}""");
        var input = new ContentInput(draft, document["version"]!.GetValue<string>());
        await NoContent(await editor.PutAsJsonAsync("/api/admin/content/site/fa", input));
        Assert.Equal(originalFa.ToJsonString(), (await PublicSite(anonymous, "fa")).ToJsonString());
        using (var stale = await editor.PutAsJsonAsync("/api/admin/content/site/fa", input))
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        document = Document(await Body(await editor.GetAsync("/api/admin/content")), "fa");
        var publish = new { Version = document["version"]!.GetValue<string>(), RestoreRevisionId = (string?)null };
        await NoContent(await editor.PostAsJsonAsync("/api/admin/content/site/fa/publish", publish));
        using (var stale = await editor.PostAsJsonAsync("/api/admin/content/site/fa/publish", publish))
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var published = await PublicSite(anonymous, "fa");
        Assert.Equal(draft["appearance"]!.ToJsonString(), published["appearance"]!.ToJsonString());
        var originalWithoutAppearance = originalFa.DeepClone().AsObject(); originalWithoutAppearance.Remove("appearance");
        var publishedWithoutAppearance = published.DeepClone().AsObject(); publishedWithoutAppearance.Remove("appearance");
        Assert.Equal(originalWithoutAppearance.ToJsonString(), publishedWithoutAppearance.ToJsonString());
        Assert.Equal(originalEn.ToJsonString(), (await PublicSite(anonymous, "en")).ToJsonString());

        document = Document(await Body(await editor.GetAsync("/api/admin/content")), "fa");
        await NoContent(await editor.PostAsJsonAsync("/api/admin/content/site/fa/publish", new {
            Version = document["version"]!.GetValue<string>(), RestoreRevisionId = oldRevision["id"]!.GetValue<string>()
        }));
        Assert.Equal(originalFa.ToJsonString(), (await PublicSite(anonymous, "fa")).ToJsonString());
        Assert.Equal(originalEn.ToJsonString(), (await PublicSite(anonymous, "en")).ToJsonString());
    }

    [Fact]
    public async Task InvalidAppearanceAndUnauthorizedEditorsCannotChangeExistingDraftOrPublication()
    {
        using var editor = await Staff("ContentManager");
        using var support = await Staff("SupportAgent");
        using var anonymous = sql.Factory.CreateClient(new() { HandleCookies = false });
        anonymous.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        anonymous.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        anonymous.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var document = Document(await Body(await editor.GetAsync("/api/admin/content")), "fa");
        var content = JsonNode.Parse(document["draftJson"]!.GetValue<string>())!.AsObject();
        content["appearance"] = new JsonObject { ["surface"] = "glass", ["css"] = "body{display:none}" };
        var input = new ContentInput(content, document["version"]!.GetValue<string>());
        using (var denied = await support.PutAsJsonAsync("/api/admin/content/site/fa", input))
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using (var denied = await anonymous.PutAsJsonAsync("/api/admin/content/site/fa", input))
            Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        using (var invalid = await editor.PutAsJsonAsync("/api/admin/content/site/fa", input))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
            Assert.Equal("invalid_appearance", (await invalid.Content.ReadFromJsonAsync<JsonNode>())!["title"]!.GetValue<string>());
        }
        var after = Document(await Body(await editor.GetAsync("/api/admin/content")), "fa");
        Assert.Equal(document.ToJsonString(), after.ToJsonString());
    }

    [Fact]
    public async Task PublishingALegacyInvalidDraftCannotBypassTheAppearanceRulesOrAddARevision()
    {
        using var editor = await Staff("ContentManager");
        using var anonymous = sql.Factory.CreateClient(new() { HandleCookies = false });
        var original = await PublicSite(anonymous, "fa");
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            var row = await db.Documents.SingleAsync(x => x.Key == "site" && x.Locale == "fa");
            var invalid = JsonNode.Parse(row.DraftJson)!.AsObject();
            invalid["appearance"] = new JsonObject { ["motion"] = "infinite" };
            row.DraftJson = invalid.ToJsonString();
            await db.SaveChangesAsync();
        }
        var before = await Body(await editor.GetAsync("/api/admin/content"));
        var document = Document(before, "fa");
        using (var invalid = await editor.PostAsJsonAsync("/api/admin/content/site/fa/publish", new {
            Version = document["version"]!.GetValue<string>(), RestoreRevisionId = (string?)null
        })) Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var after = await Body(await editor.GetAsync("/api/admin/content"));
        Assert.Equal(document.ToJsonString(), Document(after, "fa").ToJsonString());
        Assert.Equal(before["revisions"]!.ToJsonString(), after["revisions"]!.ToJsonString());
        Assert.Equal(original.ToJsonString(), (await PublicSite(anonymous, "fa")).ToJsonString());
    }

    private static JsonNode Document(JsonNode all, string locale) => all["documents"]!.AsArray().Single(x =>
        x!["key"]!.GetValue<string>() == "site" && x["locale"]!.GetValue<string>() == locale)!;

    private static async Task<JsonNode> PublicSite(HttpClient client, string locale) =>
        (await Body(await client.GetAsync($"/api/storefront/{locale}?metadataOnly=true")))["site"]!;

    private static async Task<JsonNode> Body(HttpResponseMessage response)
    {
        using (response)
        {
            var raw = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {raw}");
            return JsonNode.Parse(raw)!;
        }
    }

    private static Task NoContent(HttpResponseMessage response)
    {
        using (response) Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        return Task.CompletedTask;
    }

    private async Task<HttpClient> Staff(string role)
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ShopUser>>();
        var name = "appearance" + Guid.NewGuid().ToString("N");
        var user = new ShopUser { UserName = name, Email = name + "@example.test", EmailConfirmed = true, RequireMfa = true };
        Assert.True((await users.CreateAsync(user, sql.Password)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        var client = sql.Factory.CreateClient(new() { HandleCookies = false });
        client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:3173");
        client.DefaultRequestHeaders.Add("X-Sayman-Client", "admin");
        client.DefaultRequestHeaders.Add("X-Sayman-Admin", "1");
        var pending = await Body(await client.PostAsJsonAsync("/api/auth/password", new { Identifier = name, Password = sql.Password }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", pending["accessToken"]!.GetValue<string>());
        var setup = await Body(await client.PostAsJsonAsync("/api/auth/mfa/setup", new { }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", setup["accessToken"]!.GetValue<string>());
        var signed = await Body(await client.PostAsJsonAsync("/api/auth/mfa/verify", new {
            Code = Totp.Code(setup["secret"]!.GetValue<string>(), DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30)
        }));
        client.DefaultRequestHeaders.Authorization = new("Bearer", signed["accessToken"]!.GetValue<string>());
        return client;
    }
}

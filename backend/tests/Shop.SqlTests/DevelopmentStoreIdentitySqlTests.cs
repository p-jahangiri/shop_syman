using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Cms;
using Shop.Modules.Identity;
using Xunit;

namespace Shop.SqlTests;

public sealed class DevelopmentStoreIdentitySqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [Fact]
    public async Task ExplicitDevelopmentExampleIsAtomicPreservesEveryOtherFieldAndIsIdempotent()
    {
        var before = await Snapshot();
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var production = new EnvironmentStub("Production");
            await Assert.ThrowsAsync<InvalidOperationException>(() => DevelopmentStoreIdentitySeed.RunAsync(scope.ServiceProvider, production, true, default));
        }
        Assert.Equal(before.ToJsonString(), (await Snapshot()).ToJsonString());
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var cms = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
            var en = await cms.Documents.SingleAsync(d => d.Key == "site" && d.Locale == "en");
            var oldDraft = en.DraftJson; var draft = JsonNode.Parse(oldDraft)!.AsObject(); draft["about"] = "Unpublished fixture edit"; en.DraftJson = draft.ToJsonString(); await cms.SaveChangesAsync();
        }
        var dirty = await Snapshot();
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
            await Assert.ThrowsAsync<InvalidOperationException>(() => DevelopmentStoreIdentitySeed.RunAsync(scope.ServiceProvider, new EnvironmentStub("Development"), true, default));
        Assert.Equal(dirty.ToJsonString(), (await Snapshot()).ToJsonString());
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>(); var en = await db.Documents.SingleAsync(d => d.Key == "site" && d.Locale == "en"); en.DraftJson = en.PublishedJson!; await db.SaveChangesAsync();
        }
        var clean = await Snapshot();
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var result = JsonSerializer.SerializeToNode(await DevelopmentStoreIdentitySeed.RunAsync(scope.ServiceProvider, new EnvironmentStub("Development"), false, default))!;
            Assert.Equal(2, result["ChangedLanguages"]!.GetValue<int>());
        }
        Assert.Equal(clean.ToJsonString(), (await Snapshot()).ToJsonString());
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var result = JsonSerializer.SerializeToNode(await DevelopmentStoreIdentitySeed.RunAsync(scope.ServiceProvider, new EnvironmentStub("Development"), true, default))!;
            Assert.Equal(2, result["ChangedLanguages"]!.GetValue<int>());
        }
        var after = await Snapshot();
        foreach (var locale in new[] { "fa", "en" })
        {
            var original = JsonNode.Parse(clean[locale]!["PublishedJson"]!.GetValue<string>())!;
            var published = JsonNode.Parse(after[locale]!["PublishedJson"]!.GetValue<string>())!.AsObject();
            Assert.True(published["storeIdentity"]!["demonstration"]!.GetValue<bool>());
            Assert.All(published["storeIdentity"]!["socialLinks"]!.AsArray(), row => { Assert.Equal("", row!["url"]!.GetValue<string>()); Assert.False(row["enabled"]!.GetValue<bool>()); });
            published.Remove("storeIdentity"); Assert.True(JsonNode.DeepEquals(original, published));
            Assert.Equal(clean[locale]!["Revision"]!.GetValue<int>() + 1, after[locale]!["Revision"]!.GetValue<int>());
        }
        Assert.Equal(clean["AuditCount"]!.GetValue<int>() + 2, after["AuditCount"]!.GetValue<int>());
        await using (var scope = sql.Factory.Services.CreateAsyncScope())
        {
            var result = JsonSerializer.SerializeToNode(await DevelopmentStoreIdentitySeed.RunAsync(scope.ServiceProvider, new EnvironmentStub("Development"), true, default))!;
            Assert.Equal(0, result["ChangedLanguages"]!.GetValue<int>());
        }
        Assert.Equal(after.ToJsonString(), (await Snapshot()).ToJsonString());
    }
    private async Task<JsonObject> Snapshot()
    {
        await using var scope = sql.Factory.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        var result = new JsonObject(); foreach (var d in await db.Documents.AsNoTracking().Where(d => d.Key == "site").OrderBy(d => d.Locale).ToListAsync()) result[d.Locale] = JsonSerializer.SerializeToNode(d);
        result["AuditCount"] = await scope.ServiceProvider.GetRequiredService<IdentityDbContext>().Audit.CountAsync(); result["Revisions"] = await db.Revisions.CountAsync(); return result;
    }
    private sealed class EnvironmentStub(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "StoreIdentityFixture";
        public string ContentRootPath { get; set; } = "/unused";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}

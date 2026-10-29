using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Shop.Modules.Cms;
using Xunit;

namespace Shop.SqlTests;
public sealed class DevelopmentNavigationSqlTests
{
    private sealed class ProductionEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Production";
        public string ApplicationName { get; set; } = "Shop.Api";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
    private static async Task<string> Snapshot(SqlFixture fixture)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CmsDbContext>();
        return JsonSerializer.Serialize(new { Documents = await db.Documents.AsNoTracking().OrderBy(d => d.Key).ThenBy(d => d.Locale).ToListAsync(), Revisions = await db.Revisions.AsNoTracking().OrderBy(d => d.Id).ToListAsync() });
    }
    private static async Task Run(SqlFixture fixture, bool apply)
    {
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        await DevelopmentNavigationSeed.RunAsync(scope.ServiceProvider, fixture.Factory.Services.GetRequiredService<IWebHostEnvironment>(), apply, CancellationToken.None);
    }
    [Fact] public async Task DryRunAndPublishPreserveContentAndCustomNestedLinkAndReplayWritesNothing()
    {
        var fixture = new SqlFixture(); await fixture.InitializeAsync();
        try {
            Dictionary<string, JsonObject> original;
            await using (var setup = fixture.Factory.Services.CreateAsyncScope()) {
                var db = setup.ServiceProvider.GetRequiredService<CmsDbContext>();
                var docs = await db.Documents.Where(d => d.Key == "site").ToListAsync();
                original = docs.ToDictionary(d => d.Locale, d => JsonNode.Parse(d.PublishedJson!)!.AsObject());
                // Preserve an operator's custom nested destination and its label.
                original["en"]["nav"]!.AsArray().Add(new JsonObject { ["label"] = "Custom group", ["href"] = "/catalog", ["children"] = new JsonArray(new JsonObject { ["label"] = "Operator market label", ["href"] = "/market" }) });
                foreach (var doc in docs) { doc.PublishedJson = original[doc.Locale].ToJsonString(); doc.DraftJson = original[doc.Locale].ToJsonString(new JsonSerializerOptions { WriteIndented = true }); }
                await db.SaveChangesAsync();
            }
            var before = await Snapshot(fixture);
            await Run(fixture, false); Assert.Equal(before, await Snapshot(fixture));
            await Run(fixture, true);
            await using (var verify = fixture.Factory.Services.CreateAsyncScope()) {
                var db = verify.ServiceProvider.GetRequiredService<CmsDbContext>();
                foreach (var doc in await db.Documents.AsNoTracking().Where(d => d.Key == "site").ToListAsync()) {
                    var actual = JsonNode.Parse(doc.PublishedJson!)!.AsObject();
                    if (doc.Locale == "en") { Assert.True(JsonNode.DeepEquals(original["en"], actual)); Assert.Equal(1, doc.Revision); }
                    else {
                        Assert.Equal(2, doc.Revision); Assert.Equal(doc.PublishedJson, doc.DraftJson); Assert.Equal("development-seed:market-navigation", doc.UpdatedBy);
                        var nav = actual["nav"]!.AsArray(); var added = Assert.Single(nav, n => n?["href"]?.ToString() == "/market"); Assert.Equal("کاتالوگ بازار", added!["label"]!.GetValue<string>()); nav.Remove(added);
                        Assert.True(JsonNode.DeepEquals(original["fa"], actual));
                        Assert.Single(await db.Revisions.Where(x => x.Key == "site" && x.Locale == "fa" && x.Revision == 2 && x.PublishedBy == doc.UpdatedBy).ToListAsync());
                    }
                }
            }
            var after = await Snapshot(fixture); await Run(fixture, true); Assert.Equal(after, await Snapshot(fixture));
        } finally { await fixture.DisposeAsync(); }
    }
    [Fact] public async Task ProductionUnpublishedDraftCapacityAndMissingLanguageNeverPartiallyPublish()
    {
        var fixture = new SqlFixture(); await fixture.InitializeAsync();
        try {
            var before = await Snapshot(fixture);
            await Assert.ThrowsAsync<InvalidOperationException>(() => DevelopmentNavigationSeed.RunAsync(fixture.Factory.Services, new ProductionEnvironment(), true, CancellationToken.None)); Assert.Equal(before, await Snapshot(fixture));
            foreach (var failure in new[] { "draft", "full", "missing" }) {
                await using (var setup = fixture.Factory.Services.CreateAsyncScope()) {
                    var db = setup.ServiceProvider.GetRequiredService<CmsDbContext>(); var en = await db.Documents.SingleAsync(d => d.Key == "site" && d.Locale == "en");
                    if (failure == "draft") { var site = JsonNode.Parse(en.PublishedJson!)!.AsObject(); site["announcement"] = "Unpublished operator text"; en.DraftJson = site.ToJsonString(); }
                    else if (failure == "full") { var site = JsonNode.Parse(en.PublishedJson!)!.AsObject(); site["nav"] = new JsonArray(Enumerable.Range(0, 50).Select(i => (JsonNode)new JsonObject { ["label"] = "Custom " + i, ["href"] = "/catalog?item=" + i }).ToArray()); en.PublishedJson = site.ToJsonString(); en.DraftJson = en.PublishedJson; }
                    else db.Documents.Remove(en);
                    await db.SaveChangesAsync();
                }
                var configured = await Snapshot(fixture); await Assert.ThrowsAsync<InvalidOperationException>(() => Run(fixture, true)); Assert.Equal(configured, await Snapshot(fixture));
                if (failure == "draft") { await using var reset = fixture.Factory.Services.CreateAsyncScope(); var db = reset.ServiceProvider.GetRequiredService<CmsDbContext>(); var en = await db.Documents.SingleAsync(d => d.Key == "site" && d.Locale == "en"); en.DraftJson = en.PublishedJson!; await db.SaveChangesAsync(); }
            }
        } finally { await fixture.DisposeAsync(); }
    }
}

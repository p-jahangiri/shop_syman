using System.Data;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Cms;

// Local CLI only. Both languages are checked before either is published.
public static class DevelopmentNavigationSeed
{
    public static async Task<object> RunAsync(IServiceProvider services, IHostEnvironment environment, bool apply, CancellationToken ct)
    {
        if (!environment.IsDevelopment()) throw new InvalidOperationException("Development navigation is unavailable outside Development.");
        var db = services.GetRequiredService<CmsDbContext>();
        var cms = services.GetRequiredService<ContentService>();
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var documents = await db.Documents.Where(d => d.Key == "site").OrderBy(d => d.Locale).ToListAsync(ct);
        if (documents.Count != 2 || documents.Any(d => d.Locale is not ("fa" or "en"))) throw new InvalidOperationException("Both existing site languages are required; no document will be created.");
        var changes = new List<(ContentDocument Document, JsonObject Content)>();
        var result = new Dictionary<string, string>();
        foreach (var document in documents) {
            var published = JsonNode.Parse(document.PublishedJson ?? throw new InvalidOperationException("An existing published site is required."));
            var content = JsonNode.Parse(document.DraftJson)!.AsObject();
            if (!JsonNode.DeepEquals(content, published)) throw new InvalidOperationException("An unpublished site draft exists. Preserve it and manage navigation from the admin.");
            ContentService.Validate("site", document.Locale, content);
            var nav = content["nav"]!.AsArray();
            if (ContainsMarket(nav)) { result[document.Locale] = "existing-market-link-preserved"; continue; }
            if (nav.Count >= 50) throw new InvalidOperationException("The menu is full. Manage its entries from the admin.");
            var after = nav.Select((n, i) => (Node: n, Index: i)).FirstOrDefault(x => x.Node?["href"]?.ToString() == "/moments");
            var index = after.Node is null ? nav.Count : after.Index + 1;
            nav.Insert(index, new JsonObject { ["label"] = document.Locale == "fa" ? "کاتالوگ بازار" : "Market catalogue", ["href"] = "/market" });
            ContentService.Validate("site", document.Locale, content);
            changes.Add((document, content));
            result[document.Locale] = apply ? "development-market-link-published" : "market-link-ready";
        }
        if (apply) {
            const string actor = "development-seed:market-navigation";
            foreach (var (document, content) in changes) {
                await cms.SaveAsync("site", document.Locale, new(content, Convert.ToBase64String(document.Version)), actor, ct);
                await cms.PublishAsync("site", document.Locale, Convert.ToBase64String(document.Version), actor, null, ct);
            }
            await transaction.CommitAsync(ct);
        }
        return new { Applied = apply, ChangedLanguages = changes.Count, Languages = result };
    }

    private static bool ContainsMarket(JsonArray nav) => nav.Any(n => n?["href"]?.ToString() == "/market" || n?["children"] is JsonArray children && ContainsMarket(children));
}

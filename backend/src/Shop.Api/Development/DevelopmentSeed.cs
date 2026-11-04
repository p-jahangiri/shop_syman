using System.Text.Json.Nodes;
using System.Globalization;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Cms;
using Shop.Modules.Credit;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Payments;
using Shop.SharedKernel;
using Microsoft.EntityFrameworkCore;

public static class DevelopmentSeed
{
    // Explicit CLI-only sample insertion for an existing local database. It never
    // replaces an unpublished draft or rewrites a collection already managed by an admin.
    public static async Task<object> AddMomentsAsync(IServiceProvider services, IHostEnvironment environment, string contentRoot, CancellationToken ct)
    {
        if (!environment.IsDevelopment()) throw new InvalidOperationException("Development collections are unavailable outside Development.");
        var path = Path.GetFullPath(Path.Combine(contentRoot, "../../Seed/development.json"));
        if (!File.Exists(path)) path = Path.Combine(contentRoot, "Seed/development.json");
        var seed = JsonNode.Parse(await File.ReadAllTextAsync(path, ct))!;
        var db = services.GetRequiredService<CmsDbContext>();
        var cms = services.GetRequiredService<ContentService>();
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var result = new Dictionary<string,string>();
        foreach (var locale in new[] { "fa", "en" }) {
            var document = await db.Documents.SingleAsync(d => d.Key == "site" && d.Locale == locale, ct);
            if (document.DraftJson != document.PublishedJson) throw new InvalidOperationException("An unpublished site draft exists. Preserve it and manage collections from the admin.");
            var content = JsonNode.Parse(document.DraftJson)!.AsObject();
            var blocks = content["homeBlocks"] as JsonArray ?? new JsonArray();
            if (blocks.Any(b => b?["kind"]?.ToString() == "spotlight")) { result[locale] = "existing-collection-preserved"; continue; }
            var sampleSite = seed[locale]!["site"]!;
            var sample = sampleSite["homeBlocks"]!.AsArray().Single(b => b?["kind"]?.ToString() == "spotlight")!.DeepClone();
            if (blocks.Any(b => b?["id"]?.ToString() == sample["id"]!.ToString())) throw new InvalidOperationException("The sample block id is already in use. Manage it from the admin.");
            if (content["homeBlocks"] is null) content["homeBlocks"] = blocks;
            blocks.Insert(Math.Min(1, blocks.Count), sample);
            var nav = content["nav"]!.AsArray();
            if (!nav.Any(n => n?["href"]?.ToString() == "/moments")) nav.Insert(0, sampleSite["nav"]!.AsArray().Single(n => n?["href"]?.ToString() == "/moments")!.DeepClone());
            const string actor = "development-seed:moments";
            await cms.SaveAsync("site", locale, new(content, Convert.ToBase64String(document.Version)), actor, ct);
            await cms.PublishAsync("site", locale, Convert.ToBase64String(document.Version), actor, null, ct);
            result[locale] = "development-sample-published";
        }
        await transaction.CommitAsync(ct);
        return result;
    }
    public static async Task RunAsync(IServiceProvider services, IConfiguration config, string contentRoot)
    {
        var path = Path.GetFullPath(Path.Combine(contentRoot, "../../Seed/development.json"));
        if (!File.Exists(path)) path = Path.Combine(contentRoot, "Seed/development.json");
        var root = JsonNode.Parse(await File.ReadAllTextAsync(path))!;
        var fa = root["fa"]!; var en = root["en"]!; var ct = CancellationToken.None;
        static string S(JsonNode? node) => node?.GetValue<string>() ?? "";
        await services.GetRequiredService<PurchaseMethodService>().SeedAsync(fa["purchaseMethods"]!.AsArray().Select(m => {
            var e = en["purchaseMethods"]!.AsArray().Single(x => S(x!["id"]) == S(m!["id"]))!;
            return new PurchaseMethod { Id = S(m!["id"]), Kind = S(m["kind"]), NameFa = S(m["name"]), NameEn = S(e["name"]), DescriptionFa = S(m["description"]), DescriptionEn = S(e["description"]), Enabled = m["enabled"]!.GetValue<bool>(), RequiresApproval = m["requiresApproval"]!.GetValue<bool>(), MinAmountRial = PurchaseLimits.Parse(m["minAmountRial"]?.GetValue<string>()) };
        }), ct);
        await services.GetRequiredService<CreditPlanService>().SeedAsync(fa["chequePlans"]!.AsArray().Select(p => new ChequePlan { Id = S(p!["id"]), NameFa = $"طرح نمونهٔ {p["months"]} ماهه", NameEn = $"Sample {p["months"]}-month plan", Months = p["months"]!.GetValue<int>(), MarkupBasisPoints = (int)(p["markupPercent"]!.GetValue<decimal>() * 100), DownPaymentBasisPoints = (int)(p["downPaymentPercent"]!.GetValue<decimal>() * 100), IntervalMonths = p["intervalMonths"]!.GetValue<int>(), RoundingUnitRial = int.Parse(S(p["roundingUnitRial"]) is { Length: > 0 } rounding ? rounding : "10", CultureInfo.InvariantCulture), Enabled = true }), ct);
        var cms = services.GetRequiredService<ContentService>();
        foreach (var locale in new[] { "fa", "en" }) { await cms.SeedAsync("site", locale, root[locale]!["site"]!.AsObject(), ct); if (locale == "fa") await cms.SeedAsync("auth", locale, root[locale]!["authSettings"]!.AsObject(), ct); }
        await services.GetRequiredService<ICatalogService>().SeedAsync(path, ct);
        var quantities = fa["products"]!.AsArray().SelectMany(p => p!["variants"]!.AsArray()).ToDictionary(v => S(v!["id"]), v => v!["stock"]!.GetValue<int>());
        await services.GetRequiredService<InventoryService>().SeedAsync(quantities, ct);
        await services.GetRequiredService<AuthService>().BootstrapAdminAsync(config["Bootstrap:AdminPassword"] ?? throw new InvalidOperationException("Bootstrap__AdminPassword is required for the first local seed."), ct);
    }
}

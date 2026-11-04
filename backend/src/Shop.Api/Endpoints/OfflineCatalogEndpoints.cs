using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Cms;
using Shop.SharedKernel;

public sealed record OfflineSiteData(string Name, string Tagline, string? Primary);
public sealed record OfflineCatalogData(int Version, string Locale, DateTimeOffset GeneratedAt, bool IsPreview, OfflineSiteData Site, OfflineCategoryDto[] Categories, OfflineProductDto[] Products, bool Truncated);
public static class OfflineCatalogEndpoints
{
    public static OfflineSiteData PublicSite(JsonObject site)
    {
        if (site.Count == 0) throw new BusinessException("content_unpublished", "Storefront content has not been published.");
        var name = site["name"]?.GetValue<string>() ?? ""; var tagline = site["tagline"]?.GetValue<string>() ?? "";
        if (string.IsNullOrWhiteSpace(name)) throw new BusinessException("content_unpublished", "A published store name is required.");
        var color = site["palette"]?["primaryLight"]?.GetValue<string>();
        return new(OfflineCatalogRules.Text(name, 250), OfflineCatalogRules.Text(tagline, 800), color is not null && Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking) ? color : null);
    }
    public static void MapOfflineCatalog(this RouteGroupBuilder group)
    {
        group.MapGet("/offline", async (string locale, int? limit, ICatalogService catalog, ContentService cms, TimeProvider clock, CancellationToken ct) => {
            OfflineCatalogRules.Locale(locale); var count = OfflineCatalogRules.Limit(limit);
            var content = await cms.ReadAsync("site", locale, ct);
            var site = PublicSite(content);
            var data = await catalog.ReadOfflineAsync(locale, count, ct, !SiteAppearanceRules.ShowUsedProducts(content));
            // Matches the current explicit preview state of the storefront API.
            return Results.Ok(new OfflineCatalogData(1, locale, clock.GetUtcNow(), true, site, data.Categories, data.Products, data.Truncated));
        }).AllowAnonymous();
    }
}

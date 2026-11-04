using System.Globalization;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Cms;

public sealed record CatalogSitemapManifest(int Version, string DataSource, string Locale, bool IsPreview, bool AllowIndexing, int PageSize, string ProductCount, string CategoryCount);
public static class CatalogSitemapEndpoints
{
    public static void MapCatalogSitemap(this RouteGroupBuilder group)
    {
        group.MapGet("/sitemap", async (string locale, ICatalogService catalog, ContentService cms, CancellationToken ct) => {
            OfflineCatalogRules.Locale(locale); var site = await cms.ReadAsync("site", locale, ct);
            var enabled = site["seo"]?["allowIndexing"]?.GetValue<bool>() == true;
            var stats = enabled ? await catalog.SitemapStatisticsAsync(locale, ct, !SiteAppearanceRules.ShowUsedProducts(site)) : new CatalogSitemapStatistics(0, 0);
            // Keep the same preview gate as the current storefront API.
            return Results.Ok(new CatalogSitemapManifest(1, "api", locale, true, enabled, CatalogSitemapRules.PageSize, stats.ProductCount.ToString(CultureInfo.InvariantCulture), stats.CategoryCount.ToString(CultureInfo.InvariantCulture)));
        }).AllowAnonymous();
        group.MapGet("/sitemap/{kind}", async (string locale, string kind, int? page, ICatalogService catalog, ContentService cms, CancellationToken ct) => {
            CatalogSitemapRules.Validate(locale, kind, page ?? 1);
            if (kind != "products") return Results.Ok(await catalog.SitemapPageAsync(locale, kind, page ?? 1, ct));
            var hideUsed = !SiteAppearanceRules.ShowUsedProducts(await cms.ReadAsync("site", locale, ct));
            var alternate = locale == "fa" ? "en" : "fa";
            var hideUsedInAlternate = !SiteAppearanceRules.ShowUsedProducts(await cms.ReadAsync("site", alternate, ct));
            return Results.Ok(await catalog.SitemapPageAsync(locale, kind, page ?? 1, ct, hideUsed, hideUsedInAlternate));
        }).AllowAnonymous();
    }
}

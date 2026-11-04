using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;

namespace Shop.Modules.Catalog.Infrastructure;
public static class CatalogSitemapQuery
{
    public static IQueryable<Category> Categories(CatalogDbContext db, string locale)
    {
        OfflineCatalogRules.Locale(locale);
        return db.Categories.AsNoTracking().Where(c => c.IsActive && c.Translations.Any(t => t.Locale == locale && t.Name != ""));
    }
    public static IQueryable<Product> Products(CatalogDbContext db, string locale, DateTimeOffset now, bool hideUsed = false)
    {
        OfflineCatalogRules.Locale(locale);
        return db.Products.AsNoTracking().Where(p => p.Status == "Published" && (p.PublishAt == null || p.PublishAt <= now)
            && db.Categories.Any(c => c.Id == p.CategoryId && c.IsActive && c.Translations.Any(t => t.Locale == locale && t.Name != ""))
            && db.Brands.Any(b => b.Id == p.BrandId && b.IsActive) && p.Variants.Any(v => v.IsActive && (!hideUsed || v.UsedInspectionId == null))
            && p.Translations.Any(t => t.Locale == locale && t.Name != ""));
    }
    public static IQueryable<CatalogSitemapEntry> Page(CatalogDbContext db, string locale, string kind, int page, DateTimeOffset now, bool hideUsed = false, bool hideUsedInAlternate = false)
    {
        CatalogSitemapRules.Validate(locale, kind, page); var skip = checked((page - 1) * CatalogSitemapRules.PageSize);
        var hideUsedInFa = locale == "fa" ? hideUsed : hideUsedInAlternate;
        var hideUsedInEn = locale == "en" ? hideUsed : hideUsedInAlternate;
        return kind == "products"
            ? Products(db, locale, now, hideUsed).OrderBy(p => p.Id).Skip(skip).Take(CatalogSitemapRules.PageSize).Select(p => new CatalogSitemapEntry(p.Slug,
                (!hideUsedInFa || p.Variants.Any(v => v.IsActive && v.UsedInspectionId == null))
                    && p.Translations.Any(t => t.Locale == "fa" && t.Name != "") && db.Categories.Any(c => c.Id == p.CategoryId && c.IsActive && c.Translations.Any(t => t.Locale == "fa" && t.Name != "")),
                (!hideUsedInEn || p.Variants.Any(v => v.IsActive && v.UsedInspectionId == null))
                    && p.Translations.Any(t => t.Locale == "en" && t.Name != "") && db.Categories.Any(c => c.Id == p.CategoryId && c.IsActive && c.Translations.Any(t => t.Locale == "en" && t.Name != ""))))
            : Categories(db, locale).OrderBy(c => c.Id).Skip(skip).Take(CatalogSitemapRules.PageSize).Select(c => new CatalogSitemapEntry(c.Id,
                c.Translations.Any(t => t.Locale == "fa" && t.Name != ""), c.Translations.Any(t => t.Locale == "en" && t.Name != "")));
    }
}
public sealed partial class CatalogService
{
    public async Task<CatalogSitemapStatistics> SitemapStatisticsAsync(string locale, CancellationToken ct, bool hideUsed = false)
    {
        var products = await CatalogSitemapQuery.Products(db, locale, DateTimeOffset.UtcNow, hideUsed).LongCountAsync(ct);
        var categories = await CatalogSitemapQuery.Categories(db, locale).LongCountAsync(ct);
        CatalogSitemapRules.Pages(products); CatalogSitemapRules.Pages(categories); return new(products, categories);
    }
    public async Task<CatalogSitemapPage> SitemapPageAsync(string locale, string kind, int page, CancellationToken ct, bool hideUsed = false, bool hideUsedInAlternate = false)
    {
        var rows = await CatalogSitemapQuery.Page(db, locale, kind, page, DateTimeOffset.UtcNow, hideUsed, hideUsedInAlternate).ToArrayAsync(ct);
        return new(1, locale, kind, page, CatalogSitemapRules.PageSize, rows);
    }
}

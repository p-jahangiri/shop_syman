using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;

namespace Shop.Modules.Catalog.Infrastructure;

// A public projection only. No product graph, attributes, prices, warranty,
// stock view, purchase configuration or identity data are materialized.
public static class OfflineCatalogQuery
{
    public static IQueryable<OfflineCategoryDto> Categories(CatalogDbContext db, string locale)
    {
        OfflineCatalogRules.Locale(locale);
        var raw = db.Categories.AsNoTracking().Where(c => c.IsActive && c.Translations.Any(t => (t.Locale == locale || t.Locale == "fa") && t.Name != ""))
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Id).Select(c => new { Key = c.Id,
                Name = c.Translations.Where(t => t.Locale == locale && t.Name != "").Select(t => t.Name).FirstOrDefault() ?? c.Translations.Where(t => t.Locale == "fa").Select(t => t.Name).FirstOrDefault() ?? "",
                Description = c.Translations.Where(t => t.Locale == locale).Select(t => t.Description).FirstOrDefault() ?? c.Translations.Where(t => t.Locale == "fa").Select(t => t.Description).FirstOrDefault() ?? "" });
        return raw.Select(c => new OfflineCategoryDto(c.Key, c.Name.Length > 250 ? c.Name.Substring(0, 250) : c.Name, c.Description.Length > 800 ? c.Description.Substring(0, 800) : c.Description));
    }
    public static IQueryable<OfflineProductDto> Products(CatalogDbContext db, string locale, string[] categoryIds, DateTimeOffset now)
    {
        OfflineCatalogRules.Locale(locale);
        var raw = db.Products.AsNoTracking().Where(p => p.Status == "Published" && (p.PublishAt == null || p.PublishAt <= now)
                && categoryIds.Contains(p.CategoryId) && db.Brands.Any(b => b.Id == p.BrandId && b.IsActive)
                && p.Variants.Any(v => v.IsActive) && p.Translations.Any(t => (t.Locale == locale || t.Locale == "fa") && t.Name != ""))
            .OrderByDescending(p => p.Featured).ThenByDescending(p => p.CreatedAt).ThenBy(p => p.Id)
            .Select(p => new { p.Id, p.Slug,
                Name = p.Translations.Where(t => t.Locale == locale && t.Name != "").Select(t => t.Name).FirstOrDefault() ?? p.Translations.Where(t => t.Locale == "fa").Select(t => t.Name).FirstOrDefault() ?? "",
                Brand = db.Brands.Where(b => b.Id == p.BrandId).Select(b => b.Name).First(), Category = db.Categories.Where(c => c.Id == p.CategoryId).Select(c => c.Id).First(),
                Description = p.Translations.Where(t => t.Locale == locale).Select(t => t.Description).FirstOrDefault() ?? p.Translations.Where(t => t.Locale == "fa").Select(t => t.Description).FirstOrDefault() ?? "",
                Image = p.Media.Where(m => m.Type == "image").OrderBy(m => m.SortOrder).ThenBy(m => m.Id).Select(m => m.Url).FirstOrDefault() });
        return raw.Select(p => new OfflineProductDto(p.Id, p.Slug, p.Name.Length > 250 ? p.Name.Substring(0, 250) : p.Name,
            p.Brand.Length > 250 ? p.Brand.Substring(0, 250) : p.Brand, p.Category, p.Description.Length > 800 ? p.Description.Substring(0, 800) : p.Description, p.Image));
    }
}
public sealed partial class CatalogService
{
    public async Task<OfflineCatalogSlice> ReadOfflineAsync(string locale, int? requestedLimit, CancellationToken ct)
    {
        OfflineCatalogRules.Locale(locale); var limit = OfflineCatalogRules.Limit(requestedLimit);
        var categoryRows = await OfflineCatalogQuery.Categories(db, locale).Take(OfflineCatalogRules.CategoryLimit + 1).ToArrayAsync(ct);
        var categories = categoryRows.Take(OfflineCatalogRules.CategoryLimit).Select(c => c with { Name = OfflineCatalogRules.Text(c.Name, 250), Description = OfflineCatalogRules.Text(c.Description, 800) }).ToArray();
        var rows = await OfflineCatalogQuery.Products(db, locale, categories.Select(c => c.Key).ToArray(), DateTimeOffset.UtcNow).Take(limit + 1).ToArrayAsync(ct);
        var products = rows.Take(limit).Select(p => p with { Name = OfflineCatalogRules.Text(p.Name, 250), Brand = OfflineCatalogRules.Text(p.Brand, 250), Description = OfflineCatalogRules.Text(p.Description, 800), Image = OfflineCatalogRules.Image(p.Image) }).ToArray();
        return new(categories, products, categoryRows.Length > OfflineCatalogRules.CategoryLimit || rows.Length > limit);
    }
}

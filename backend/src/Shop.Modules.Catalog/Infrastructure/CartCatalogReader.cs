using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed partial class CatalogService : ICartCatalogReader
{
    public async Task<IReadOnlyDictionary<string, CartCatalogVariant>> ReadCartVariantsAsync(string locale, IReadOnlyCollection<string> variantIds, CancellationToken ct)
    {
        if (locale is not ("fa" or "en") || variantIds.Count > 64) throw new BusinessException("invalid_cart", "Use a supported locale and at most 64 variants.");
        var now = DateTimeOffset.UtcNow; var ids = variantIds.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var values = await (from variant in db.Variants.AsNoTracking()
                            join product in db.Products on variant.ProductId equals product.Id
                            where ids.Contains(variant.Id) && variant.IsActive && product.Status == "Published" && (product.PublishAt == null || product.PublishAt <= now)
                                && db.Categories.Any(c => c.Id == product.CategoryId && c.IsActive) && db.Brands.Any(b => b.Id == product.BrandId && b.IsActive)
                            select new { variant.Id, ProductId = product.Id, product.CategoryId, product.Slug, Name = product.Translations.Where(t => t.Locale == locale).Select(t => t.Name).FirstOrDefault(), Fallback = product.Translations.Where(t => t.Locale == "fa").Select(t => t.Name).FirstOrDefault(), Label = locale == "en" ? variant.LabelEn : variant.LabelFa, variant.PriceRial, product.IsDigital }).ToListAsync(ct);
        return values.ToDictionary(x => x.Id, x => new CartCatalogVariant(x.Id, x.ProductId, x.CategoryId, x.Slug, x.Name ?? x.Fallback ?? "", x.Label, x.PriceRial, x.IsDigital), StringComparer.OrdinalIgnoreCase);
    }
}

namespace Shop.SharedKernel;

public sealed record CartCatalogVariant(string Id, string ProductId, string CategoryId, string Slug, string Name, string Label, long PriceRial, bool IsDigital, long? CompareAtPriceRial = null);
// Publicly purchasable, bounded variants only. Sales never reads Catalog's context or tables.
public interface ICartCatalogReader
{
    Task<IReadOnlyDictionary<string, CartCatalogVariant>> ReadCartVariantsAsync(string locale, IReadOnlyCollection<string> variantIds, CancellationToken ct);
}

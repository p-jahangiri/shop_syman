using System.Globalization;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;

public sealed record ProductWorkspaceFilter(string Search, string Status, string? CategoryId, string? BrandId, string Availability, string Sort, bool Descending, int Page, int PageSize)
{
    public string Name { get; init; } = "";
    public long? MinPriceRial { get; init; }
    public long? MaxPriceRial { get; init; }
    public long? MinStock { get; init; }
    public long? MaxStock { get; init; }
    public long? MinVariants { get; init; }
    public long? MaxVariants { get; init; }
    public DateTimeOffset? UpdatedFrom { get; init; }
    public DateTimeOffset? UpdatedBefore { get; init; }
    public string[] CategoryIds { get; init; } = [];
    public string[] BrandIds { get; init; } = [];
    public string[] Statuses { get; init; } = [];

    public static ProductWorkspaceFilter Create(string? search = null, string? status = null, string? categoryId = null, string? brandId = null, string? availability = null, string? sort = null, string? direction = null, int page = 0, int pageSize = 25,
        string? name = null, string? minPriceRial = null, string? maxPriceRial = null, string? minStock = null, string? maxStock = null,
        string? minVariants = null, string? maxVariants = null, string? updatedFrom = null, string? updatedBefore = null,
        string? categoryIds = null, string? brandIds = null, string? statuses = null)
    {
        status ??= "all";
        availability ??= "all";
        sort ??= "updated";
        direction ??= "desc";
        if (search is { Length: > 120 } || status is not ("all" or "Draft" or "Published" or "Hidden" or "archived") || availability is not ("all" or "available" or "empty") || sort is not ("name" or "category" or "brand" or "status" or "price" or "stock" or "variants" or "updated") || direction is not ("asc" or "desc") || page is < 0 or > 100000 || pageSize is not (25 or 50 or 100))
            throw Invalid();
        var normalized = NormalizeTerm(search);
        var normalizedName = NormalizeTerm(name);
        var priceFrom = Bound(minPriceRial);
        var priceTo = Bound(maxPriceRial);
        var stockFrom = Bound(minStock);
        var stockTo = Bound(maxStock);
        var variantsFrom = Bound(minVariants, int.MaxValue);
        var variantsTo = Bound(maxVariants, int.MaxValue);
        var changedFrom = UtcInstant(updatedFrom);
        var changedBefore = UtcInstant(updatedBefore);
        if (priceFrom > priceTo || stockFrom > stockTo || variantsFrom > variantsTo || changedFrom >= changedBefore)
            throw Invalid();

        return new(normalized, status, string.IsNullOrWhiteSpace(categoryId) ? null : AdminProductQuery.Identifier(categoryId), string.IsNullOrWhiteSpace(brandId) ? null : AdminProductQuery.Identifier(brandId), availability, sort, direction == "desc", page, pageSize)
        {
            Name = normalizedName, MinPriceRial = priceFrom, MaxPriceRial = priceTo,
            MinStock = stockFrom, MaxStock = stockTo, MinVariants = variantsFrom, MaxVariants = variantsTo,
            UpdatedFrom = changedFrom, UpdatedBefore = changedBefore,
            CategoryIds = List(categoryIds, 32, 64, IsIdentifier),
            BrandIds = List(brandIds, 32, 64, IsIdentifier),
            Statuses = List(statuses, 4, 9, item => item is "Draft" or "Published" or "Hidden" or "archived")
        };
    }

    private static bool IsIdentifier(string value) =>
        value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    private static string[] List(string? value, int maxItems, int maxLength, Func<string, bool> isValid)
    {
        if (value is null)
            return [];
        if (value.Length > maxItems * (maxLength + 1) - 1)
            throw Invalid();
        var items = value.Split(',');
        if (items.Length > maxItems || items.Any(item => item.Length == 0 || item.Length > maxLength || !isValid(item)) ||
            items.Distinct(StringComparer.OrdinalIgnoreCase).Count() != items.Length)
            throw Invalid();
        return items;
    }

    private static string NormalizeTerm(string? value)
    {
        if (value is { Length: > 120 })
            throw Invalid();
        var normalized = PersianText.Normalize(value ?? "");
        if (normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 8)
            throw Invalid();
        return normalized;
    }

    private static long? Bound(string? value, long max = long.MaxValue)
    {
        if (value is null)
            return null;
        if (value.Length is < 1 or > 19 || (value.Length > 1 && value[0] == '0') ||
            !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed > max)
            throw Invalid();
        return parsed;
    }

    private static DateTimeOffset? UtcInstant(string? value)
    {
        if (value is null)
            return null;
        if (!DateTimeOffset.TryParseExact(value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var instant))
            throw Invalid();
        return instant;
    }

    private static BusinessException Invalid() => new("invalid_product_workspace_filter", "Use bounded product filters, a supported sort and page size.");
}
public sealed record ProductWorkspaceRow(string Id, string Version, string Slug, string NameFa, string NameEn, string CategoryId, string CategoryName, string BrandId, string BrandName, string Status, bool Archived, bool Featured, bool IsDigital, int VariantCount, int ActiveVariantCount, string? MinPriceRial, string? MaxPriceRial, string AvailableQuantity, string? ImageUrl, DateTimeOffset UpdatedAt);
public sealed record ProductWorkspacePage(int SchemaVersion, int Page, int PageSize, string TotalCount, ProductWorkspaceRow[] Items);
public sealed record ProductWorkspaceDetail(int SchemaVersion, AdminEditableProduct Product, bool Archived, ProductVideoDto[] Videos);
public interface IProductWorkspaceReader
{
    Task<ProductWorkspacePage> PageAsync(ProductWorkspaceFilter filter, CancellationToken ct);
    Task<ProductWorkspaceDetail> DetailAsync(string id, CancellationToken ct);
}
public sealed record ProductWorkspaceSaveInput(string RequestId, string? ProductId, ProductInput Product);
public sealed record ProductWorkspaceArchiveInput(string RequestId, string ProductId, string Version, bool Restore);
public sealed record ProductPriceLineInput(string VariantId, string Version, string PriceRial, string? CompareAtRial, bool IsActive);
public sealed record ProductWorkspacePricesInput(string RequestId, string ProductId, string Version, ProductPriceLineInput[] Lines);
public sealed record ProductWorkspaceReceipt(int SchemaVersion, string RequestId, string Kind, string? ProductId, string? ProductVersion, string[] VariantIds);

public static class ProductWorkspaceRules
{
    public static string RequestId(string id)
    {
        if (id is null || id.Length != 32 || id.Any(c => c is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
            throw new BusinessException("invalid_product_command", "Use a canonical command id.");
        return id;
    }
    public static void Price(string price, string? reference)
    {
        var value = CatalogRules.Money(price);
        if (reference is not null && CatalogRules.Money(reference) < value)
            throw new BusinessException("invalid_compare_price", "Reference price cannot be below the selling price.");
    }
    public static string Money(long value) => value.ToString(CultureInfo.InvariantCulture);
}

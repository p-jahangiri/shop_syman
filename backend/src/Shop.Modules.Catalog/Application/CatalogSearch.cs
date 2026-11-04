using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;

public record AttributeFilterInput(string Key, string[] Values);
public record CatalogSearchInput(string? CategoryId = null, string? Query = null, string[]? BrandIds = null,
    string? MinPriceRial = null, string? MaxPriceRial = null, bool AvailableOnly = false,
    string Sort = "selected", int Page = 1, int PageSize = 12, AttributeFilterInput[]? Attributes = null, string? Condition = null);
public record ProductLookupInput(string[]? ProductIds = null, string[]? VariantIds = null, string[]? Slugs = null);
public record CatalogSearchQuery(string? CategoryId, string[] Tokens, string[] BrandIds, long? MinPriceRial, long? MaxPriceRial,
    bool AvailableOnly, string Sort, int Page, int PageSize, AttributeFilterInput[] Attributes, string? Condition = null)
{
    public static CatalogSearchQuery Create(CatalogSearchInput input)
    {
        if (input.Page is < 1 or > 10000 || input.PageSize is < 1 or > 48 || input.Sort is not ("selected" or "price-asc" or "price-desc" or "newest")) throw new BusinessException("invalid_catalog_page", "Use a supported sort, page from 1 to 10000 and page size from 1 to 48.");
        var brands = input.BrandIds ?? []; var attributes = input.Attributes ?? [];
        if (input.CategoryId is { Length: > 64 } || input.Query is { Length: > 200 } || brands.Length > 20 || brands.Any(id => string.IsNullOrWhiteSpace(id) || id.Length > 64) || brands.Distinct().Count() != brands.Length || attributes.Length > 8 || attributes.Any(a => a is null) || attributes.Select(a => a.Key).Distinct().Count() != attributes.Length || attributes.Any(a => string.IsNullOrWhiteSpace(a.Key) || a.Key.Length > 150 || a.Values is null || a.Values.Length is < 1 or > 20 || a.Values.Any(v => v is null || v.Length is < 1 or > 2000) || a.Values.Distinct().Count() != a.Values.Length)) throw new BusinessException("invalid_catalog_filter", "Catalog filters must be unique, supported and bounded.");
        if (attributes.Length > 0 && string.IsNullOrWhiteSpace(input.CategoryId)) throw new BusinessException("filter_category_required", "Choose a category before filtering dynamic attributes.");
        var tokens = PersianText.Normalize(input.Query ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();
        if (tokens.Length > 8) throw new BusinessException("invalid_search_query", "Use at most eight search terms.");
        var min = PurchaseLimits.Parse(input.MinPriceRial); var max = PurchaseLimits.Parse(input.MaxPriceRial); PurchaseLimits.Validate(min, max);
        return new(string.IsNullOrWhiteSpace(input.CategoryId) ? null : input.CategoryId, tokens, brands, min, max, input.AvailableOnly, input.Sort, input.Page, input.PageSize, attributes, ValidateCondition(input.Condition));
    }
    public static string? ValidateCondition(string? condition) => condition is null or "new" or "used"
        ? condition
        : throw new BusinessException("invalid_catalog_condition", "Use new or used for the catalogue condition.");
    public static void ValidateLookup(ProductLookupInput input)
    {
        var ids = (input.ProductIds ?? []).Concat(input.VariantIds ?? []).ToArray(); var slugs = input.Slugs ?? [];
        if (ids.Length + slugs.Length is < 1 or > 64 || ids.Any(id => string.IsNullOrWhiteSpace(id) || id.Length > 64) || slugs.Any(s => string.IsNullOrWhiteSpace(s) || s.Length > 150)) throw new BusinessException("invalid_catalog_lookup", "Lookup requires between one and 64 bounded product, variant or slug identifiers.");
        foreach (var slug in slugs) CatalogRules.Slug(slug);
    }
}
public record CatalogSearchPage(int Version, string Locale, ProductDto[] Products, Dictionary<string,string> MatchingVariantIds, int Total, int Page, int PageSize, int TotalPages);
public record FacetValueDto(string Value, string Label);
public record AttributeFacetDto(string Key, string Label, string DataType, string? Unit, FacetValueDto[] Values, bool Truncated, int Total);
public record BrandFacetDto(string Id, string Name);
public record CatalogFiltersDto(BrandFacetDto[] Brands, AttributeFacetDto[] Attributes, string? MaxPriceRial);

public record FacetValuesInput(string CategoryId, string Key, string? Query = null, int Page = 1, int PageSize = 20, string[]? SelectedValues = null, string? Condition = null);
public record FacetValuesQuery(string CategoryId, string Key, string[] Tokens, int Page, int PageSize, string[] SelectedValues, string? Condition = null)
{
    public static FacetValuesQuery Create(FacetValuesInput input)
    {
        var selected = input.SelectedValues ?? [];
        if (string.IsNullOrWhiteSpace(input.CategoryId) || input.CategoryId.Length > 64 || string.IsNullOrWhiteSpace(input.Key) || input.Key.Length > 150 || input.Query is { Length: > 100 } || input.Page is < 1 or > 10000 || input.PageSize is < 1 or > 60 || selected.Length > 20 || selected.Any(v => string.IsNullOrWhiteSpace(v) || v.Length > 2000) || selected.Distinct().Count() != selected.Length)
            throw new BusinessException("invalid_facet_query", "Use a category, attribute key, bounded search/page and at most 20 unique selected values.");
        var tokens = PersianText.Normalize(input.Query ?? "").Split(' ',StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();
        if (tokens.Length > 8) throw new BusinessException("invalid_facet_query", "Use at most eight search terms.");
        return new(input.CategoryId,input.Key,tokens,input.Page,input.PageSize,selected,CatalogSearchQuery.ValidateCondition(input.Condition));
    }
}
public record FacetValuesPage(int Version, string Locale, string Key, FacetValueDto[] Values, FacetValueDto[] SelectedValues, int Total, int Page, int PageSize, int TotalPages);

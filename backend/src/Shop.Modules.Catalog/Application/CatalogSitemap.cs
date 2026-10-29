using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;
public sealed record CatalogSitemapStatistics(long ProductCount, long CategoryCount);
public sealed record CatalogSitemapEntry(string Key, bool Fa, bool En);
public sealed record CatalogSitemapPage(int Version, string Locale, string Kind, int Page, int PageSize, CatalogSitemapEntry[] Items);
public static class CatalogSitemapRules
{
    public const int PageSize = 1000;
    public const int MaximumPages = 50000;
    public static void Validate(string locale, string kind, int page)
    {
        OfflineCatalogRules.Locale(locale);
        if (kind is not ("products" or "categories") || page is < 1 or > MaximumPages) throw new BusinessException("invalid_sitemap_page", "Use products or categories and a page between 1 and 50000.");
    }
    public static int Pages(long count)
    {
        if (count < 0 || count > (long)PageSize * MaximumPages) throw new BusinessException("sitemap_capacity_unavailable", "The catalogue exceeds the current sitemap capacity.");
        return (int)((count + PageSize - 1) / PageSize);
    }
}

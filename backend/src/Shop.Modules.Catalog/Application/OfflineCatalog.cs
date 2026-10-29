using System.Text.RegularExpressions;
using Shop.Modules.Catalog.Media;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;
public sealed record OfflineCategoryDto(string Key, string Name, string Description);
public sealed record OfflineProductDto(string Id, string Slug, string Name, string Brand, string Category, string Description, string? Image);
public sealed record OfflineCatalogSlice(OfflineCategoryDto[] Categories, OfflineProductDto[] Products, bool Truncated);
public static class OfflineCatalogRules
{
    public const int DefaultLimit = 200;
    public const int MaximumLimit = 500;
    public const int CategoryLimit = 500;
    public static int Limit(int? value) => (value ?? DefaultLimit) is >= 1 and <= MaximumLimit ? value ?? DefaultLimit : throw new BusinessException("invalid_offline_limit", "Offline catalogue limits must be between 1 and 500 products.");
    public static void Locale(string locale) { if (locale is not ("fa" or "en")) throw new BusinessException("invalid_locale", "Use fa or en."); }
    public static string? Image(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 1000) return null;
        if (PublicImagePaths.TryParse(value, out var id, out _)) return PublicImagePaths.Url(id, "thumb");
        return Regex.IsMatch(value, "^/products/[a-zA-Z0-9/_-]+\\.svg$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking) ? value : null;
    }
    public static string Text(string value, int max) => value.Length > max ? value[..max] : value;
}

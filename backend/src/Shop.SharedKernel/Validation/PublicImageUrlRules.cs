using System.Text.RegularExpressions;

namespace Shop.SharedKernel;

public static partial class PublicImageUrlRules
{
    public static bool IsValid(string? value)
    {
        if (value is null || value.Length is < 1 or > 1500
            || value.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c == '\\')) return false;

        if (value.StartsWith('/'))
            return IssuedPath().IsMatch(value) || ProductPath().IsMatch(value);

        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && uri.Scheme == Uri.UriSchemeHttps
            && uri.Host.Length > 0
            && uri.UserInfo.Length == 0
            && uri.Fragment.Length == 0;
    }

    [GeneratedRegex(@"\A/media/catalog/[a-f0-9]{32}/(?:thumb|card|zoom)\.webp\z", RegexOptions.CultureInvariant)]
    private static partial Regex IssuedPath();

    [GeneratedRegex(@"\A/products/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\.(?:svg|png|jpe?g|webp|avif)\z", RegexOptions.CultureInvariant)]
    private static partial Regex ProductPath();
}

using Shop.SharedKernel;

public static class AuthHttpSecurity
{
    public static string CookieName(bool admin, bool development) => (development ? "" : "__Host-") + (admin ? "sayman_admin_refresh" : "sayman_refresh");
    public static CookieOptions Cookie(bool development, DateTimeOffset? expiry = null) => new() {
        HttpOnly = true, Secure = !development, SameSite = SameSiteMode.Strict,
        Path = development ? "/api/auth" : "/", MaxAge = expiry is { } at ? at - DateTimeOffset.UtcNow : TimeSpan.FromDays(7), IsEssential = true
    };
    public static bool IsAdmin(HttpContext http) => http.Request.Headers["X-Sayman-Client"] == "admin";
    public static string? ReadCookie(HttpContext http, bool development)
    {
        var name = CookieName(IsAdmin(http), development);
        var values = http.Request.Headers.Cookie.ToString().Split(';', StringSplitOptions.TrimEntries)
            .Where(part => part.StartsWith(name + "=", StringComparison.Ordinal)).Select(part => part[(name.Length + 1)..]).ToArray();
        return values.Length == 1 && values[0].Length == 64 && values[0].All(char.IsAsciiHexDigit) ? values[0] : null;
    }
    public static void Clear(HttpContext http, bool development)
    {
        http.Response.Cookies.Delete(CookieName(IsAdmin(http), development), Cookie(development));
        ClearLegacy(http, development);
    }
    public static void ClearLegacy(HttpContext http, bool development)
    {
        if (development) return;
        http.Response.Cookies.Delete(CookieName(IsAdmin(http), true), new() { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict, Path = "/api/auth" });
    }
    public static void CheckBrowserOrigin(HttpContext http, string[] allowed)
    {
        if (http.Request.Headers["Sec-Fetch-Site"] == "cross-site" || !allowed.Contains(http.Request.Headers.Origin.ToString(), StringComparer.Ordinal))
            throw new BusinessException("invalid_origin", "This browser origin is not allowed.");
    }
    public static void ValidateProductionOrigins(string[] origins, string[] adminOrigins)
    {
        static bool Valid(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https"
            && !value.Contains('*') && uri.Host.Length > 0 && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0 && value == uri.GetLeftPart(UriPartial.Authority);
        if (origins.Length == 0 || adminOrigins.Length == 0 || origins.Concat(adminOrigins).Any(value => !Valid(value))
            || adminOrigins.Any(value => !origins.Contains(value, StringComparer.Ordinal)))
            throw new InvalidOperationException("Production requires explicit HTTPS storefront and admin origins without wildcards or credentials.");
    }
}

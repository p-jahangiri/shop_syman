using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

// Typed public links only. An administrator cannot insert executable badge HTML/JS.
public static class StoreIdentityRules
{
    public static void Validate(JsonObject site)
    {
        if (!site.ContainsKey("storeIdentity")) return;
        if (site["storeIdentity"] is not JsonObject identity) Invalid();
        else
        {
            Keys(identity, "demonstration", "socialLinks", "badges", "policyLinks");
            if (identity.ContainsKey("demonstration") && (identity["demonstration"] is not JsonValue flag || !flag.TryGetValue<bool>(out _))) Invalid();
            var social = Rows(identity, "socialLinks", 5);
            var platforms = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in social)
            {
                Keys(row, "platform", "url", "enabled");
                var platform = Text(row, "platform", 20);
                var url = Text(row, "url", 1500);
                var enabled = Enabled(row);
                if (platform is not ("instagram" or "telegram" or "whatsapp" or "aparat" or "linkedin") || !platforms.Add(platform)) Invalid();
                if ((enabled || url.Length > 0) && !SocialUrl(platform, url)) Invalid();
            }
            var badgeIds = new HashSet<string>(StringComparer.Ordinal);
            var enamad = false;
            foreach (var row in Rows(identity, "badges", 6))
            {
                Keys(row, "id", "kind", "title", "verificationUrl", "imageUrl", "enabled");
                Id(row, badgeIds);
                var kind = Text(row, "kind", 10);
                var title = Title(row);
                var url = Text(row, "verificationUrl", 1500);
                var enabled = Enabled(row);
                if (kind is not ("enamad" or "license") || kind == "enamad" && enamad) Invalid();
                enamad |= kind == "enamad";
                if (enabled && (string.IsNullOrWhiteSpace(title) || url.Length == 0)) Invalid();
                if (url.Length > 0 && (kind == "enamad" ? !EnamadUrl(url) : PublicHttps(url) is null)) Invalid();
                if (row.ContainsKey("imageUrl"))
                {
                    var image = Text(row, "imageUrl", 1500);
                    if (image.Length == 0 || (kind == "enamad" ? !EnamadUrl(image) : !Regex.IsMatch(image, @"^/media/catalog/[a-f0-9]{32}/(thumb|card|zoom)\.webp$"))) Invalid();
                }
            }
            var policyIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in Rows(identity, "policyLinks", 6))
            {
                Keys(row, "id", "title", "href", "enabled");
                Id(row, policyIds);
                var title = Title(row);
                var href = Text(row, "href", 500);
                if (Enabled(row) && (string.IsNullOrWhiteSpace(title) || href.Length == 0)) Invalid();
                if (href.Length > 0 && !Regex.IsMatch(href, @"^/(support|pages/[a-z0-9]+(-[a-z0-9]+)*)$")) Invalid();
            }
        }
    }

    public static bool IsDemonstration(JsonObject site) => site["storeIdentity"] is JsonObject identity && identity["demonstration"] is JsonValue flag && flag.TryGetValue<bool>(out var value) && value;
    public static void RequireEnvironment(JsonObject site, bool development)
    {
        if (!development && IsDemonstration(site)) throw new BusinessException("development_identity_only", "Store identity examples are available only in Development; configure real links before publishing in production.");
    }
    public static void ProjectPublic(JsonObject site, bool development)
    {
        if (!development && IsDemonstration(site)) site.Remove("storeIdentity");
    }

    private static bool SocialUrl(string platform, string value)
    {
        var url = PublicHttps(value);
        if (url is null || url.Query.Length > 0) return false;
        var correctHost = platform switch
        {
            "instagram" => url.Host is "instagram.com" or "www.instagram.com",
            "telegram" => url.Host == "t.me",
            "whatsapp" => url.Host == "wa.me",
            "aparat" => url.Host is "aparat.com" or "www.aparat.com",
            "linkedin" => url.Host is "linkedin.com" or "www.linkedin.com",
            _ => false
        };
        if (!correctHost) return false;
        if (platform == "whatsapp") return Regex.IsMatch(url.AbsolutePath, @"^/[1-9][0-9]{7,14}/?$");
        if (platform == "linkedin") return Regex.IsMatch(url.AbsolutePath, @"^/(company|in)/[a-zA-Z0-9_-]{1,100}/?$");
        if (!Regex.IsMatch(url.AbsolutePath, @"^/[a-zA-Z0-9_.]{1,100}/?$")) return false;
        return url.AbsolutePath.Split('/')[1].ToLowerInvariant() is not ("accounts" or "login" or "explore" or "reels" or "p" or "share" or "addstickers" or "addlist" or "proxy" or "socks" or "iv" or "joinchat");
    }

    private static bool EnamadUrl(string value) => PublicHttps(value)?.Host == "trustseal.enamad.ir";
    private static Uri? PublicHttps(string value)
    {
        if (value.Length > 1500 || !Regex.IsMatch(value, @"^https://[a-z0-9.-]+(/|$)") || value.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c is '\\' or '<' or '>' || c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069')) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.UserInfo.Length > 0 || !uri.IsDefaultPort || uri.Fragment.Length > 0 || !uri.Host.Contains('.') || uri.HostNameType != UriHostNameType.Dns || Regex.IsMatch(uri.Host, @"\.(localhost|local|internal)$")) return null;
        return uri;
    }

    private static JsonObject[] Rows(JsonObject parent, string key, int max)
    {
        if (!parent.ContainsKey(key)) return [];
        if (parent[key] is not JsonArray array || array.Count > max || array.Any(n => n is not JsonObject)) { Invalid(); return []; }
        return array.OfType<JsonObject>().ToArray();
    }
    private static void Keys(JsonObject value, params string[] keys) { if (value.Any(p => !keys.Contains(p.Key))) Invalid(); }
    private static string Text(JsonObject row, string key, int max)
    {
        if (row[key] is JsonValue node && node.TryGetValue<string>(out var text) && text.Length <= max) return text;
        Invalid(); return "";
    }
    private static string Title(JsonObject row)
    {
        var value = Text(row, "title", 100);
        if (value.Any(c => char.IsControl(c) || c is '<' or '>' || c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069')) Invalid();
        return value;
    }
    private static bool Enabled(JsonObject row)
    {
        if (row["enabled"] is JsonValue node && node.TryGetValue<bool>(out var enabled)) return enabled;
        Invalid(); return false;
    }
    private static void Id(JsonObject row, HashSet<string> seen)
    {
        var id = Text(row, "id", 64);
        if (!Regex.IsMatch(id, "^[a-z0-9-]{1,64}$") || !seen.Add(id)) Invalid();
    }
    private static void Invalid() => throw new BusinessException("invalid_store_identity", "Use supported social profiles, real HTTPS verification links and safe internal policy pages; badge scripts are not accepted.");
}

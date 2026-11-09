using System.Text.Json.Nodes;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

// Mirrors the versioned siteDesignSchema in web-shared. The parity fixture
// exercises accepted and rejected payloads through both trust boundaries.
internal static class SiteDesignRules
{
    internal static void Validate(string locale, JsonObject site)
    {
        if (!site.TryGetPropertyValue("design", out var node)) return;
        if (locale != "fa" || node is not JsonObject design
            || design["schemaVersion"] is not JsonValue version
            || !version.TryGetValue<int>(out var number) || number != 1
            || !Is(design["template"], "signature", "minimal", "technology", "warm", "editorial", "marketplace", "luxury"))
            throw Invalid();

        foreach (var (key, value) in design)
        {
            switch (key)
            {
                case "schemaVersion" or "template":
                    break;
                case "theme" when Is(value, "system", "light", "dark"):
                    break;
                case "overrides" when value is JsonObject overrides:
                    foreach (var (group, fields) in overrides)
                    {
                        if (group is not ("layout" or "motion" or "typography") || fields is not JsonObject options)
                            throw Invalid();
                        foreach (var (field, option) in options)
                            if (!Supported(group, field, option)) throw Invalid();
                    }
                    break;
                default:
                    throw Invalid();
            }
        }
    }

    private static bool Supported(string group, string field, JsonNode? value) => (group, field) switch
    {
        ("layout", "surface") => Is(value, "glass", "solid"),
        ("layout", "density") => Is(value, "comfortable", "compact"),
        ("layout", "corners") => Is(value, "soft", "rounded"),
        ("layout", "cards") => Is(value, "classic", "outline", "editorial"),
        ("layout", "navigation") => Is(value, "links", "pills"),
        ("layout", "heroLayout") => Is(value, "split", "compact"),
        ("motion", "motion") => Is(value, "subtle", "full", "none"),
        ("motion", "motionPreset") => Is(value, "lift", "glow", "ripple"),
        ("typography", "font") => Is(value, "vazirmatn", "noto-arabic", "system"),
        ("layout", "stickyHeader") or ("motion", "motionBanners" or "motionCards" or "motionSidebar")
            => value is JsonValue flag && flag.TryGetValue<bool>(out _),
        _ => false
    };

    private static bool Is(JsonNode? node, params string[] values) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) && values.Contains(text, StringComparer.Ordinal);

    private static BusinessException Invalid() => new(
        "invalid_site_design", "Use a supported storefront design version and valid shared design options.");
}

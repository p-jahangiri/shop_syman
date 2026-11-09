using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

internal static class SitePaletteRules
{
    public static void Validate(JsonNode? node)
    {
        if (node is null) return;
        if (node is not JsonObject palette)
            throw Invalid("Palette must be an object.");

        foreach (var (key, value) in palette)
        {
            switch (key)
            {
                case "primaryLight" or "primaryDark" or "heroLight" or "heroDark":
                    RequireColor(value);
                    break;
                case "intensity":
                    if (value is not JsonValue strength || !strength.TryGetValue<string>(out var intensity)
                        || intensity is not ("soft" or "balanced" or "strong"))
                        throw Invalid("Select a supported palette intensity.");
                    break;
                case "sections":
                    ValidateSections(value);
                    break;
                default:
                    throw Invalid("Unsupported palette field.");
            }
        }
    }

    public static void ValidateLibrary(JsonNode? node, JsonNode? activePalette)
    {
        if (node is null) return;
        if (node is not JsonObject { Count: 2 } library
            || library["selected"] is not JsonValue selection || !selection.TryGetValue<string>(out var selected)
            || (selected != "default" && !EditablePalette(selected))
            || (selected == "default" ? activePalette is not null : activePalette is not JsonObject)
            || library["alternatives"] is not JsonObject alternatives)
            throw Invalid("Select a valid palette and save its other variants separately.");

        foreach (var (name, colors) in alternatives)
        {
            if (!EditablePalette(name) || name == selected || colors is not JsonObject)
                throw Invalid("Each palette must have its own distinct saved colors.");
            Validate(colors);
        }
    }

    private static bool EditablePalette(string? name) =>
        name is "spring" or "summer" or "autumn" or "winter" or "sayman" or "linen" or "midnight" or "iris" or "coastline" or "copper" or "custom";

    private static void ValidateSections(JsonNode? node)
    {
        if (node is not JsonObject sections)
            throw Invalid("Palette sections must be an object.");
        foreach (var (region, colors) in sections)
        {
            if (region is not ("canvas" or "navigation" or "cards" or "promotions" or "footer")
                || colors is not JsonObject themed)
                throw Invalid("Unsupported palette section.");
            foreach (var (theme, color) in themed)
            {
                if (theme is not ("light" or "dark"))
                    throw Invalid("Use light or dark for the section theme.");
                RequireColor(color);
            }
        }
    }

    private static void RequireColor(JsonNode? value)
    {
        if (value is not JsonValue node || !node.TryGetValue<string>(out var color)
            || !Regex.IsMatch(color, @"\A#[0-9a-fA-F]{6}\z"))
            throw Invalid("Use a six-digit hex color for the palette.");
    }

    private static BusinessException Invalid(string message) => new("invalid_branding", message);
}

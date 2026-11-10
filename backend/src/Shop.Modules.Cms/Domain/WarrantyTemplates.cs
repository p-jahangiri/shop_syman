using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WarrantyTemplate(
    string Id, string NameFa, string NameEn, string DetailsFa, string DetailsEn,
    string[] CategoryIds, string[] DefaultCategoryIds);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WarrantyTemplateLibrary(
    [property: JsonRequired, JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Version,
    WarrantyTemplate[] Items);

internal static partial class WarrantyTemplateRules
{
    internal const string Key = "catalog-warranties";

    internal static void Validate(WarrantyTemplate[]? items)
    {
        if (items is null || items.Length > 32) throw Invalid();

        var ids = new HashSet<string>(StringComparer.Ordinal);
        var defaults = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            if (item is null || !Guid.TryParseExact(item.Id, "N", out var id) || id == Guid.Empty
                || item.Id != id.ToString("N")
                || !ids.Add(id.ToString("N"))
                || !ValidName(item.NameFa, true) || !ValidName(item.NameEn)
                || !ValidText(item.DetailsFa, 1600) || !ValidText(item.DetailsEn, 1600)
                || item.CategoryIds is not { Length: >= 1 and <= 32 }
                || item.DefaultCategoryIds is not { Length: <= 32 })
                throw Invalid();

            var categories = new HashSet<string>(StringComparer.Ordinal);
            foreach (var category in item.CategoryIds)
            {
                if (category is null || !CategoryIdPattern().IsMatch(category) || !categories.Add(category))
                    throw Invalid();
            }
            foreach (var category in item.DefaultCategoryIds)
            {
                if (category is null || !categories.Contains(category) || !defaults.Add(category))
                    throw Invalid();
            }
        }
    }

    private static bool ValidText(string? text, int max, bool required = false) =>
        text is not null && (!required || text.Length > 0) && text.Length <= max
        && string.Equals(text.Trim(), text, StringComparison.Ordinal)
        && !text.Any(c => char.IsControl(c) && c != '\n');

    private static bool ValidName(string? text, bool required = false) =>
        ValidText(text, 120, required) && !text!.Contains('\n');

    private static BusinessException Invalid() =>
        new("invalid_warranty_templates", "Provide bounded warranty text, distinct categories, and at most one default warranty per category.");

    [GeneratedRegex(@"\A[A-Za-z0-9_-]{1,64}\z")]
    private static partial Regex CategoryIdPattern();
}

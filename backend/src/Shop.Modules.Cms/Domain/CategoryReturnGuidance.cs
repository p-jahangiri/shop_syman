using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

public static partial class CategoryReturnGuidance
{
    public const string DocumentKey = "category-returns";

    internal static void Validate(JsonObject document)
    {
        if (document.Count != 1 || document["items"] is not JsonArray { Count: <= 32 } rows)
            throw Invalid();

        var categories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            if (row is not JsonObject { Count: 2 } item
                || item["categoryId"] is not JsonValue idNode
                || !idNode.TryGetValue<string>(out var id)
                || !CategoryIdPattern().IsMatch(id)
                || !categories.Add(id)
                || item["text"] is not JsonValue textNode
                || !textNode.TryGetValue<string>(out var text)
                || text.Length is < 1 or > 1000
                || !string.Equals(text, text.Trim(), StringComparison.Ordinal)
                || text.Any(c => char.IsControl(c) && c != '\n'))
                throw Invalid();
        }
    }

    private static BusinessException Invalid() =>
        new("invalid_category_return_guidance", "Use one return note of up to 1000 characters per category, with at most 32 categories.");

    [GeneratedRegex(@"\A[A-Za-z0-9_-]{1,64}\z")]
    private static partial Regex CategoryIdPattern();
}

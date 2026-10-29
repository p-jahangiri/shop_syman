using System.Text.Json.Nodes;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

// Optional editorial metadata refers to today's purchase-method configuration.
// It neither enables a method nor changes any historical order or calculation.
public static class SitePurchaseRules
{
    public static bool IsSupportedKind(string? kind) => kind is "online" or "cheque" or "installment";

    public static void Validate(JsonObject site)
    {
        if (site["hero"] is JsonObject hero) ValidateDependency(hero);
        if (site["nav"] is JsonArray nav) Menu(nav, 0);
        if (site["homeBlocks"] is not JsonArray blocks) return;
        foreach (var block in blocks.OfType<JsonObject>())
        {
            ValidateDependency(block);
            if (block["items"] is JsonArray items)
                foreach (var promotion in items.OfType<JsonObject>()) ValidateDependency(promotion);
        }
    }

    public static void ValidateDependency(JsonObject value)
    {
        if (!value.TryGetPropertyValue("purchaseMethodKind", out var node)) return;
        if (node is not JsonValue text || !text.TryGetValue<string>(out var kind) || !IsSupportedKind(kind))
            throw new BusinessException("invalid_purchase_dependency", "Select online, cheque or installment for this optional content dependency.");
    }

    private static void Menu(JsonArray items, int depth)
    {
        // ContentService validates structure/depth before reaching these rules.
        if (depth > 3) throw new BusinessException("invalid_menu", "Menu depth is limited to four levels.");
        foreach (var item in items.OfType<JsonObject>())
        {
            ValidateDependency(item);
            if (item["children"] is JsonArray children) Menu(children, depth + 1);
        }
    }
}

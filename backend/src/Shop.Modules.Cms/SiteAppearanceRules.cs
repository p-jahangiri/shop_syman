using System.Text.Json.Nodes;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

public static class SiteAppearanceRules
{
    public static void Validate(JsonObject site)
    {
        if (!site.TryGetPropertyValue("appearance", out var node)) return;
        if (node is not JsonObject appearance) Invalid();
        else
        {
            foreach (var pair in appearance)
            {
                if (pair.Key == "stickyHeader")
                {
                    if (pair.Value is not JsonValue flag || !flag.TryGetValue<bool>(out _)) Invalid();
                    continue;
                }

                if (pair.Value is not JsonValue value || !value.TryGetValue<string>(out var text))
                {
                    Invalid();
                    continue;
                }

                var supported = pair.Key switch
                {
                    "surface" => text is "glass" or "solid",
                    "density" => text is "comfortable" or "compact",
                    "corners" => text is "soft" or "rounded",
                    "motion" => text is "subtle" or "none",
                    "heroLayout" => text is "split" or "compact",
                    _ => false
                };
                if (!supported) Invalid();
            }
        }
    }

    private static void Invalid() => throw new BusinessException(
        "invalid_appearance", "Select supported storefront appearance options; custom styles and scripts are not allowed.");
}

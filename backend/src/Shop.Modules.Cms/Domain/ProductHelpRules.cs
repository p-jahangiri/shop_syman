using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Cms;

public sealed record ProductHelpQuestion(string Question, string Answer);
public sealed record ProductHelpContent(bool AccessoriesEnabled, string[] AccessoryIds, ProductHelpQuestion[] Questions, bool IsDemo);

public static partial class ProductHelpRules
{
    public const string Prefix = "product-help-";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true
    };

    [GeneratedRegex(@"\A[A-Za-z0-9_-]{1,64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex ProductIdPattern();

    public static bool IsKey(string key) => key.StartsWith(Prefix, StringComparison.Ordinal);

    public static string Key(string id) => ProductIdPattern().IsMatch(id) ? Prefix + id : throw Invalid();

    public static ProductHelpContent Read(string key, JsonObject value)
    {
        try
        {
            var source = key[Prefix.Length..];
            if (!ProductIdPattern().IsMatch(source) || value.ToJsonString().Length > 24_000) throw Invalid();
            var content = value.Deserialize<ProductHelpContent>(Json) ?? throw Invalid();
            if (content.AccessoryIds.Length > 8
                || content.AccessoryIds.Distinct(StringComparer.OrdinalIgnoreCase).Count() != content.AccessoryIds.Length
                || content.AccessoryIds.Any(id => id is null || !ProductIdPattern().IsMatch(id)
                    || id.Equals(source, StringComparison.OrdinalIgnoreCase))
                || content.Questions.Length > 10
                || content.Questions.Any(item => item is null || !ValidText(item.Question, 240) || !ValidText(item.Answer, 1200)))
                throw Invalid();
            return content;
        }
        catch (JsonException) { throw Invalid(); }
    }

    public static void RequireEnvironment(JsonObject value, bool development)
    {
        if (!development && value["isDemo"]!.GetValue<bool>()) throw Invalid();
    }

    internal static bool ValidText(string? value, int max) => value is not null && value.Length <= max && value.Length > 0
        && value == value.Trim() && !value.Any(c => (char.IsControl(c) && c is not ('\n' or '\t')) || c is >= '\u202a' and <= '\u202e' or >= '\u2066' and <= '\u2069');

    private static BusinessException Invalid() => new("invalid_product_help", "Review the accessory selection and product answers.");
}

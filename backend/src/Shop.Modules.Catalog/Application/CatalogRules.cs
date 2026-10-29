using System.Globalization;
using System.Text.RegularExpressions;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;

public static partial class CatalogRules
{
    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.CultureInvariant)] private static partial Regex SlugPattern();
    public static void Slug(string value) { if (value.Length is < 1 or > 150 || !SlugPattern().IsMatch(value)) throw new BusinessException("invalid_slug", "Slug must contain lowercase letters, numbers and hyphens."); }
    public static long Money(string value)
    {
        if (value.Length is < 1 or > 19 || value.Any(c => c is < '0' or > '9') || !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var money)) throw new BusinessException("invalid_money", "Money must be a nonnegative integer rial string within Int64 range.");
        return money;
    }
    public static void Translations(TranslationInput[] translations)
    {
        if (translations.Length != 2 || !translations.Select(t => t.Locale).Order().SequenceEqual(new[] { "en", "fa" }) || translations.Any(t => string.IsNullOrWhiteSpace(t.Name) || t.Name.Length > 250 || t.Description.Length > 8000)) throw new BusinessException("invalid_translations", "Provide a name and valid content for both fa and en.");
    }
    public static void AttributeValue(AttributeDefinition definition, AttributeValueInput value)
    {
        var text = !string.IsNullOrWhiteSpace(value.TextFa) || !string.IsNullOrWhiteSpace(value.TextEn);
        var groups = (text ? 1 : 0) + (value.Number.HasValue ? 1 : 0) + (value.Bool.HasValue ? 1 : 0) + (value.OptionId is not null ? 1 : 0) + (value.OptionIds?.Length > 0 ? 1 : 0);
        var valid = groups == 1 && (definition.DataType switch {
            AttributeDataType.Text => !string.IsNullOrWhiteSpace(value.TextFa) && !string.IsNullOrWhiteSpace(value.TextEn) && value.TextFa.Length <= 2000 && value.TextEn.Length <= 2000,
            AttributeDataType.Number => value.Number.HasValue && decimal.Abs(value.Number.Value) < 100000000000000000000m && decimal.Round(value.Number.Value, 8) == value.Number.Value,
            AttributeDataType.Bool => value.Bool.HasValue,
            AttributeDataType.Select => value.OptionId is not null && definition.Options.Any(o => o.Id == value.OptionId),
            AttributeDataType.MultiSelect => value.OptionIds is { Length: > 0 } && value.OptionIds.Distinct().Count() == value.OptionIds.Length && value.OptionIds.All(id => definition.Options.Any(o => o.Id == id)),
            _ => false
        });
        if (!valid) throw new BusinessException("attribute_type_mismatch", $"The value for attribute '{definition.Key}' does not match its type or allowed options.");
    }
    public static void Version(byte[] actual, string? expected)
    {
        if (expected is null || !Convert.ToBase64String(actual).Equals(expected, StringComparison.Ordinal)) throw new BusinessException("version_conflict", "The record changed. Reload before saving.");
    }
}

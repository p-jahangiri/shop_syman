using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;

public sealed record AdminPriceHistoryVariant(string Id, string Sku, bool IsActive, string CurrentPriceRial);
public sealed record AdminPriceHistoryEntry(string Id, string VariantId, string OldPriceRial, string NewPriceRial, string ChangedBy, string ChangedAt);
public sealed record AdminPriceHistoryPage(int SchemaVersion, string ProductId, string AsOfAt, int PageSize,
    AdminPriceHistoryVariant[] Variants, AdminPriceHistoryEntry[] Items,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);

public interface IAdminPriceHistory
{
    Task<AdminPriceHistoryPage> ReadAsync(AdminPriceHistoryFilter filter, string? cursor, CancellationToken ct);
}

public sealed record AdminPriceHistoryFilter
{
    public string ProductId { get; private init; } = "";
    public string? VariantId { get; private init; }
    public string Direction { get; private init; } = "all";
    public DateTimeOffset? FromAt { get; private init; }
    public DateTimeOffset? ToAt { get; private init; }
    private AdminPriceHistoryFilter() { }

    public static AdminPriceHistoryFilter Create(string productId, string? variantId = null, string? direction = null, string? fromAt = null, string? toAt = null)
    {
        Identifier(productId);
        if (variantId is not null) Identifier(variantId);
        direction ??= "all";
        if (direction is not ("all" or "increase" or "decrease")) throw Invalid();
        var from = fromAt is null ? (DateTimeOffset?)null : ParseTime(fromAt);
        var to = toAt is null ? (DateTimeOffset?)null : ParseTime(toAt);
        if (from > to) throw Invalid();
        return new() { ProductId = productId.ToUpperInvariant(), VariantId = variantId?.ToUpperInvariant(), Direction = direction, FromAt = from, ToAt = to };
    }

    public string Binding => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { ProductId, VariantId, Direction, From = FromAt?.UtcTicks, To = ToAt?.UtcTicks }))));
    public static string Identifier(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 64 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('_' or '-'))) throw Invalid();
        return id;
    }
    // Accept only UTC ISO seconds with an optional 1..7 digit fraction. Offsets,
    // local times, normalized impossible dates and whitespace are not accepted.
    public static DateTimeOffset ParseTime(string value)
    {
        if (value.Length is < 20 or > 28 || !Regex.IsMatch(value, @"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?Z\z", RegexOptions.CultureInvariant)
            || !DateTimeOffset.TryParseExact(value, ["yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'"], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var at)) throw Invalid();
        return at;
    }
    public static string Time(DateTimeOffset at) => at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);
    private static BusinessException Invalid() => new("invalid_price_history_filter", "Use valid product/variant ids, a price direction and an increasing UTC ISO time range (Z, up to seven fractional digits).");
}

public sealed record AdminPriceHistoryPosition(DateTimeOffset AsOfAt, byte[] Watermark, DateTimeOffset BeforeAt, string BeforeId);

public static class AdminPriceHistoryPaging
{
    public const int PageSize = 50;
    public const int MaximumVariants = 500;
    public const int MaximumCursorLength = 1024;
    private sealed record Cursor(int Version, string Filter, string AsOfAt, string Watermark, string BeforeAt, string BeforeId);
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 4, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };

    public static string Encode(AdminPriceHistoryPosition position, AdminPriceHistoryFilter filter)
    {
        Validate(position);
        var payload = new Cursor(1, filter.Binding, AdminPriceHistoryFilter.Time(position.AsOfAt), Convert.ToBase64String(position.Watermark), AdminPriceHistoryFilter.Time(position.BeforeAt), position.BeforeId);
        return Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static AdminPriceHistoryPosition? Decode(string? cursor, AdminPriceHistoryFilter filter)
    {
        if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > MaximumCursorLength || cursor.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('_' or '-'))) throw Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/');
            var bytes = Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '='));
            if (Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') != cursor) throw Invalid();
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
            if (document.RootElement.ValueKind != JsonValueKind.Object || document.RootElement.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != document.RootElement.EnumerateObject().Count()) throw Invalid();
            var value = JsonSerializer.Deserialize<Cursor>(bytes, Options);
            if (value is null || value.Version != 1 || value.Filter != filter.Binding || value.AsOfAt is null || value.BeforeAt is null || value.Watermark is null) throw Invalid();
            var position = new AdminPriceHistoryPosition(AdminPriceHistoryFilter.ParseTime(value.AsOfAt), Convert.FromBase64String(value.Watermark), AdminPriceHistoryFilter.ParseTime(value.BeforeAt), value.BeforeId);
            Validate(position);
            if (value.AsOfAt != AdminPriceHistoryFilter.Time(position.AsOfAt) || value.BeforeAt != AdminPriceHistoryFilter.Time(position.BeforeAt) || Convert.ToBase64String(position.Watermark) != value.Watermark) throw Invalid();
            return position;
        }
        catch (Exception error) when (error is FormatException or JsonException or ArgumentException || error is BusinessException { Code: "invalid_price_history_filter" }) { throw Invalid(); }
    }

    private static void Validate(AdminPriceHistoryPosition position)
    {
        if (position.Watermark is not { Length: 8 } || position.BeforeAt > position.AsOfAt) throw Invalid();
        AdminPriceHistoryFilter.Identifier(position.BeforeId);
    }
    private static BusinessException Invalid() => new("invalid_price_history_cursor", "The price history cursor is invalid or belongs to another product or filter.");
}

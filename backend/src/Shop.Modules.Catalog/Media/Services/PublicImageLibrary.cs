using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Infrastructure;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Media;

public sealed record PublicImageLibraryItem(string Id, string Url, string CreatedAt, PublicImageVariantDto[] Variants);
public sealed record PublicImageLibraryPage(int SchemaVersion, string AsOfAt, int PageSize, PublicImageLibraryItem[] Items,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? NextCursor);
public interface IPublicImageLibrary
{
    Task<PublicImageLibraryPage> ReadAsync(PublicImageLibraryFilter filter, string? cursor, CancellationToken ct);
}

public sealed record PublicImageLibraryFilter
{
    public string? Query { get; private init; }
    public DateTimeOffset? FromAt { get; private init; }
    public DateTimeOffset? ToAt { get; private init; }
    private PublicImageLibraryFilter() { }
    public static PublicImageLibraryFilter Create(string? q = null, string? fromAt = null, string? toAt = null)
    {
        if (q is not null && (q.Length is < 4 or > 32 || q.Any(c => !char.IsAsciiHexDigit(c)))) throw Invalid();
        var from = fromAt is null ? (DateTimeOffset?)null : ParseTime(fromAt);
        var to = toAt is null ? (DateTimeOffset?)null : ParseTime(toAt);
        if (from > to) throw Invalid();
        return new() { Query = q?.ToLowerInvariant(), FromAt = from, ToAt = to };
    }
    public string Binding => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { Query, From = FromAt?.UtcTicks, To = ToAt?.UtcTicks }))));
    public static DateTimeOffset ParseTime(string value)
    {
        if (value.Length is < 20 or > 28 || !Regex.IsMatch(value, @"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?Z\z", RegexOptions.CultureInvariant)
            || !DateTimeOffset.TryParseExact(value, ["yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'"], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var at)) throw Invalid();
        return at;
    }
    public static string Time(DateTimeOffset at) => at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);
    private static BusinessException Invalid() => new("invalid_image_library_filter", "Use an image id prefix of 4 to 32 hexadecimal characters and UTC ISO time bounds (Z, up to seven fractional digits).");
}

public sealed record PublicImageLibraryPosition(DateTimeOffset AsOfAt, byte[] Watermark, DateTimeOffset BeforeAt, string BeforeId);
public static class PublicImageLibraryPaging
{
    public const int PageSize = 24;
    public const int MaximumCursorLength = 1024;
    private sealed record Cursor(int Version, string Filter, string AsOfAt, string Watermark, string BeforeAt, string BeforeId);
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 4, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string Encode(PublicImageLibraryPosition position, PublicImageLibraryFilter filter)
    {
        Validate(position);
        var value = new Cursor(1, filter.Binding, PublicImageLibraryFilter.Time(position.AsOfAt), Convert.ToBase64String(position.Watermark), PublicImageLibraryFilter.Time(position.BeforeAt), position.BeforeId);
        return Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(value)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
    public static PublicImageLibraryPosition? Decode(string? cursor, PublicImageLibraryFilter filter)
    {
        if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > MaximumCursorLength || cursor.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('_' or '-'))) throw Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/');
            var bytes = Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '='));
            if (Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') != cursor) throw Invalid();
            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
            if (json.RootElement.ValueKind != JsonValueKind.Object || json.RootElement.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != json.RootElement.EnumerateObject().Count()) throw Invalid();
            var value = JsonSerializer.Deserialize<Cursor>(bytes, Options);
            if (value is null || value.Version != 1 || value.Filter != filter.Binding || value.AsOfAt is null || value.BeforeAt is null || value.Watermark is null) throw Invalid();
            var position = new PublicImageLibraryPosition(PublicImageLibraryFilter.ParseTime(value.AsOfAt), Convert.FromBase64String(value.Watermark), PublicImageLibraryFilter.ParseTime(value.BeforeAt), value.BeforeId);
            Validate(position);
            if (value.AsOfAt != PublicImageLibraryFilter.Time(position.AsOfAt) || value.BeforeAt != PublicImageLibraryFilter.Time(position.BeforeAt) || Convert.ToBase64String(position.Watermark) != value.Watermark) throw Invalid();
            return position;
        }
        catch (Exception error) when (error is FormatException or JsonException or ArgumentException || error is BusinessException { Code: "invalid_image_library_filter" or "invalid_media_path" }) { throw Invalid(); }
    }
    private static void Validate(PublicImageLibraryPosition position)
    {
        if (position.Watermark is not { Length: 8 } || position.BeforeAt > position.AsOfAt) throw Invalid();
        PublicImagePaths.Validate(position.BeforeId, "card");
    }
    private static BusinessException Invalid() => new("invalid_image_library_cursor", "The image library cursor is invalid or belongs to different filters.");
}

public static class PublicImageLibraryQuery
{
    public const string OrdinalCollation = "Latin1_General_100_BIN2";
    public static IQueryable<PublicImageAsset> Read(CatalogDbContext db, PublicImageLibraryFilter filter, DateTimeOffset asOfAt, byte[] watermark, PublicImageLibraryPosition? before = null)
    {
        var rows = db.PublicImages.FromSqlInterpolated($"SELECT * FROM [catalog].[PublicImages] WHERE [Version] < {watermark}").AsNoTracking()
            .Where(a => a.Status == "Ready" && a.CreatedAt <= asOfAt);
        if (filter.Query is not null) rows = rows.Where(a => a.Id.StartsWith(filter.Query));
        if (filter.FromAt is not null) rows = rows.Where(a => a.CreatedAt >= filter.FromAt);
        if (filter.ToAt is not null) rows = rows.Where(a => a.CreatedAt < filter.ToAt);
        if (before is not null) rows = rows.Where(a => a.CreatedAt < before.BeforeAt || a.CreatedAt == before.BeforeAt && string.Compare(EF.Functions.Collate(a.Id, OrdinalCollation), before.BeforeId) < 0);
        return rows.OrderByDescending(a => a.CreatedAt).ThenByDescending(a => EF.Functions.Collate(a.Id, OrdinalCollation)).Take(PublicImageLibraryPaging.PageSize + 1).Include(a => a.Variants).AsSingleQuery();
    }
}

// Metadata reads remain available when upload/storage/scanning are unconfigured.
// The response does not attest that the underlying object has been fetched.
public sealed class PublicImageLibrary(CatalogDbContext db, TimeProvider clock) : IPublicImageLibrary
{
    public async Task<PublicImageLibraryPage> ReadAsync(PublicImageLibraryFilter filter, string? cursor, CancellationToken ct)
    {
        var before = PublicImageLibraryPaging.Decode(cursor, filter);
        var asOfAt = before?.AsOfAt ?? clock.GetUtcNow();
        // Exclusive minimum-active boundary excludes writes which were reserved
        // but uncommitted at capture, including a backdated Staged->Ready update.
        var watermark = before?.Watermark ?? await db.Database.SqlQuery<byte[]>($"SELECT MIN_ACTIVE_ROWVERSION() AS [Value]").SingleAsync(ct);
        var rows = await PublicImageLibraryQuery.Read(db, filter, asOfAt, watermark, before).ToArrayAsync(ct);
        var entries = rows.Select(Item).ToArray();
        var next = rows.Length > PublicImageLibraryPaging.PageSize
            ? PublicImageLibraryPaging.Encode(new(asOfAt, watermark, rows[PublicImageLibraryPaging.PageSize - 1].CreatedAt, rows[PublicImageLibraryPaging.PageSize - 1].Id), filter)
            : null;
        return new(1, PublicImageLibraryFilter.Time(asOfAt), PublicImageLibraryPaging.PageSize, entries.Take(PublicImageLibraryPaging.PageSize).ToArray(), next);
    }
    public static PublicImageLibraryItem Item(PublicImageAsset asset)
    {
        try {
            PublicImagePaths.Validate(asset.Id, "card");
            if (asset.Status != "Ready" || asset.Variants.Count != 3 || asset.Variants.Select(v => v.Name).Distinct(StringComparer.Ordinal).Count() != 3) throw Unavailable();
            foreach (var variant in asset.Variants) {
                PublicImagePaths.Validate(asset.Id, variant.Name);
                var edge = variant.Name switch { "thumb" => 320, "card" => 960, "zoom" => 1920, _ => 0 };
                if (variant.AssetId != asset.Id || variant.Width < 1 || variant.Height < 1 || variant.Width > edge || variant.Height > edge
                    || variant.Bytes is < 1 or > ImageLimits.MaxOutputBytes || variant.Sha256.Length != 64 || variant.Sha256.Any(c => c is not (>= '0' and <= '9') and not (>= 'a' and <= 'f'))) throw Unavailable();
            }
            var dto = PublicImageService.Dto(asset);
            return new(dto.Id, dto.Url, PublicImageLibraryFilter.Time(asset.CreatedAt), dto.Variants);
        }
        catch (BusinessException error) when (error.Code == "invalid_media_path") { throw Unavailable(); }
    }
    private static BusinessException Unavailable() => new("media_unavailable", "Ready image metadata could not be verified. No substitute images were returned.");
}

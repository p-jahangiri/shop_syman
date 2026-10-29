using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed record StockMovementData(string Id, string VariantId, int Delta, int Balance, string Reason, string ActorId, string RequestId, DateTimeOffset At);
public sealed record StockMovementPage(int Version, int PageSize, StockMovementData[] Items, [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? NextCursor);
public interface IStockMovementHistory
{
    Task<StockMovementPage> ReadAsync(StockMovementFilter filter, string? cursor, CancellationToken ct);
}
public sealed record StockMovementFilter
{
    public string? VariantId { get; private init; }
    public string Direction { get; private init; } = "all";
    public DateTimeOffset? FromAt { get; private init; }
    public DateTimeOffset? ToAt { get; private init; }
    private StockMovementFilter() { }
    public static StockMovementFilter Create(string? variantId = null, string? direction = null, DateTimeOffset? fromAt = null, DateTimeOffset? toAt = null)
    {
        variantId = string.IsNullOrWhiteSpace(variantId) ? null : variantId.Trim(); direction ??= "all";
        if (variantId is not null && (variantId.Length > 64 || variantId.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('_' or '-')))
            || direction is not ("all" or "in" or "out") || fromAt is not null && toAt is not null && fromAt >= toAt)
            throw new BusinessException("invalid_movement_filter", "Use a valid variant, direction and increasing time range.");
        return new() { VariantId = variantId?.ToUpperInvariant(), Direction = direction, FromAt = fromAt?.ToUniversalTime(), ToAt = toAt?.ToUniversalTime() };
    }
    // A binding prevents accidental cursor reuse after filters change; it is not an authorization token.
    public string Binding => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { VariantId, Direction, From = FromAt?.UtcTicks, To = ToAt?.UtcTicks }))));
}
public static class StockMovementPaging
{
    public const int PageSize = 50;
    private sealed record Cursor(string Before, string Filter);
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 4, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string Encode(long before, StockMovementFilter filter)
    {
        if (before < 1) throw Invalid();
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(before.ToString(CultureInfo.InvariantCulture), filter.Binding))))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
    public static long? Decode(string? cursor, StockMovementFilter filter)
    {
        if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > 256 || cursor.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('_' or '-'))) throw Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/');
            var value = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '=')), Options);
            if (value is null || value.Filter != filter.Binding || !long.TryParse(value.Before, NumberStyles.None, CultureInfo.InvariantCulture, out var before)
                || before < 1 || value.Before != before.ToString(CultureInfo.InvariantCulture)) throw Invalid();
            return before;
        }
        catch (Exception e) when (e is FormatException or JsonException or ArgumentException) { throw Invalid(); }
    }
    private static BusinessException Invalid() => new("invalid_movement_cursor", "The movement page cursor is invalid or belongs to different filters.");
    public static IQueryable<StockMovement> Query(InventoryDbContext db, StockMovementFilter filter, long? before)
    {
        var rows = db.Movements.AsNoTracking();
        if (filter.VariantId is not null) rows = rows.Where(x => x.VariantId == filter.VariantId);
        if (filter.Direction == "in") rows = rows.Where(x => x.Delta > 0);
        if (filter.Direction == "out") rows = rows.Where(x => x.Delta < 0);
        if (filter.FromAt is not null) rows = rows.Where(x => x.At >= filter.FromAt);
        if (filter.ToAt is not null) rows = rows.Where(x => x.At < filter.ToAt);
        if (before is not null) rows = rows.Where(x => x.Id < before);
        return rows.OrderByDescending(x => x.Id).Take(PageSize + 1);
    }
}
public sealed class StockMovementHistory(InventoryDbContext db) : IStockMovementHistory
{
    public async Task<StockMovementPage> ReadAsync(StockMovementFilter filter, string? cursor, CancellationToken ct)
    {
        var before = StockMovementPaging.Decode(cursor, filter);
        var rows = await StockMovementPaging.Query(db, filter, before).ToArrayAsync(ct);
        var items = rows.Take(StockMovementPaging.PageSize).Select(x => new StockMovementData(x.Id.ToString(CultureInfo.InvariantCulture), x.VariantId, x.Delta, x.Balance, x.Reason, x.ActorId, x.RequestId, x.At)).ToArray();
        return new(1, StockMovementPaging.PageSize, items, rows.Length > StockMovementPaging.PageSize ? StockMovementPaging.Encode(rows[StockMovementPaging.PageSize - 1].Id, filter) : null);
    }
}

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Application;
public sealed record StockVariantMetadata(string Id, string ProductId, string Sku, string NameFa, string NameEn, bool IsActive, string ProductStatus,bool IsDigital=false);
public sealed record StockVariantPage(StockVariantMetadata[] Items, string? NextCursor);
public sealed record AdminCatalogSummary(string Products, string Categories);
public sealed record AdminStockWorkspacePage(int Total, int Page, int PageSize, StockVariantMetadata[] Items);
public sealed record AdminStockWorkspaceQuery
{
    public required AdminStockQuery Stock { get; init; }
    public int? MinAvailable { get; private init; }
    public int? MaxAvailable { get; private init; }
    public required string Sort { get; init; }
    public bool Descending { get; private init; }
    public int Page { get; private init; }
    public int PageSize { get; private init; }

    public static AdminStockWorkspaceQuery Create(string? search, string? active, int? min, int? max,
        string? sort, string? direction, int? page, int? size)
    {
        sort ??= "name";
        direction ??= "asc";
        page ??= 0;
        size ??= 25;
        if (min < 0 || max < 0 || min > max || sort is not ("name" or "sku" or "available") ||
            direction is not ("asc" or "desc") || page is < 0 or > 1000000 || size is not (25 or 50))
            throw new BusinessException("invalid_stock_filter", "Invalid inventory workspace filter or page.");
        return new()
        {
            Stock = AdminStockQuery.Create(search, active), MinAvailable = min, MaxAvailable = max,
            Sort = sort, Descending = direction == "desc", Page = page.Value, PageSize = size.Value
        };
    }
}
public interface IAdminStockWorkspace
{
    Task<AdminStockWorkspacePage> ReadAsync(AdminStockWorkspaceQuery query, CancellationToken ct);
}
public interface IAdminStockCatalog
{
    Task<StockVariantPage> PageAsync(AdminStockQuery query, string? cursor, CancellationToken ct);
    Task<StockVariantMetadata?> FindAsync(string id, CancellationToken ct);
    Task<AdminCatalogSummary> SummaryAsync(CancellationToken ct);
}
public sealed record AdminStockQuery
{
    public string Search { get; private init; } = "";
    public string Active { get; private init; } = "all";
    private AdminStockQuery() { }
    public static AdminStockQuery Create(string? query = null, string? active = null)
    {
        active ??= "all";
        if (query is { Length: > 120 } || active is not ("all" or "true" or "false")) throw Invalid();
        var search = PersianText.Normalize(query ?? "");
        if (search.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length > 8) throw Invalid();
        return new() { Search = search, Active = active };
    }
    public static string Identifier(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 64 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw Invalid();
        return id;
    }
    public string Binding => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { Search, Active }))));
    private static BusinessException Invalid() => new("invalid_stock_filter", "Use up to eight search terms (120 characters) and active all, true or false.");
}
public static class AdminStockPaging
{
    public const int PageSize = 50;
    private sealed record Cursor(string After, string Filter);
    private static readonly JsonSerializerOptions Options = new() { MaxDepth = 4, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string Encode(string id, AdminStockQuery query) => Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Cursor(AdminStockQuery.Identifier(id), query.Binding)))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static string? Decode(string? cursor, AdminStockQuery query)
    {
        if (cursor is null) return null;
        try {
            if (cursor.Length is < 1 or > 300 || cursor.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw Invalid();
            var raw = cursor.Replace('-', '+').Replace('_', '/'); var value = JsonSerializer.Deserialize<Cursor>(Convert.FromBase64String(raw.PadRight((raw.Length + 3) / 4 * 4, '=')), Options);
            if (value is null || value.Filter != query.Binding) throw Invalid();
            return AdminStockQuery.Identifier(value.After);
        }
        catch (Exception e) when (e is FormatException or JsonException or ArgumentException || e is BusinessException { Code: "invalid_stock_filter" }) { throw Invalid(); }
    }
    private static BusinessException Invalid() => new("invalid_stock_cursor", "The stock page cursor is invalid or belongs to different filters.");
}

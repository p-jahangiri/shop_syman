using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;
public sealed record AdminStockRecord(string VariantId,int OnHand,int Reserved,string Version)
{
    [System.Text.Json.Serialization.JsonIgnore]public int SourcingReserved{get;init;}
}
public sealed record AdminStockSummary(string StockRecords, string AvailableVariants, string ReservedVariants);
public interface IAdminStockReader
{
    Task<AdminStockRecord[]> ReadAsync(string[] variantIds, CancellationToken ct);
    Task<AdminStockSummary> SummaryAsync(CancellationToken ct);
}
public sealed class AdminStockReader(InventoryDbContext db) : IAdminStockReader
{
    public static string[] Validate(string[] ids)
    {
        if (ids is null || ids.Length > 50 || ids.Any(id => string.IsNullOrEmpty(id) || id.Length > 64 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) || ids.Distinct(StringComparer.OrdinalIgnoreCase).Count() != ids.Length)
            throw new BusinessException("invalid_stock_filter", "Read up to 50 distinct variant ids.");
        return ids;
    }
    public static IQueryable<StockItem> Query(InventoryDbContext db, string[] ids) => db.Stock.AsNoTracking().Where(x => ids.Contains(x.VariantId));
    public async Task<AdminStockRecord[]> ReadAsync(string[] variantIds, CancellationToken ct)
    {
        Validate(variantIds); if (variantIds.Length == 0) return [];
        var rows = await Query(db, variantIds).ToArrayAsync(ct);
        return rows.Select(x => new AdminStockRecord(x.VariantId, x.OnHand, x.Reserved, Convert.ToBase64String(x.Version)){SourcingReserved=x.SourcingReserved}).ToArray();
    }
    public async Task<AdminStockSummary> SummaryAsync(CancellationToken ct) => new(
        (await db.Stock.LongCountAsync(ct)).ToString(CultureInfo.InvariantCulture),
        (await db.Stock.LongCountAsync(x => (long)x.OnHand-x.Reserved-x.SourcingReserved>0, ct)).ToString(CultureInfo.InvariantCulture),
        (await db.Stock.LongCountAsync(x => x.Reserved>0||x.SourcingReserved>0, ct)).ToString(CultureInfo.InvariantCulture));
}

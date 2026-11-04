using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public static class AdminPriceHistoryQuery
{
    public const string OrdinalCollation = "Latin1_General_100_BIN2";
    public static IQueryable<PriceHistory> Read(CatalogDbContext db, AdminPriceHistoryFilter filter, DateTimeOffset asOfAt, byte[] watermark, AdminPriceHistoryPosition? before = null)
    {
        // The existing rowversion freezes membership even when a subsequent
        // append has the same (or an earlier) timestamp. All values are parameters.
        var rows = db.PriceHistory.FromSqlInterpolated($"SELECT * FROM [catalog].[PriceHistory] WHERE [Version] < {watermark}").AsNoTracking()
            .Where(h => h.CreatedAt <= asOfAt && db.Variants.Any(v => v.Id == h.VariantId && v.ProductId == filter.ProductId));
        if (filter.VariantId is not null) rows = rows.Where(h => h.VariantId == filter.VariantId);
        if (filter.Direction == "increase") rows = rows.Where(h => h.NewPrice > h.OldPrice);
        if (filter.Direction == "decrease") rows = rows.Where(h => h.NewPrice < h.OldPrice);
        if (filter.FromAt is not null) rows = rows.Where(h => h.CreatedAt >= filter.FromAt);
        if (filter.ToAt is not null) rows = rows.Where(h => h.CreatedAt < filter.ToAt);
        if (before is not null) rows = rows.Where(h => h.CreatedAt < before.BeforeAt || h.CreatedAt == before.BeforeAt && string.Compare(EF.Functions.Collate(h.Id, OrdinalCollation), before.BeforeId) < 0);
        return rows.OrderByDescending(h => h.CreatedAt).ThenByDescending(h => EF.Functions.Collate(h.Id, OrdinalCollation)).Take(AdminPriceHistoryPaging.PageSize + 1);
    }
}

public sealed class AdminPriceHistory(CatalogDbContext db, TimeProvider clock) : IAdminPriceHistory
{
    private sealed record Variant(string Id, string Sku, bool IsActive, long PriceRial, byte[] Version);

    public Task<AdminPriceHistoryPage> ReadAsync(AdminPriceHistoryFilter filter, string? cursor, CancellationToken ct)
    {
        var before = AdminPriceHistoryPaging.Decode(cursor, filter);
        return CatalogReadRetry.RunAsync(token => ReadAttemptAsync(filter, before, token), ct);
    }

    private async Task<AdminPriceHistoryPage> ReadAttemptAsync(AdminPriceHistoryFilter filter, AdminPriceHistoryPosition? before, CancellationToken ct)
    {
        var asOfAt = before?.AsOfAt ?? clock.GetUtcNow();
        var product = await db.Products.AsNoTracking().Where(p => p.Id == filter.ProductId).Select(p => new CatalogReadVersion(p.Id, p.Version)).SingleOrDefaultAsync(ct)
            ?? throw new BusinessException("not_found", "Product was not found.");
        var variants = await db.Variants.AsNoTracking().Where(v => v.ProductId == product.Id).OrderBy(v => v.Id).Take(AdminPriceHistoryPaging.MaximumVariants + 1)
            .Select(v => new Variant(v.Id, v.Sku, v.IsActive, v.PriceRial, v.Version)).ToArrayAsync(ct);
        if (variants.Length > AdminPriceHistoryPaging.MaximumVariants || variants.Any(v => v.PriceRial < 0 || v.Sku.Length > 80)) throw Unavailable();
        if (filter.VariantId is not null && !variants.Any(v => string.Equals(v.Id, filter.VariantId, StringComparison.OrdinalIgnoreCase))) throw new BusinessException("not_found", "Variant does not belong to this product.");
        // A maximum rowversion can already belong to an uncommitted write.
        // MIN_ACTIVE_ROWVERSION is the exclusive boundary below which versions
        // were committed when captured. An unrelated long transaction can defer
        // newer observations until refresh; this is not a full SQL snapshot.
        var watermark = before?.Watermark ?? await db.Database.SqlQuery<byte[]>($"SELECT MIN_ACTIVE_ROWVERSION() AS [Value]").SingleAsync(ct);
        var rows = await AdminPriceHistoryQuery.Read(db, filter, asOfAt, watermark, before).ToArrayAsync(ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<Product>(db, [product], ct);
        await CatalogReadVersions.EnsureSnapshotsAsync<ProductVariant>(db, variants.Select(v => new CatalogReadVersion(v.Id, v.Version)).ToArray(), ct);
        if (rows.Any(h => h.OldPrice < 0 || h.NewPrice < 0 || h.OldPrice == h.NewPrice || h.ChangedBy.Length > 2000)) throw Unavailable();
        var items = rows.Take(AdminPriceHistoryPaging.PageSize).Select(h => new AdminPriceHistoryEntry(h.Id, h.VariantId, Money(h.OldPrice), Money(h.NewPrice), h.ChangedBy, AdminPriceHistoryFilter.Time(h.CreatedAt))).ToArray();
        var next = rows.Length > AdminPriceHistoryPaging.PageSize
            ? AdminPriceHistoryPaging.Encode(new(asOfAt, watermark, rows[AdminPriceHistoryPaging.PageSize - 1].CreatedAt, rows[AdminPriceHistoryPaging.PageSize - 1].Id), filter)
            : null;
        return new(1, product.Id, AdminPriceHistoryFilter.Time(asOfAt), AdminPriceHistoryPaging.PageSize, variants.Select(v => new AdminPriceHistoryVariant(v.Id, v.Sku, v.IsActive, Money(v.PriceRial))).ToArray(), items, next);
    }

    private static string Money(long amount) => amount.ToString(CultureInfo.InvariantCulture);
    private static BusinessException Unavailable() => new("catalog_unavailable", "Stored price history is unavailable. No substitute prices were generated.");
}

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;

namespace Shop.Modules.Catalog.Infrastructure;
public static class AdminStockCatalogQuery
{
    internal sealed class Candidate
    {
        public required ProductVariant V { get; init; }
        public required Product P { get; init; }
    }
    internal static IQueryable<Candidate> Candidates(CatalogDbContext db, AdminStockQuery query)
    {
        var rows = from v in db.Variants.AsNoTracking() join p in db.Products.AsNoTracking() on v.ProductId equals p.Id select new Candidate { V = v, P = p };
        if (query.Active != "all") { var active = query.Active == "true"; rows = rows.Where(x => x.V.IsActive == active); }
        foreach (var token in query.Search.Split(' ', StringSplitOptions.RemoveEmptyEntries)) rows = rows.Where(x => x.V.SearchSku.Contains(token) || x.P.Translations.Any(t => t.SearchName.Contains(token)));
        return rows;
    }
    public static IQueryable<StockVariantMetadata> Match(CatalogDbContext db, AdminStockQuery query, string? after = null, string? onlyId = null)
    {
        var rows = Candidates(db, query);
        if (after is not null) rows = rows.Where(x => string.Compare(x.V.Id, after) > 0);
        if (onlyId is not null) rows = rows.Where(x => x.V.Id == onlyId);
        return rows.OrderBy(x => x.V.Id).Select(x => new StockVariantMetadata(x.V.Id, x.P.Id, x.V.Sku,
            x.P.Translations.Where(t => t.Locale == "fa").Select(t => t.Name).FirstOrDefault() ?? "",
            x.P.Translations.Where(t => t.Locale == "en").Select(t => t.Name).FirstOrDefault() ?? "", x.V.IsActive, x.P.Status,x.P.IsDigital));
    }
}
public sealed class AdminStockCatalog(CatalogDbContext db) : IAdminStockCatalog, IAdminStockWorkspace
{
    public async Task<StockVariantPage> PageAsync(AdminStockQuery query, string? cursor, CancellationToken ct)
    {
        var after = AdminStockPaging.Decode(cursor, query);
        if (query.Search.Length > 0 && (await db.Variants.AnyAsync(v => v.SearchSku == "", ct) || await db.Set<Shop.Modules.Catalog.Domain.ProductTranslation>().AnyAsync(t => t.SearchName == "", ct)))
            throw new Shop.SharedKernel.BusinessException("catalog_reindex_required", "Catalog search maintenance is incomplete. Try again after the service is ready.");
        var rows = await AdminStockCatalogQuery.Match(db, query, after).Take(AdminStockPaging.PageSize + 1).ToArrayAsync(ct);
        return new(rows.Take(AdminStockPaging.PageSize).ToArray(), rows.Length > AdminStockPaging.PageSize ? AdminStockPaging.Encode(rows[AdminStockPaging.PageSize - 1].Id, query) : null);
    }
    public async Task<StockVariantMetadata?> FindAsync(string id, CancellationToken ct)
    {
        AdminStockQuery.Identifier(id);
        return await AdminStockCatalogQuery.Match(db, AdminStockQuery.Create(), onlyId: id).SingleOrDefaultAsync(ct);
    }
    public async Task<AdminCatalogSummary> SummaryAsync(CancellationToken ct) => new((await db.Products.LongCountAsync(ct)).ToString(CultureInfo.InvariantCulture), (await db.Categories.LongCountAsync(ct)).ToString(CultureInfo.InvariantCulture));

    public async Task<AdminStockWorkspacePage> ReadAsync(AdminStockWorkspaceQuery query, CancellationToken ct)
    {
        if (query.Stock.Search.Length > 0 && (await db.Variants.AnyAsync(v => v.SearchSku == "", ct) ||
            await db.Set<Shop.Modules.Catalog.Domain.ProductTranslation>().AnyAsync(t => t.SearchName == "", ct)))
            throw new Shop.SharedKernel.BusinessException("catalog_reindex_required", "Catalog search maintenance is incomplete.");
        var matching = AdminStockCatalogQuery.Candidates(db, query.Stock).Where(r => !r.P.IsDigital);
        var rows = from item in matching
                   join balance in db.AvailableStock on item.V.Id equals balance.VariantId into balances
                   from balance in balances.DefaultIfEmpty()
                   select new
                   {
                       Id = item.V.Id, item.V.Sku, item.V.IsActive, item.V.ProductId, item.P.Status,
                       NameFa = item.P.Translations.Where(t => t.Locale == "fa").Select(t => t.Name).FirstOrDefault() ?? "",
                       NameEn = item.P.Translations.Where(t => t.Locale == "en").Select(t => t.Name).FirstOrDefault() ?? "",
                       Available = (int?)balance.Available ?? 0
                   };
        if (query.MinAvailable is { } min) rows = rows.Where(r => r.Available >= min);
        if (query.MaxAvailable is { } max) rows = rows.Where(r => r.Available <= max);
        var total = await rows.CountAsync(ct);
        var sorted = (query.Sort, query.Descending) switch
        {
            ("available", false) => rows.OrderBy(r => r.Available),
            ("available", true) => rows.OrderByDescending(r => r.Available),
            ("sku", false) => rows.OrderBy(r => r.Sku),
            ("sku", true) => rows.OrderByDescending(r => r.Sku),
            (_, false) => rows.OrderBy(r => r.NameFa == "" ? r.NameEn : r.NameFa),
            _ => rows.OrderByDescending(r => r.NameFa == "" ? r.NameEn : r.NameFa)
        };
        var items = await sorted.ThenBy(r => r.Id).Skip(query.Page * query.PageSize).Take(query.PageSize)
            .Select(r => new StockVariantMetadata(r.Id, r.ProductId, r.Sku, r.NameFa, r.NameEn, r.IsActive, r.Status, false))
            .ToArrayAsync(ct);
        return new(total, query.Page, query.PageSize, items);
    }
}

using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public sealed class ProductWorkspaceReader(CatalogDbContext db) : IProductWorkspaceReader
{
    private sealed class Projection
    {
        public string Id { get; set; } = ""; public byte[] Version { get; set; } = []; public string Slug { get; set; } = ""; public string NameFa { get; set; } = ""; public string NameEn { get; set; } = ""; public string CategoryId { get; set; } = ""; public string CategoryName { get; set; } = ""; public string BrandId { get; set; } = ""; public string BrandName { get; set; } = ""; public string Status { get; set; } = ""; public bool Archived
        {
            get; set;
        }
        public bool Featured
        {
            get; set;
        }
        public bool IsDigital
        {
            get; set;
        }
        public int VariantCount
        {
            get; set;
        }
        public int ActiveVariantCount
        {
            get; set;
        }
        public long? MinPrice
        {
            get; set;
        }
        public long? MaxPrice
        {
            get; set;
        }
        public long Available
        {
            get; set;
        }
        public string? ImageUrl
        {
            get; set;
        }
        public DateTimeOffset UpdatedAt
        {
            get; set;
        }
    }
    public async Task<ProductWorkspacePage> PageAsync(ProductWorkspaceFilter filter, CancellationToken ct)
    {
        if ((filter.Search.Length > 0 && await db.Variants.AnyAsync(v => v.SearchSku == "", ct)) ||
            ((filter.Search.Length > 0 || filter.Name.Length > 0) && await db.Set<Shop.Modules.Catalog.Domain.ProductTranslation>().AnyAsync(t => t.SearchName == "", ct)))
            throw new BusinessException("catalog_reindex_required", "Catalog search maintenance is incomplete.");
        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct) : null;
        var products = db.Products.AsNoTracking();
        if (filter.Statuses.Length == 0)
        {
            products = products.Where(p => filter.Status == "archived" ? p.ArchivedAt != null : p.ArchivedAt == null);
            if (filter.Status is not ("all" or "archived"))
                products = products.Where(p => p.Status == filter.Status);
        }
        else
        {
            var includeArchived = filter.Statuses.Contains("archived");
            var activeStatuses = filter.Statuses.Where(status => status != "archived").ToArray();
            products = activeStatuses.Length == 0
                ? products.Where(p => p.ArchivedAt != null)
                : products.Where(p => (includeArchived && p.ArchivedAt != null) ||
                    (p.ArchivedAt == null && activeStatuses.Contains(p.Status)));
        }
        if (filter.CategoryIds.Length > 0)
            products = products.Where(p => filter.CategoryIds.Contains(p.CategoryId));
        else if (filter.CategoryId is not null)
            products = products.Where(p => p.CategoryId == filter.CategoryId);
        if (filter.BrandIds.Length > 0)
            products = products.Where(p => filter.BrandIds.Contains(p.BrandId));
        else if (filter.BrandId is not null)
            products = products.Where(p => p.BrandId == filter.BrandId);
        foreach (var token in filter.Search.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            products = products.Where(p => p.Translations.Any(t => t.SearchName.Contains(token)) || p.Variants.Any(v => v.SearchSku.Contains(token)));
        foreach (var token in filter.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            products = products.Where(p => p.Translations.Any(t => t.SearchName.Contains(token)));
        if (filter.UpdatedFrom is { } from)
            products = products.Where(p => p.UpdatedAt >= from);
        if (filter.UpdatedBefore is { } before)
            products = products.Where(p => p.UpdatedAt < before);
        var rows = products.Select(p => new Projection
        {
            Id = p.Id,
            Version = p.Version,
            Slug = p.Slug,
            NameFa = p.Translations.Where(t => t.Locale == "fa").Select(t => t.Name).FirstOrDefault() ?? "",
            NameEn = p.Translations.Where(t => t.Locale == "en").Select(t => t.Name).FirstOrDefault() ?? "",
            CategoryId = p.CategoryId,
            CategoryName = db.Categories.Where(c => c.Id == p.CategoryId).SelectMany(c => c.Translations).Where(t => t.Locale == "fa").Select(t => t.Name).FirstOrDefault() ?? "",
            BrandId = p.BrandId,
            BrandName = db.Brands.Where(b => b.Id == p.BrandId).Select(b => b.Name).FirstOrDefault() ?? "",
            Status = p.Status,
            Archived = p.ArchivedAt != null,
            Featured = p.Featured,
            IsDigital = p.IsDigital,
            VariantCount = p.Variants.Count,
            ActiveVariantCount = p.Variants.Count(v => v.IsActive),
            MinPrice = p.Variants.Where(v => v.IsActive).Select(v => (long?)v.PriceRial).Min(),
            MaxPrice = p.Variants.Where(v => v.IsActive).Select(v => (long?)v.PriceRial).Max(),
            Available = (from v in p.Variants where v.IsActive join s in db.Set<AvailableStockV1>() on v.Id equals s.VariantId select (long?)s.Available).Sum() ?? 0,
            ImageUrl = p.Media.Where(m => m.Type == "image").OrderBy(m => m.SortOrder).Select(m => m.Url).FirstOrDefault(),
            UpdatedAt = p.UpdatedAt
        });
        if (filter.Availability == "available")
            rows = rows.Where(p => p.Available > 0);
        else if (filter.Availability == "empty")
            rows = rows.Where(p => p.Available == 0);
        if (filter.MinPriceRial is { } minPrice)
            rows = rows.Where(p => p.MinPrice >= minPrice);
        if (filter.MaxPriceRial is { } maxPrice)
            rows = rows.Where(p => p.MinPrice <= maxPrice);
        if (filter.MinStock is { } minStock)
            rows = rows.Where(p => p.Available >= minStock);
        if (filter.MaxStock is { } maxStock)
            rows = rows.Where(p => p.Available <= maxStock);
        if (filter.MinVariants is { } minVariants)
            rows = rows.Where(p => p.VariantCount >= minVariants);
        if (filter.MaxVariants is { } maxVariants)
            rows = rows.Where(p => p.VariantCount <= maxVariants);
        var count = await rows.LongCountAsync(ct);
        var sorted = (filter.Sort, filter.Descending) switch
        {
            ("name", false) => rows.OrderBy(p => p.NameFa),
            ("name", true) => rows.OrderByDescending(p => p.NameFa),
            ("category", false) => rows.OrderBy(p => p.CategoryName),
            ("category", true) => rows.OrderByDescending(p => p.CategoryName),
            ("brand", false) => rows.OrderBy(p => p.BrandName),
            ("brand", true) => rows.OrderByDescending(p => p.BrandName),
            ("status", false) => rows.OrderBy(p => p.Archived ? "archived" : p.Status),
            ("status", true) => rows.OrderByDescending(p => p.Archived ? "archived" : p.Status),
            ("price", false) => rows.OrderBy(p => p.MinPrice),
            ("price", true) => rows.OrderByDescending(p => p.MinPrice),
            ("stock", false) => rows.OrderBy(p => p.Available),
            ("stock", true) => rows.OrderByDescending(p => p.Available),
            ("variants", false) => rows.OrderBy(p => p.VariantCount),
            ("variants", true) => rows.OrderByDescending(p => p.VariantCount),
            (_, false) => rows.OrderBy(p => p.UpdatedAt),
            _ => rows.OrderByDescending(p => p.UpdatedAt)
        };
        var page = await sorted.ThenBy(p => p.Id).Skip(checked(filter.Page * filter.PageSize)).Take(filter.PageSize).ToArrayAsync(ct);
        if (transaction is not null)
            await transaction.CommitAsync(ct);
        return new(1, filter.Page, filter.PageSize, ProductWorkspaceRules.Money(count), page.Select(p => new ProductWorkspaceRow(p.Id, Convert.ToBase64String(p.Version), p.Slug, p.NameFa, p.NameEn, p.CategoryId, p.CategoryName, p.BrandId, p.BrandName, p.Status, p.Archived, p.Featured, p.IsDigital, p.VariantCount, p.ActiveVariantCount, p.MinPrice is { } min ? ProductWorkspaceRules.Money(min) : null, p.MaxPrice is { } max ? ProductWorkspaceRules.Money(max) : null, ProductWorkspaceRules.Money(p.Available), p.ImageUrl, p.UpdatedAt)).ToArray());
    }
    public async Task<ProductWorkspaceDetail> DetailAsync(string id, CancellationToken ct)
    {
        var product = await AdminProductsQuery.Detail(db, id).SingleOrDefaultAsync(ct) ?? throw new BusinessException("not_found", "Product was not found.");
        await CatalogReadVersions.EnsureProductsAsync(db, [product], ct);
        return new(1, AdminProductDetail.From(product).Product, product.ArchivedAt != null, product.Media.Where(m => m.Type == "video").OrderBy(m => m.SortOrder).Select(m => new ProductVideoDto(m.Url, m.VariantId)).ToArray());
    }
}

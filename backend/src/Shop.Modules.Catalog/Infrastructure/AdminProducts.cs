using Microsoft.EntityFrameworkCore;
using Shop.Modules.Catalog.Application;
using Shop.Modules.Catalog.Domain;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;
public static class AdminProductsQuery
{
    public static IQueryable<AdminProductSummary> Read(CatalogDbContext db,AdminProductQuery query,string? after=null,string[]? ids=null)
    {
        var rows=db.Products.AsNoTracking().Where(p=>p.ArchivedAt==null);if(query.Status!="all")rows=rows.Where(p=>p.Status==query.Status);if(query.CategoryId is not null)rows=rows.Where(p=>p.CategoryId==query.CategoryId);if(query.BrandId is not null)rows=rows.Where(p=>p.BrandId==query.BrandId);
        foreach(var token in query.Search.Split(' ',StringSplitOptions.RemoveEmptyEntries))rows=rows.Where(p=>p.Translations.Any(t=>t.SearchName.Contains(token))||p.Variants.Any(v=>v.SearchSku.Contains(token)));
        if(after is not null)rows=rows.Where(p=>string.Compare(p.Id,after)>0);if(ids is not null)rows=rows.Where(p=>ids.Contains(p.Id));
        return rows.OrderBy(p=>p.Id).Select(p=>new AdminProductSummary(p.Id,p.Slug,p.Translations.Where(t=>t.Locale=="fa").Select(t=>t.Name).FirstOrDefault()??"",p.Translations.Where(t=>t.Locale=="en").Select(t=>t.Name).FirstOrDefault()??"",p.CategoryId,p.BrandId,p.Status,p.Featured,p.Variants.Count));
    }
    public static IQueryable<Product> Detail(CatalogDbContext db,string id){AdminProductQuery.Identifier(id);return CatalogProductGraph.Read(db).AsNoTracking().Where(p=>p.Id==id);}
}
public sealed class AdminProducts(CatalogDbContext db):IAdminProducts
{
    public async Task<AdminProductPage> PageAsync(AdminProductQuery query,string? cursor,CancellationToken ct)
    {
        var after=AdminProductPaging.Decode(cursor,query);
        if(query.Search.Length>0&&(await db.Variants.AnyAsync(v=>v.SearchSku=="",ct)||await db.Set<ProductTranslation>().AnyAsync(t=>t.SearchName=="",ct)))throw new BusinessException("catalog_reindex_required","Catalog search maintenance is incomplete.");
        var rows=await AdminProductsQuery.Read(db,query,after).Take(51).ToArrayAsync(ct);return new(1,50,rows.Take(50).ToArray(),rows.Length>50?AdminProductPaging.Encode(rows[49].Id,query):null);
    }
    public static void ValidateLookup(string[] ids)
    {
        if(ids is null||ids.Length>24||ids.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=ids.Length)throw new BusinessException("invalid_product_lookup","Use up to 24 distinct product ids.");
        foreach(var id in ids)AdminProductQuery.Identifier(id);
    }
    public async Task<AdminProductSummary[]> LookupAsync(string[] ids,CancellationToken ct){ValidateLookup(ids);return ids.Length==0?[]:await AdminProductsQuery.Read(db,AdminProductQuery.Create(),ids:ids).ToArrayAsync(ct);}
    public async Task<AdminProductDetail> DetailAsync(string id,CancellationToken ct)
    {
        var product=await AdminProductsQuery.Detail(db,id).SingleOrDefaultAsync(ct)??throw new BusinessException("not_found","Product was not found.");
        await CatalogReadVersions.EnsureProductsAsync(db,[product],ct);
        return AdminProductDetail.From(product);
    }
}

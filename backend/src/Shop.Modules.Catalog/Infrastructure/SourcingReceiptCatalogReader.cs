using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Catalog.Infrastructure;

public static class SourcingReceiptCatalogQuery
{
    public static IQueryable<SourcingReceiptSkuIdentity> Read(CatalogDbContext db,string[] ids)=>
        from variant in db.Variants.AsNoTracking()
        join product in db.Products.AsNoTracking() on variant.ProductId equals product.Id
        where ids.Contains(variant.Id)
        select new SourcingReceiptSkuIdentity(variant.Id,product.Id,product.IsDigital);
}
public sealed class SourcingReceiptCatalogReader(CatalogDbContext db):ISourcingReceiptCatalogReader
{
    public async Task<IReadOnlyDictionary<string,SourcingReceiptSkuIdentity>> ReadAsync(string[] variantIds,CancellationToken ct)
    {
        var ids=SourcingReceiptCatalogRules.Ids(variantIds);
        if(ids.Length==0)return new Dictionary<string,SourcingReceiptSkuIdentity>(StringComparer.OrdinalIgnoreCase);
        if(db.Database.CurrentTransaction is not {} transaction||transaction.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)
            throw new InvalidOperationException("Physical receiving requires the shared Serializable transaction.");
        var rows=await SourcingReceiptCatalogQuery.Read(db,ids).ToArrayAsync(ct);
        return rows.ToDictionary(row=>row.VariantId,StringComparer.OrdinalIgnoreCase);
    }
}

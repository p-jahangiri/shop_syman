using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Catalog.Infrastructure;

public sealed class AccountingStockCatalogReader(CatalogDbContext db):IAccountingStockCatalogReader
{
    public async Task<AccountingStockCatalogProof[]> ReadAsync(string[] variantIds,CancellationToken ct)
    {
        if(variantIds is null||variantIds.Length>200||variantIds.Any(x=>string.IsNullOrEmpty(x)||x.Length>64||x.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))||variantIds.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=variantIds.Length)throw new BusinessException("invalid_accounting_stock_command","Read at most 200 distinct actual SKU identifiers.");
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Accounting stock proofs require the root Serializable transaction.");
        var rows=await(from v in db.Variants.AsNoTracking() join p in db.Products.AsNoTracking() on v.ProductId equals p.Id where variantIds.Contains(v.Id) select new{v.Id,v.ProductId,v.Version,ProductVersion=p.Version,v.IsActive,p.IsDigital,v.UsedInspectionId}).ToArrayAsync(ct);
        return rows.OrderBy(x=>x.Id.ToUpperInvariant(),StringComparer.Ordinal).Select(x=>new AccountingStockCatalogProof(x.Id,x.ProductId,Convert.ToBase64String(x.Version),Convert.ToBase64String(x.ProductVersion),x.IsActive,x.IsDigital,x.UsedInspectionId is not null)).ToArray();
    }
}

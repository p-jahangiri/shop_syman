using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;
namespace Shop.Modules.Inventory;

public sealed class UsedItemStockPolicy(InventoryDbContext db):IUsedItemStockPolicy
{
    public async Task RequireSingleUnitAsync(string variantId,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Single-device SKU policy requires the root Serializable transaction.");
        var row=await db.Stock.FromSqlInterpolated($"SELECT * FROM [inventory].[Stock] WITH (UPDLOCK,HOLDLOCK) WHERE [VariantId]={variantId}").SingleOrDefaultAsync(ct);
        if(row is null){row=new(){VariantId=variantId};db.Stock.Add(row);}
        if(row.OnHand>1||row.Reserved!=0||row.SourcingReserved!=0)throw new BusinessException("used_item_stock_conflict","A used device needs its own SKU with at most one physical unit and no active reservations. Balances were not changed.");
        row.IsSingleUnit=true;await db.SaveChangesAsync(ct);
    }
}

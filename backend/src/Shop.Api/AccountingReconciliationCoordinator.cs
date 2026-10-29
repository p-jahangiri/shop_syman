using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.SharedKernel;

// Composition root only coordinates connections. Modules read their own data.
public sealed class AccountingReconciliationCoordinator(CatalogDbContext catalog,InventoryDbContext inventory,IAccountingImports imports,IAccountingInventory service)
{
    public async Task<AccountingReconciliation> ReadAsync(string id,CancellationToken ct)
        =>await ReadAtomicAsync(async()=>await service.ReconcileAsync(await imports.ReadAsync(id,ct),ct),ct);
    internal async Task<T> ReadAtomicAsync<T>(Func<Task<T>> read,CancellationToken ct)
    {
        await using var transaction=await catalog.Database.BeginTransactionAsync(IsolationLevel.Serializable,ct);
        var original=inventory.Database.GetDbConnection();var connection=catalog.Database.GetDbConnection();
        if(original.State!=ConnectionState.Closed||original.Database!=connection.Database||original.DataSource!=connection.DataSource)throw new InvalidOperationException("Reconciliation requires closed contexts on the same database.");
        inventory.Database.SetDbConnection(connection,contextOwnsConnection:false);
        try{
            await inventory.Database.UseTransactionAsync(transaction.GetDbTransaction(),ct);
            var result=await read();
            await transaction.CommitAsync(ct);return result;
        }finally{await inventory.Database.UseTransactionAsync(null,CancellationToken.None);inventory.Database.SetDbConnection(original,contextOwnsConnection:true);}
    }
}

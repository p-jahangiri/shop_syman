using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.SharedKernel;

public sealed class AccountingStockCoordinator(IServiceProvider services,AccountingReconciliationCoordinator reads,IAccountingImports imports,IAccountingStockCatalogReader catalog,IAccountingStockApplications inventory)
{
    private async Task<(AccountingImportDetail Source,AccountingStockCatalogProof[] Proofs)> SourceAsync(string batchId,CancellationToken ct)
    {
        var source=await imports.ReadAsync(batchId,ct);var ids=source.Rows.Where(x=>x.CurrentMatch is not null).Select(x=>x.CurrentMatch!.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();return(source,await catalog.ReadAsync(ids,ct));
    }
    public Task<AccountingStockPreview> PreviewAsync(string batchId,CancellationToken ct)=>reads.ReadAtomicAsync(async()=>{var data=await SourceAsync(batchId,ct);return await inventory.PreviewAsync(data.Source,data.Proofs,ct);},ct);
    public async Task<AccountingStockApplied> ApplyAsync(string actor,string batchId,AccountingStockApplyInput supplied,CancellationToken ct)
    {
        var identity=services.GetRequiredService<IdentityDbContext>();var transaction=identity.Database.CurrentTransaction?.GetDbTransaction();
        if(transaction?.IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Manual stock application requires the root administrative audit transaction.");
        foreach(var type in new[]{typeof(CatalogDbContext),typeof(InventoryDbContext)}){var db=(DbContext)services.GetRequiredService(type);if(!ReferenceEquals(db.Database.CurrentTransaction?.GetDbTransaction(),transaction)||!ReferenceEquals(db.Database.GetDbConnection(),identity.Database.GetDbConnection()))throw new InvalidOperationException("Accounting stock participants must share the root transaction and connection.");}
        batchId=SourcingReceivingRules.Id(batchId);var input=AccountingStockApplyRules.Normalize(supplied);await inventory.AcquireAsync(ct);
        var prior=await inventory.ReplayAsync(actor,batchId,input,ct);if(prior is not null)return prior;
        var data=await SourceAsync(batchId,ct);await inventory.LockStockAsync(data.Proofs.Select(x=>x.VariantId).ToArray(),ct);
        return await inventory.ApplyAsync(actor,await inventory.PreviewAsync(data.Source,data.Proofs,ct),input,ct);
    }
}

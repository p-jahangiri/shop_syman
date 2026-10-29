using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;

// The existing administrative audit filter owns commit/rollback and all enlisted
// contexts. This coordinator never starts a nested transaction or commits it.
public sealed class SupplyReceivingCoordinator(IServiceProvider services,SourcingSupplyService supply,IInventorySourcingReceiving receiving,IReceivingUnitMappings mappings,ISourcingReceiptCatalogReader catalog)
{
    private void AssertRootTransaction()
    {
        var identity=services.GetRequiredService<IdentityContext>();
        var transaction=identity.Database.CurrentTransaction?.GetDbTransaction();
        if(transaction is null||transaction.IsolationLevel!=IsolationLevel.Serializable)
            throw new InvalidOperationException("Physical receiving requires the administrative audit transaction.");
        foreach(var type in new[]{typeof(CatalogDbContext),typeof(InventoryDbContext),typeof(MarketDbContext)}){
            var db=(DbContext)services.GetRequiredService(type);
            if(!ReferenceEquals(db.Database.CurrentTransaction?.GetDbTransaction(),transaction)||!ReferenceEquals(db.Database.GetDbConnection(),identity.Database.GetDbConnection()))
                throw new InvalidOperationException("Receiving participants must share the root Serializable transaction and connection.");
        }
    }
    public async Task<SourcingReceivingResult> ReceiveAsync(string actor,string requestId,string taskId,string receiptId,SourcingReceiptInput supplied,CancellationToken ct)
    {
        AssertRootTransaction();var input=SourcingReceivingRules.Normalize(supplied);
        // Preserve lock order even during replay. Taking Inventory's command lock
        // before a new Market request lock would invert an ordinary receive.
        await supply.AcquireReceivingLocksAsync(actor,requestId,taskId,input.RequestId,ct);
        var previous=await receiving.ReplayAsync(actor,requestId,taskId,receiptId,input,ct);
        if(previous is not null)return previous;
        var plan=await supply.PrepareReceiveAsync(actor,requestId,taskId,input,ct);
        var selected=SourcingReceiptCatalogRules.ForReceipt(plan,input.Lines.Select(line=>line.OfferLineId).ToArray());
        var identities=await catalog.ReadAsync(selected.Lines.Select(line=>line.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);
        SourcingReceiptCatalogRules.AssertPlan(selected,identities);
        var result=await receiving.ReceiveAsync(actor,receiptId,plan,input,ct);
        await supply.CompleteReceiveAsync(actor,plan,result,ct);
        return result;
    }
    public async Task<ReceivingUnitMappingMutation> SaveMappingAsync(string actor,string id,ReceivingUnitMappingInput input,CancellationToken ct)
    {
        AssertRootTransaction();
        var previous=await mappings.ReplayAsync(actor,id,input,ct);if(previous is not null)return previous;
        var identities=await catalog.ReadAsync([input.VariantId],ct);SourcingReceiptCatalogRules.AssertPhysical(input.VariantId,identities);
        return await mappings.SaveAsync(actor,id,input,ct);
    }
    public async Task<SupplyInventoryView> ReadTaskAsync(string taskId,CancellationToken ct)
    {
        var task=await supply.InventoryReadAsync(taskId,ct);
        var stock=await receiving.ReadStockAsync(task.Lines.Select(line=>line.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(),ct);
        // Reject Market progress/version drift across module reads. Independent
        // Inventory changes are checked by each submitted StockVersion; this
        // read does not promise a transaction-wide Stock snapshot.
        var current=await supply.InventoryReadAsync(taskId,ct);
        if(task.RequestVersion!=current.RequestVersion||task.Task.Version!=current.Task.Version)
            throw new BusinessException("version_conflict","The receiving task changed while loading its physical Stock state.");
        return new(1,current,stock);
    }
}
public sealed record SupplyInventoryView(int SchemaVersion,SourcingSupplyInventoryDetail Task,ReceivingStockState[] Stock);

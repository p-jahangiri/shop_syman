using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Catalog.Infrastructure;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.Modules.Sales;
using Shop.SharedKernel;
using IdentityContext=Shop.Modules.Identity.IdentityDbContext;

// Only this composition root shares module transactions. Domain modules never
// obtain another module's context or copy a public price into an agreement.
internal static class SourcingAllocationTransaction
{
    public static void Assert(IServiceProvider services,bool administrative)
    {
        DbContext root=administrative?services.GetRequiredService<IdentityContext>():services.GetRequiredService<SalesDbContext>();
        var transaction=root.Database.CurrentTransaction?.GetDbTransaction();
        if(transaction is null||transaction.IsolationLevel!=IsolationLevel.Serializable)
            throw new InvalidOperationException("Sourcing allocation requires the shared Serializable root transaction.");
        foreach(var type in new[]{typeof(CatalogDbContext),typeof(InventoryDbContext),typeof(MarketDbContext),typeof(SalesDbContext)}){
            var db=(DbContext)services.GetRequiredService(type);
            if(!ReferenceEquals(db.Database.CurrentTransaction?.GetDbTransaction(),transaction)||!ReferenceEquals(db.Database.GetDbConnection(),root.Database.GetDbConnection()))
                throw new InvalidOperationException("Allocation, accepted price and audit must share one transaction and connection.");
        }
    }
}

public sealed class SupplyAllocationCoordinator(IServiceProvider services,SourcingAllocationPlanService market,SourcingPriceAgreementService sales,IInventorySourcingAllocations inventory)
{
    public async Task<SourcingAllocationMutation> AllocateAsync(string actor,string requestId,string taskId,string allocationId,SourcingAllocationInput supplied,CancellationToken ct)
    {
        SourcingAllocationTransaction.Assert(services,true);
        var input=SourcingAllocationRules.Normalize(supplied);requestId=SourcingAllocationRules.Id(requestId);taskId=SourcingAllocationRules.Id(taskId);allocationId=SourcingAllocationRules.Id(allocationId);
        // Global order: Market request/task -> Sales agreement -> Inventory
        // command/acceptance/allocation -> sorted Stock -> physical unit claims.
        await market.AcquireLocksAsync(actor,requestId,taskId,input.RequestId,ct);
        await sales.LockAsync(input.AcceptanceId,ct);
        var previous=await inventory.ReplayAsync(actor,requestId,taskId,allocationId,input,ct);
        if(previous is not null)return previous;
        var plan=await market.PrepareAsync(requestId,taskId,input,ct);
        await sales.EnsureForAllocationAsync(plan,allocationId,ct);
        var stock=new SourcingStockAllocationPlan(plan.RequestId,plan.TaskId,plan.OfferId,plan.AcceptanceId,plan.OwnerId,plan.TermsHash,plan.PurchaseUntil,plan.ContainsDemo,plan.Lines.Select(l=>new SourcingStockAllocationPlanLine(l.OfferLineId,l.Sku.VariantId,l.Sku.ProductId,l.Quantity,l.Sku.MaterialFingerprint)).ToArray());
        var result=await inventory.AllocateAsync(actor,allocationId,stock,input,ct);
        await market.CompleteAsync(actor,plan,result,ct);
        return result;
    }
    public async Task<SourcingAllocationMutation> ReleaseAsync(string actor,string requestId,string taskId,string allocationId,SourcingAllocationReleaseInput supplied,CancellationToken ct)
    {
        SourcingAllocationTransaction.Assert(services,true);
        var input=SourcingAllocationRules.Normalize(supplied);requestId=SourcingAllocationRules.Id(requestId);taskId=SourcingAllocationRules.Id(taskId);allocationId=SourcingAllocationRules.Id(allocationId);
        await market.AcquireLocksAsync(actor,requestId,taskId,input.RequestId,ct,"release");
        await sales.LockAsync(input.AcceptanceId,ct);
        var previous=await inventory.ReplayReleaseAsync(actor,requestId,taskId,allocationId,input,ct);
        if(previous is not null)return previous;
        await sales.AssertReleaseAllowedAsync(input.AcceptanceId,requestId,taskId,ct);
        var result=await inventory.ReleaseAsync(actor,allocationId,input,ct);
        // A wrong route must roll back even a replay; it must never become a
        // way to release a foreign task through a known allocation identifier.
        if(result.RequestId!=requestId||result.TaskId!=taskId||result.AcceptanceId!=input.AcceptanceId)
            throw new BusinessException("not_found","The allocation does not belong to this supply task.");
        return result;
    }
}

// Called under Market locks by both staff close and customer parent close.
// Sales consumption is authoritative even when the original offer has expired.
public sealed class SourcingPurchaseLifecycle(IServiceProvider services,SourcingPriceAgreementService sales,IInventorySourcingAllocations inventory):ISourcingPurchaseLifecycle
{
    public async Task BeforeCloseAsync(string actor,string requestId,string taskId,string acceptanceId,string reason,CancellationToken ct)
    {
        SourcingAllocationTransaction.Assert(services,false);
        await sales.BeforeCloseAsync(acceptanceId,requestId,taskId,ct);
        await inventory.ReleaseForAcceptanceAsync(actor,acceptanceId,reason,ct);
    }
}

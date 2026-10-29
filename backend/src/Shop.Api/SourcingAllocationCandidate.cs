using System.Text.Json.Serialization;
using Shop.Modules.Inventory;
using Shop.Modules.Market;
using Shop.SharedKernel;

// Warehouse receives the accepted line identities, current Stock tokens and
// opaque consent hash. Negotiated prices, customer and supplier stay private.
public sealed record SourcingAllocationCandidateLine(string OfferLineId,string VariantId,string Sku,string NameFa,string NameEn,string LabelFa,string LabelEn,int Quantity);
public sealed record SourcingAllocationCandidateStock(string VariantId,string TrackingMode,int OnHand,int Reserved,int SourcingReserved,int Available,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Version);
public sealed record SourcingAllocationCandidateData(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,string TaskId,string TaskVersion,string OfferId,string OfferVersion,string AcceptanceId,string TermsHash,DateTimeOffset PurchaseUntil,bool IsDemo,bool CanAttemptAllocation,SourcingAllocationCandidateLine[] Lines,SourcingAllocationCandidateStock[] Stock,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]SourcingAllocationSummaryData? Allocation,bool CanCheckout=false,bool CanPay=false);

public sealed class SourcingAllocationCandidate(SourcingSupplyService supply,SourcingOfferService offers,IAdminStockReader stock,IInventorySourcingReceiving receiving,IInventorySourcingAllocations allocations,TimeProvider clock)
{
    public async Task<SourcingAllocationCandidateData> ReadAsync(string taskId,CancellationToken ct)
    {
        var task=await supply.InventoryReadAsync(taskId,ct);
        var offer=await offers.ReadAsync(null,task.RequestId,task.Task.OfferId,ct);
        if(task.RequestVersion!=offer.RequestVersion||offer.Offer.AcceptanceId!=task.Task.AcceptanceId)throw Changed();
        var ids=task.Lines.Select(l=>l.VariantId).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var rows=new Dictionary<string,AdminStockRecord>(StringComparer.OrdinalIgnoreCase);
        foreach(var batch in ids.Chunk(50))foreach(var row in await stock.ReadAsync(batch,ct))rows.Add(row.VariantId,row);
        var modes=(await receiving.ReadStockAsync(ids,ct)).ToDictionary(x=>x.VariantId,StringComparer.OrdinalIgnoreCase);
        var allocation=(await allocations.ReadSummariesAsync([task.Task.AcceptanceId],null,ct)).SingleOrDefault();
        var current=await supply.InventoryReadAsync(taskId,ct);
        if(task.RequestVersion!=current.RequestVersion||task.Task.Version!=current.Task.Version)throw Changed();
        var states=ids.Select(id=>{
            rows.TryGetValue(id,out var row);if(!modes.TryGetValue(id,out var mode)||mode.Version!=row?.Version||mode.OnHand!=(row?.OnHand??0)||mode.Reserved!=(row?.Reserved??0))throw Changed();
            return new SourcingAllocationCandidateStock(id,mode.TrackingMode,row?.OnHand??0,row?.Reserved??0,row?.SourcingReserved??0,StockAvailability.Available(row?.OnHand??0,row?.Reserved??0,row?.SourcingReserved??0),row?.Version);
        }).ToArray();
        if(allocation is not null&&(allocation.RequestId!=task.RequestId||allocation.TaskId!=task.Task.Id||allocation.OfferId!=task.Task.OfferId))throw Changed();
        return new(1,current.RequestId,current.RequestReference,current.RequestVersion,current.Task.Id,current.Task.Version,current.Task.OfferId,offer.Offer.Summary.Version,current.Task.AcceptanceId,offer.Offer.Summary.TermsHash,current.Task.PurchaseUntil,current.Task.IsDemo,current.Task.IsOpen&&!current.Task.RequiresNewOffer&&current.Task.PurchaseUntil>clock.GetUtcNow()&&offer.Offer.Summary.State=="Accepted"&&allocation is null,current.Lines.Select(l=>new SourcingAllocationCandidateLine(l.OfferLineId,l.VariantId,l.Sku,l.NameFa,l.NameEn,l.LabelFa,l.LabelEn,l.RequiredQuantity)).ToArray(),states,allocation);
    }
    private static BusinessException Changed()=>new("version_conflict","The accepted task or Stock changed while loading allocation choices. Refresh it.");
}

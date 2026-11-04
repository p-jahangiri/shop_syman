using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.Modules.Market;
using Shop.SharedKernel;

// Supply1 deliberately meant "not reserved". It cannot represent a live stock
// allocation and therefore fails explicitly rather than returning that old lie.
// Supply2 composes only authorized module contracts; no Inventory unit identity
// or financial/supplier metadata is added to the customer or warehouse graph.
public sealed class SourcingSupplyProjection(SourcingSupplyService supply,SupplyReceivingCoordinator receiving,IInventorySourcingAllocations allocations,TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    public async Task<SourcingSupplyPage> PageV1Async(string? owner,string requestId,string? cursor,CancellationToken ct){var result=await supply.PageAsync(owner,requestId,cursor,ct);await GuardV1(result.Items,owner,ct);return result;}
    public async Task<SourcingSupplyCustomerDetail> CustomerV1Async(string owner,string requestId,string taskId,CancellationToken ct){var result=await supply.ReadAsync(owner,requestId,taskId,ct);await GuardV1([result.Task],owner,ct);return result;}
    public async Task<SourcingSupplyAdminDetail> AdminV1Async(string requestId,string taskId,CancellationToken ct){var result=await supply.ReadAdminAsync(requestId,taskId,ct);await GuardV1([result.Task],null,ct);return result;}
    public async Task<SourcingSupplyInventoryPage> InventoryPageV1Async(string? state,string? query,string? cursor,CancellationToken ct){var result=await supply.InventoryPageAsync(state,query,cursor,ct);await GuardV1(result.Items.Select(item=>item.Task).ToArray(),null,ct);return result;}
    public async Task<SupplyInventoryView> InventoryV1Async(string taskId,CancellationToken ct){var result=await receiving.ReadTaskAsync(taskId,ct);await GuardV1([result.Task.Task],null,ct);return result;}
    private async Task GuardV1(SourcingSupplySummary[] tasks,string? owner,CancellationToken ct){if((await allocations.ReadSummariesAsync(tasks.Select(task=>task.AcceptanceId).Distinct(StringComparer.Ordinal).ToArray(),owner,ct)).Length!=0)throw new BusinessException("sourcing_supply_contract_upgrade_required","This supply task has an allocation. Use the explicit Supply2 read contract.");}

    public async Task<SourcingSupplyPage2> PageAsync(string? owner,string requestId,string? cursor,CancellationToken ct)
    {
        var first=await supply.PageAsync(owner,requestId,cursor,ct);var values=await AllocationMap(first.Items,owner,ct);var current=await supply.PageAsync(owner,requestId,cursor,ct);Check(first.RequestVersion,first.Items,current.RequestVersion,current.Items);
        var items=current.Items.Select(item=>Summary(item,values[item.Id])).ToArray();return Bound(new SourcingSupplyPage2(2,current.RequestId,current.RequestReference,current.RequestVersion,current.PageSize,items,current.NextCursor,current.StartCandidate,items.Any(item=>item.ReservedForRequest)));
    }
    public async Task<SourcingSupplyCustomerDetail2> CustomerAsync(string owner,string requestId,string taskId,CancellationToken ct)
    {
        var first=await supply.ReadAsync(owner,requestId,taskId,ct);var allocation=await Allocation(first.Task,owner,ct);var current=await supply.ReadAsync(owner,requestId,taskId,ct);Check(first.RequestVersion,[first.Task],current.RequestVersion,[current.Task]);var task=Summary(current.Task,allocation);
        return Bound(new SourcingSupplyCustomerDetail2(2,current.RequestId,current.RequestReference,current.RequestVersion,task,current.Lines,CurrentMessage(task,current.PublicMessageFa,true),CurrentMessage(task,current.PublicMessageEn,false),task.ReservedForRequest));
    }
    public async Task<SourcingSupplyAdminDetail2> AdminAsync(string requestId,string taskId,CancellationToken ct)
    {
        var first=await supply.ReadAdminAsync(requestId,taskId,ct);var allocation=await Allocation(first.Task,null,ct);var current=await supply.ReadAdminAsync(requestId,taskId,ct);Check(first.RequestVersion,[first.Task],current.RequestVersion,[current.Task]);var task=Summary(current.Task,allocation);
        return Bound(new SourcingSupplyAdminDetail2(2,current.RequestId,current.RequestReference,current.RequestVersion,task,current.Lines,CurrentMessage(task,current.PublicMessageFa,true),CurrentMessage(task,current.PublicMessageEn,false),current.SourceKind,current.SourceKey,current.SourceNameFa,current.SourceNameEn,current.Reference,current.ActionAt,current.InternalNote,current.CanRecordSource,current.CanProgress,current.CanCancel,current.CanFail,task.ReservedForRequest));
    }
    public async Task<SourcingSupplyInventoryPage2> InventoryPageAsync(string? state,string? query,string? cursor,CancellationToken ct)
    {
        var first=await supply.InventoryPageAsync(state,query,cursor,ct);var values=await AllocationMap(first.Items.Select(item=>item.Task).ToArray(),null,ct);var current=await supply.InventoryPageAsync(state,query,cursor,ct);Check("",first.Items.Select(item=>item.Task).ToArray(),"",current.Items.Select(item=>item.Task).ToArray());
        if(first.Items.Where((item,index)=>item.RequestVersion!=current.Items[index].RequestVersion).Any())throw Changed();
        return Bound(new SourcingSupplyInventoryPage2(2,current.PageSize,current.Items.Select(item=>new SourcingSupplyInventoryItem2(item.RequestId,item.RequestReference,item.RequestVersion,Summary(item.Task,values[item.Task.Id]))).ToArray(),current.NextCursor));
    }
    public async Task<SupplyInventoryView2> InventoryAsync(string taskId,CancellationToken ct)
    {
        var first=await receiving.ReadTaskAsync(taskId,ct);var allocation=await Allocation(first.Task.Task,null,ct);var current=await receiving.ReadTaskAsync(taskId,ct);Check(first.Task.RequestVersion,[first.Task.Task],current.Task.RequestVersion,[current.Task.Task]);var value=current.Task;var task=Summary(value.Task,allocation);
        return Bound(new SupplyInventoryView2(2,new(2,value.RequestId,value.RequestReference,value.RequestVersion,task,value.Lines,value.CanReceive,value.RequiresHistoricalAcknowledgement,task.ReservedForRequest),current.Stock));
    }
    private async Task<Dictionary<string,SourcingSupplyAllocationSummary?>> AllocationMap(SourcingSupplySummary[] tasks,string? owner,CancellationToken ct)
    {
        if(tasks.Length>50)throw new BusinessException("sourcing_supply_capacity_unavailable","Supply allocation pages are bounded at fifty tasks.");
        var values=await allocations.ReadSummariesAsync(tasks.Select(task=>task.AcceptanceId).Distinct(StringComparer.Ordinal).ToArray(),owner,ct);
        if(values.Length>tasks.Length||values.Select(value=>value.AcceptanceId).Distinct(StringComparer.Ordinal).Count()!=values.Length||values.Any(value=>tasks.All(task=>task.AcceptanceId!=value.AcceptanceId)))throw Changed();
        var byAcceptance=values.ToDictionary(value=>value.AcceptanceId,StringComparer.Ordinal);return tasks.ToDictionary(task=>task.Id,task=>ProjectAllocation(task,byAcceptance.GetValueOrDefault(task.AcceptanceId)),StringComparer.Ordinal);
    }
    private async Task<SourcingSupplyAllocationSummary?> Allocation(SourcingSupplySummary task,string? owner,CancellationToken ct)=> (await AllocationMap([task],owner,ct))[task.Id];
    private SourcingSupplyAllocationSummary? ProjectAllocation(SourcingSupplySummary task,SourcingAllocationSummaryData? value)
    {
        if(value is null)return null;
        if(value.SchemaVersion!=1||value.TaskId!=task.Id||value.OfferId!=task.OfferId||value.AcceptanceId!=task.AcceptanceId||value.State!="Active"||value.Lines.Length is <1 or >64||value.Lines.Length!=task.LineCount||value.Lines.Select(line=>line.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=value.Lines.Length||value.Lines.Any(line=>line.Quantity is <1 or >1000000)||value.Quantity!=task.RequiredQuantity||value.Lines.Sum(line=>(long)line.Quantity)!=task.RequiredQuantity||value.ExpiresAt>task.PurchaseUntil)throw Changed();
        return new(value.Id,value.State,value.ExpiresAt<=clock.GetUtcNow()?"Expired":value.EffectiveState,value.Version,value.ExpiresAt,value.IsDemo,value.Quantity,value.Lines.Select(line=>new SourcingSupplyAllocationLine(line.OfferLineId,line.VariantId,line.Quantity)).ToArray());
    }
    private SourcingSupplySummary2 Summary(SourcingSupplySummary value,SourcingSupplyAllocationSummary? allocation)
    {
        if(allocation is not null&&allocation.ExpiresAt<=clock.GetUtcNow())allocation=allocation with{EffectiveState="Expired"};var reserved=allocation is{State:"Active",EffectiveState:"Active"};
        return new(value.Id,value.OfferId,value.AcceptanceId,value.State,value.ReceiptProgress,value.EffectiveState,value.Version,value.LineCount,value.RequiredQuantity,value.ReceivedQuantity,value.RemainingQuantity,value.CreatedAt,value.ChangedAt,value.ExpectedAt,value.PurchaseUntil,value.IsOpen,value.RequiresNewOffer,value.IsDemo,allocation,reserved);
    }
    private static string CurrentMessage(SourcingSupplySummary2 task,string historical,bool fa)
    {
        // Preserve the immutable event text. Only a generated current-message
        // projection must stop claiming a hold after expiry or explicit release.
        if(!task.ReservedForRequest&&(historical.StartsWith("سهم این درخواست تا ",StringComparison.Ordinal)||historical.StartsWith("This request's stock share is held until ",StringComparison.Ordinal)))
            return task.Allocation is{EffectiveState:"Expired"}?(fa?"مهلت نگه‌داری این تخصیص گذشته است؛ وضعیت تازه را بازخوانی کنید.":"This allocation hold has expired; refresh the current state."):(fa?"در حال حاضر تخصیص فعال موجودی برای این درخواست ثبت نشده است.":"No active stock allocation is currently recorded for this request.");
        return historical;
    }
    private static void Check(string requestVersion,SourcingSupplySummary[] first,string currentRequestVersion,SourcingSupplySummary[] current)
    {
        if(requestVersion!=currentRequestVersion||first.Length!=current.Length||first.Where((item,index)=>item.Id!=current[index].Id||item.Version!=current[index].Version).Any())throw Changed();
    }
    private static T Bound<T>(T value){if(JsonSerializer.SerializeToUtf8Bytes(value,Json).Length>524288)throw new BusinessException("sourcing_supply_capacity_unavailable","The supply projection exceeds its response bound.");return value;}
    private static BusinessException Changed()=>new("version_conflict","The supply task or allocation changed while loading. Refresh it.");
}

public sealed record SourcingSupplyAllocationLine(string OfferLineId,string VariantId,int Quantity);
public sealed record SourcingSupplyAllocationSummary(string Id,string State,string EffectiveState,string Version,DateTimeOffset ExpiresAt,bool IsDemo,int Quantity,SourcingSupplyAllocationLine[] Lines);
public sealed record SourcingSupplySummary2(string Id,string OfferId,string AcceptanceId,string State,string ReceiptProgress,string EffectiveState,string Version,int LineCount,int RequiredQuantity,int ReceivedQuantity,int RemainingQuantity,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ExpectedAt,DateTimeOffset PurchaseUntil,bool IsOpen,bool RequiresNewOffer,bool IsDemo,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]SourcingSupplyAllocationSummary? Allocation,bool ReservedForRequest);
public sealed record SourcingSupplyCustomerDetail2(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary2 Task,SourcingSupplyLineData[] Lines,string PublicMessageFa,string PublicMessageEn,bool ReservedForRequest,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingSupplyAdminDetail2(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary2 Task,SourcingSupplyLineData[] Lines,string PublicMessageFa,string PublicMessageEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceKind,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceKey,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceNameFa,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceNameEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Reference,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ActionAt,string InternalNote,bool CanRecordSource,bool CanProgress,bool CanCancel,bool CanFail,bool ReservedForRequest,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingSupplyPage2(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,int PageSize,SourcingSupplySummary2[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]SourcingSupplyStartCandidate? StartCandidate,bool ReservedForRequest,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingSupplyInventoryDetail2(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary2 Task,SourcingSupplyInventoryLine[] Lines,bool CanReceive,bool RequiresHistoricalAcknowledgement,bool ReservedForRequest,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingSupplyInventoryItem2(string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary2 Task);
public sealed record SourcingSupplyInventoryPage2(int SchemaVersion,int PageSize,SourcingSupplyInventoryItem2[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record SupplyInventoryView2(int SchemaVersion,SourcingSupplyInventoryDetail2 Task,ReceivingStockState[] Stock);

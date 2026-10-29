using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public sealed partial class OrderParcelService
{
    private sealed record DigitalItemReference(string Id,string LineKey,int Position);
    private sealed record DigitalManifest(int SchemaVersion,string OwnerId,string OrderId,string ReservationId,bool ContainsDemo,DigitalDeliverySummary Summary,string InventoryHash,DigitalItemReference[] Items);
    private sealed record DigitalItemEnvelope(int SchemaVersion,string OwnerId,string OrderId,string DeliveryId,string ItemId,string LineKey,int Position,string Content);
    private sealed record DigitalHistory(DigitalManifest[] Manifests,OrderDigitalItem[] Items)
    {
        public int Quantity(string key)=>Items.Count(x=>x.LineKey==key);
    }
    private IDigitalDeliveryProtection DigitalProtection=>digitalProtection??throw DigitalDeliveryRules.Unavailable();
    private static HashSet<string> DigitalKeys(SalesOrder order)=>Source(order).Where(l=>l.IsDigital).Select(l=>l.Key).ToHashSet(StringComparer.Ordinal);

    public async Task<AdminDigitalDeliveryPage> ReadDigitalAdminAsync(string owner,string order,CancellationToken ct)
    {
        var f=await FactsAsync(await OrderAsync(owner,order,ct),ct);var keys=DigitalKeys(f.Order);var blockers=new List<string>();
        if(f.Order.State is not(OrderState.Paid or OrderState.CreditApproved))blockers.Add("payment_not_confirmed");
        var authorized=f.Order.State!=OrderState.CreditApproved||creditAuthorization is not null&&await creditAuthorization.IsAuthorizedAsync(f.Order.OwnerId,f.Order.Id,ct);
        if(!authorized)blockers.Add("credit_clearance_required");
        if(f.Inventory.State!=StockReservationState.Allocated)blockers.Add("reservation_not_allocated");
        if(f.Inventory.DispatchCount>=PartialFulfillmentRules.MaxDispatches)blockers.Add("delivery_capacity_reached");
        if(f.Inventory.Lines.Any(l=>l.TrackingMode!="none"&&f.Inventory.RemainingUnits.Count(u=>u.LineKey==l.LineKey)!=l.Remaining))blockers.Add("complete_serial_assignment_required");
        var lines=Source(f.Order).Where(l=>l.IsDigital).Select(l=>{var balance=f.Inventory.Lines.Single(x=>x.LineKey==l.Key);return new DigitalLineBalance(l.Key,l.VariantId,l.ProductId,l.Sku,l.Name,l.Label,l.Quantity,f.Digital.Quantity(l.Key),balance.Remaining);}).ToArray();
        return new(1,f.Order.Id,f.Order.OwnerId,f.Order.State.ToString(),Version(f.Order.Version),f.Fingerprint,f.Order.ContainsDemo,blockers.Count==0&&lines.Any(l=>l.Remaining>0),authorized,PartialFulfillmentRules.MaxDispatches-f.Inventory.DispatchCount,lines,f.Digital.Manifests.Select(x=>x.Summary).ToArray(),blockers.ToArray());
    }
    public async Task<CustomerDigitalDeliveries> ReadDigitalCustomerAsync(string owner,string order,CancellationToken ct)
    {
        var row=await OrderAsync(owner,order,ct);
        if(!await db.FulfillmentHeaders.AsNoTracking().AnyAsync(x=>x.OrderId==row.Id,ct)){
            if(await db.DigitalDeliveries.AnyAsync(x=>x.OrderId==row.Id,ct))throw DigitalDeliveryRules.Unavailable();
            return new(1,row.Id,[]);
        }
        var f=await FactsAsync(row,ct);return new(1,row.Id,f.Digital.Manifests.Select(x=>x.Summary).ToArray());
    }
    public async Task<DigitalDeliveryContent> ReadDigitalContentAsync(string owner,string order,string delivery,CancellationToken ct)
    {
        var f=await FactsAsync(await OrderAsync(owner,order,ct),ct);var id=ShipmentRules.Uuid(delivery);
        var manifest=f.Digital.Manifests.SingleOrDefault(x=>x.Summary.Id==id)??throw Missing();var content=new List<DigitalContentItem>();
        foreach(var reference in manifest.Items){
            var item=f.Digital.Items.Single(x=>x.Id==reference.Id);var envelope=Unseal<DigitalItemEnvelope>("content",f.Order.OwnerId,f.Order.Id,item.Id,item.ProtectedContent);
            if(envelope.SchemaVersion!=1||envelope.OwnerId!=f.Order.OwnerId||envelope.OrderId!=f.Order.Id||envelope.DeliveryId!=id||envelope.ItemId!=item.Id||envelope.LineKey!=item.LineKey||envelope.Position!=item.Position)throw DigitalDeliveryRules.Unavailable();
            try{_=DigitalDeliveryRules.Normalize(new(f.Order.OwnerId,new('1',32),Version(f.Order.Version),new('A',64),"read",true,[new(item.LineKey,[envelope.Content])]));}catch(BusinessException){throw DigitalDeliveryRules.Unavailable();}
            content.Add(new(item.Id,item.LineKey,envelope.Content));
        }
        return new(1,f.Order.Id,id,manifest.Summary.AvailableAt,content.ToArray());
    }
    public async Task<DigitalDeliveryResult> DeliverDigitalAsync(string actorId,string orderId,DigitalDeliveryInput supplied,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var actor=OrderInputRules.Identifier(actorId).ToUpperInvariant();var id=ShipmentRules.Uuid(orderId);var input=DigitalDeliveryRules.Normalize(supplied);var hash=Hash(new{OrderId=id,Input=input});
        await OrderV2Locks.OwnerAsync(db,input.OwnerId,ct);await CommandLockAsync(actor,input.CommandId,ct);
        var previous=await db.DigitalCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==input.CommandId,ct);
        if(previous is not null){if(previous.ContainsDemo&&!allowDemo)throw Missing();if(previous.OrderId!=id||previous.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This digital delivery command belongs to another order or body.");return DigitalReceipt(previous)with{Replayed=true};}
        var order=await OrderAsync(input.OwnerId,id,ct);var f=await FactsAsync(order,ct);
        if(input.OrderVersion!=Version(order.Version))throw new BusinessException("version_conflict","Review the current order before delivering digital content.");
        if(input.InventoryFingerprint!=f.Fingerprint)throw new BusinessException("digital_delivery_inventory_conflict","The reviewed fulfillment or inventory facts changed.");
        if(order.State is not(OrderState.Paid or OrderState.CreditApproved))throw new BusinessException("digital_delivery_payment_conflict","A paid or independently authorized personal cheque order is required.");
        if(order.State==OrderState.CreditApproved){var authority=creditAuthorization is null?null:await creditAuthorization.ReadAuthorityAsync(order.OwnerId,order.Id,ct);if(authority is not{Authorized:true,RecordedAt:not null}||authority.RecordedAt>clock.GetUtcNow())throw new BusinessException("shipment_credit_clearance_conflict","Finance must review the current evidence before delivering digital content.");}
        var deliveryId=Guid.NewGuid().ToString("N");var selections=input.Lines.Select(l=>new PartialDispatchSelection(l.LineKey,l.Contents.Length,[])).ToArray();
        var request=new PartialDispatchRequest(order.OwnerId,order.ReservationId,deliveryId,actor,input.CommandId,f.Inventory.Fingerprint,selections);
        _=FulfillmentCapacityRules.Plan(f.Inventory,request,DigitalKeys(order),true);
        var now=clock.GetUtcNow().ToUniversalTime();if(now<order.ChangedAt||f.Header is not null&&now<f.Header.ChangedAt)throw DigitalDeliveryRules.Unavailable();
        var header=await db.FulfillmentHeaders.SingleOrDefaultAsync(x=>x.OrderId==id,ct);
        if(header is null){header=new(){OrderId=id,OwnerId=order.OwnerId,ReservationId=order.ReservationId,ReservationContract=order.SnapshotVersion==2?2:1,LastParcelNumber=0,CreatedAt=now,ChangedAt=now,ContainsDemo=order.ContainsDemo};db.FulfillmentHeaders.Add(header);}
        var items=new List<OrderDigitalItem>();
        foreach(var line in input.Lines){for(var index=0;index<line.Contents.Length;index++){
            var itemId=Guid.NewGuid().ToString("N");var envelope=new DigitalItemEnvelope(1,order.OwnerId,id,deliveryId,itemId,line.LineKey,index+1,line.Contents[index]);
            items.Add(new(){Id=itemId,DeliveryId=deliveryId,LineKey=line.LineKey,Position=index+1,ProtectedContent=Seal("content",order.OwnerId,id,itemId,envelope)});
        }}
        var dispatch=await inventory.DispatchAsync(request,ct);
        if(dispatch.Replayed||dispatch.ParcelId!=deliveryId||dispatch.OrderId!=id||dispatch.OwnerId!=order.OwnerId.ToUpperInvariant()||dispatch.ActorId!=actor||dispatch.RequestId!=input.CommandId||dispatch.RecordedAt<now||dispatch.FingerprintBefore!=f.Inventory.Fingerprint||dispatch.Units.Length!=0)throw DigitalDeliveryRules.Unavailable();
        now=dispatch.RecordedAt;var source=Source(order);var summary=new DigitalDeliverySummary(deliveryId,now,input.Lines.Select(l=>{var s=source.Single(x=>x.Key==l.LineKey);return new DigitalDeliveryLineSummary(s.Key,s.VariantId,s.ProductId,s.Sku,s.Name,s.Label,l.Contents.Length);}).ToArray());
        var manifest=new DigitalManifest(1,order.OwnerId,id,order.ReservationId,order.ContainsDemo,summary,Hash(dispatch),items.Select(x=>new DigitalItemReference(x.Id,x.LineKey,x.Position)).ToArray());
        db.DigitalDeliveries.Add(new(){Id=deliveryId,OrderId=id,OwnerId=order.OwnerId,ReservationId=order.ReservationId,AvailableAt=now,ContainsDemo=order.ContainsDemo,InventoryDispatchHash=manifest.InventoryHash,ProtectedManifest=Seal("manifest",order.OwnerId,id,deliveryId,manifest)});db.DigitalItems.AddRange(items);
        header.FirstDispatchRecordedAt??=now;header.ChangedAt=now;if(db.Entry(header).State!=EntityState.Added)db.Entry(header).Property(x=>x.ChangedAt).IsModified=true;
        var physicalComplete=source.Where(l=>!l.IsDigital).All(l=>f.Lines.Where(x=>x.Key==l.Key&&f.Active.Any(p=>p.Id==x.ParcelId&&p.State=="delivered")).Sum(x=>(long)x.Quantity)==l.Quantity);
        if(dispatch.StateAfter==StockReservationState.Fulfilled&&physicalComplete)order.State=OrderState.Fulfilled;
        order.ChangedAt=now;db.Entry(order).Property(x=>x.ChangedAt).IsModified=true;order.Events.Add(new(){OrderId=id,State=order.State,ActorId=actor,Reason="digital_content_available",At=now});await db.SaveChangesAsync(ct);
        var result=new DigitalDeliveryResult(1,input.CommandId,id,Version(order.Version),summary,false);
        db.DigitalCommands.Add(new(){ActorId=actor,CommandId=input.CommandId,OrderId=id,DeliveryId=deliveryId,PayloadHash=hash,RecordedAt=now,ContainsDemo=order.ContainsDemo,ProtectedReceipt=Seal("receipt",actor,id,input.CommandId,result)});await db.SaveChangesAsync(ct);return result;
    }
    public async Task<DigitalDeliveryResult> ReadDigitalReceiptAsync(string actorId,string owner,string order,string command,CancellationToken ct)
    {
        var actor=OrderInputRules.Identifier(actorId).ToUpperInvariant();var row=await OrderAsync(owner,order,ct);var uuid=ShipmentRules.Uuid(command);
        var stored=await db.DigitalCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.OrderId==row.Id&&x.CommandId==uuid,ct)??throw Missing();if(stored.ContainsDemo&&!allowDemo)throw Missing();return DigitalReceipt(stored)with{Replayed=true};
    }
    private DigitalDeliveryResult DigitalReceipt(OrderDigitalCommand row)
    {
        var result=Unseal<DigitalDeliveryResult>("receipt",row.ActorId,row.OrderId,row.CommandId,row.ProtectedReceipt);
        if(result.SchemaVersion!=1||result.CommandId!=row.CommandId||result.OrderId!=row.OrderId||result.Replayed||result.Delivery.Id!=row.DeliveryId||result.Delivery.AvailableAt!=row.RecordedAt)throw DigitalDeliveryRules.Unavailable();
        _=ShipmentRules.Version(result.OrderVersion);ValidateDigitalSummary(result.Delivery);return result;
    }
    private async Task<DigitalHistory> ReadDigitalHistoryAsync(SalesOrder order,PartialDispatchData[] dispatches,CancellationToken ct)
    {
        var rows=await db.DigitalDeliveries.AsNoTracking().Where(x=>x.OrderId==order.Id).OrderBy(x=>x.AvailableAt).ThenBy(x=>x.Id).Take(65).ToArrayAsync(ct);if(rows.Length>64)throw DigitalDeliveryRules.Unavailable();
        var ids=rows.Select(x=>x.Id).ToArray();var items=await db.DigitalItems.AsNoTracking().Where(x=>ids.Contains(x.DeliveryId)).OrderBy(x=>x.LineKey).ThenBy(x=>x.Position).Take(6401).ToArrayAsync(ct);if(items.Length>6400)throw DigitalDeliveryRules.Unavailable();
        var manifests=new List<DigitalManifest>();var source=Source(order);
        foreach(var row in rows){
            if(row.OwnerId!=order.OwnerId||row.ReservationId!=order.ReservationId||row.ContainsDemo!=order.ContainsDemo)throw DigitalDeliveryRules.Unavailable();
            var manifest=Unseal<DigitalManifest>("manifest",order.OwnerId,order.Id,row.Id,row.ProtectedManifest);var summary=manifest.Summary;ValidateDigitalSummary(summary);
            if(manifest.SchemaVersion!=1||manifest.OwnerId!=order.OwnerId||manifest.OrderId!=order.Id||manifest.ReservationId!=order.ReservationId||manifest.ContainsDemo!=order.ContainsDemo||summary.Id!=row.Id||summary.AvailableAt!=row.AvailableAt||manifest.InventoryHash!=row.InventoryDispatchHash||manifest.Items is not{Length:>0 and<=100}||manifest.Items.Select(x=>x.Id).Distinct(StringComparer.Ordinal).Count()!=manifest.Items.Length)throw DigitalDeliveryRules.Unavailable();
            if(summary.Lines.Any(l=>!source.Any(s=>s.IsDigital&&s.Key==l.LineKey&&s.VariantId==l.VariantId&&s.ProductId==l.ProductId&&s.Sku==l.Sku&&s.Name==l.Name&&s.Label==l.Label&&l.Quantity<=s.Quantity)))throw DigitalDeliveryRules.Unavailable();
            var owned=items.Where(x=>x.DeliveryId==row.Id).ToArray();
            if(owned.Length!=manifest.Items.Length||manifest.Items.Any(r=>!owned.Any(x=>x.Id==r.Id&&x.LineKey==r.LineKey&&x.Position==r.Position))||summary.Lines.Any(l=>owned.Count(x=>x.LineKey==l.LineKey)!=l.Quantity)||owned.Any(x=>!summary.Lines.Any(l=>l.LineKey==x.LineKey)))throw DigitalDeliveryRules.Unavailable();
            var dispatch=dispatches.SingleOrDefault(x=>x.ParcelId==row.Id);
            if(dispatch is null||Hash(dispatch)!=row.InventoryDispatchHash||dispatch.RecordedAt!=row.AvailableAt||dispatch.Units.Length!=0||dispatch.Lines.Length!=summary.Lines.Length||dispatch.Lines.Any(l=>l.TrackingMode!="none"||!summary.Lines.Any(s=>s.LineKey==l.LineKey&&s.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&s.Quantity==l.Quantity)))throw DigitalDeliveryRules.Unavailable();
            manifests.Add(manifest);
        }
        return new(manifests.ToArray(),items);
    }
    private static void ValidateDigitalSummary(DigitalDeliverySummary value)
    {
        if(value is null||value.Lines is not{Length:>0 and<=64}||value.AvailableAt.Offset!=TimeSpan.Zero||value.Lines.Any(x=>x is null||x.Quantity is<1 or>100)||value.Lines.Sum(x=>x.Quantity)>100||value.Lines.Select(x=>x.LineKey).Distinct(StringComparer.Ordinal).Count()!=value.Lines.Length)throw DigitalDeliveryRules.Unavailable();
        _=ShipmentRules.Uuid(value.Id);foreach(var l in value.Lines){_=PartialFulfillmentRules.Identifier(l.LineKey);_=PartialFulfillmentRules.Identifier(l.VariantId);_=PartialFulfillmentRules.Identifier(l.ProductId);if(l.Sku is not{Length:>0 and<=80}||l.Name is not{Length:>0 and<=250}||l.Label is null)throw DigitalDeliveryRules.Unavailable();}
    }
    private byte[] Seal<T>(string purpose,string owner,string order,string id,T value)=>DigitalProtection.Protect(purpose,owner,order,id,JsonSerializer.Serialize(value,Json));
    private T Unseal<T>(string purpose,string owner,string order,string id,byte[] bytes)
    {
        try{return JsonSerializer.Deserialize<T>(DigitalProtection.Unprotect(purpose,owner,order,id,bytes),Json)??throw DigitalDeliveryRules.Unavailable();}
        catch(Exception e)when(e is JsonException or NullReferenceException or FormatException){throw DigitalDeliveryRules.Unavailable();}
    }
}

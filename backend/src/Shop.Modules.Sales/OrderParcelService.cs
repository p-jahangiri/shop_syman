using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

// All operations run inside the root Serializable transaction and canonical owner gate.
public sealed partial class OrderParcelService(SalesDbContext db,IPartialOrderFulfillmentInventory inventory,
    IOrderParcelProtection protection,TimeProvider clock,bool allowDemo=false,
    ICreditFulfillmentAuthorization? creditAuthorization=null,OrderShipmentService? single=null,IDigitalDeliveryProtection? digitalProtection=null)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,RespectRequiredConstructorParameters=true,RespectNullableAnnotations=true,MaxDepth=24};
    private sealed record SourceLine(string Key,string VariantId,string ProductId,string Sku,string Name,string Label,string Warranty,int Quantity,bool IsDigital);
    private sealed record LineRef(string ParcelId,int Revision,string Key,string VariantId,int Quantity,string TrackingMode);
    private sealed record Facts(SalesOrder Order,OrderFulfillmentHeader? Header,PartialFulfillmentView Inventory,
        OrderParcel[] Active,LineRef[] Lines,OrderParcelUnitClaim[] Claims,PartialDispatchData[] Dispatches,string Fingerprint,DigitalHistory Digital);

    public async Task<ParcelPage> ReadAdminAsync(string owner,string order,string? after,CancellationToken ct)
    {
        var facts=await FactsAsync(await OrderAsync(owner,order,ct),ct);
        var (page,next)=await PageAsync(facts.Order.Id,after,ct);
        var blockers=Blockers(facts);var authorized=facts.Order.State!=OrderState.CreditApproved||creditAuthorization is not null&&await creditAuthorization.IsAuthorizedAsync(facts.Order.OwnerId,facts.Order.Id,ct);
        if(!authorized)blockers=[..blockers,"credit_clearance_required"];
        var balances=Balances(facts);var claimed=facts.Claims.Select(x=>x.UnitId).ToHashSet(StringComparer.Ordinal);
        return new(1,facts.Order.Id,facts.Order.OwnerId,facts.Order.State.ToString(),Version(facts.Order.Version),facts.Header is null?"none":"parcels",facts.Order.ContainsDemo,facts.Fingerprint,facts.Inventory.DispatchCount,facts.Active.Length,balances,Source(facts.Order).Select(x=>new ShipmentLineData(x.Key,x.VariantId,x.ProductId,x.Sku,x.Name,x.Label,x.Warranty,x.Quantity,facts.Inventory.Lines.Single(l=>l.LineKey==x.Key).TrackingMode)).ToArray(),facts.Inventory.RemainingUnits.Where(x=>!claimed.Contains(x.Id)).ToArray(),facts.Claims.Where(c=>facts.Inventory.RemainingUnits.Any(u=>u.Id==c.UnitId)).Select(c=>new ParcelPackedUnit(c.ParcelId,facts.Inventory.RemainingUnits.Single(u=>u.Id==c.UnitId))).ToArray(),page,next,blockers.Length==0&&balances.Any(x=>!DigitalKeys(facts.Order).Contains(x.LineKey)&&x.Remaining>x.Packed),authorized,blockers,facts.Digital.Manifests.Length,DigitalKeys(facts.Order).Count==0?null:DigitalKeys(facts.Order).Order(StringComparer.Ordinal).ToArray());
    }
    public async Task<CustomerFulfillmentData> ReadCustomerAsync(string owner,string order,string? after,CancellationToken ct)
    {
        var row=await OrderAsync(owner,order,ct);var header=await db.FulfillmentHeaders.AsNoTracking().SingleOrDefaultAsync(x=>x.OrderId==row.Id,ct);
        if(header is null){if(after is not null)throw ParcelRules.Invalid();if(single is null)throw ParcelRules.Unavailable();var old=await single.ReadCustomerAsync(owner,order,ct);return new(1,row.Id,old.Shipment is null?"none":"single",old,[],null,old.ManualCarrierReport);}
        _=await FactsAsync(row,ct);var (page,next)=await PageAsync(row.Id,after,ct);
        return new(1,row.Id,"parcels",null,page,next,page.Any(x=>x.State is "dispatched"or"delivered"));
    }
    public async Task<ParcelDetail> ReadDetailAsync(string owner,string order,string parcel,bool customer,CancellationToken ct)
    {
        var facts=await FactsAsync(await OrderAsync(owner,order,ct),ct);var id=ShipmentRules.Uuid(parcel);
        var row=await db.Parcels.AsNoTracking().SingleOrDefaultAsync(x=>x.OrderId==facts.Order.Id&&x.Id==id,ct)??throw Missing();
        return await DetailAsync(facts.Order,row,!customer||row.State is "dispatched"or"delivered",ct);
    }
    public async Task<ParcelCommandResult> ApplyAsync(string actorId,string orderId,ParcelCommandInput supplied,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var actor=OrderInputRules.Identifier(actorId).ToUpperInvariant();var id=ShipmentRules.Uuid(orderId);var input=ParcelRules.Normalize(supplied);var hash=ShipmentRules.Hash(new{OrderId=id,Input=input});
        await OrderV2Locks.OwnerAsync(db,input.OwnerId,ct);await CommandLockAsync(actor,input.CommandId,ct);
        var previous=await db.ParcelCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.CommandId==input.CommandId,ct);
        if(previous is not null){if(previous.ContainsDemo&&!allowDemo)throw Missing();if(previous.OrderId!=id||previous.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This parcel command belongs to another order or body.");return Receipt(previous)with{Replayed=true};}
        var order=await OrderAsync(input.OwnerId,id,ct);var facts=await FactsAsync(order,ct);
        OrderParcel? parcel=null;if(input.ParcelId is not null){parcel=await db.Parcels.SingleOrDefaultAsync(x=>x.Id==input.ParcelId&&x.OrderId==id,ct)??throw Missing();await db.Entry(parcel).ReloadAsync(ct);}
        if(input.OrderVersion!=Version(order.Version)||input.ParcelVersion!=(parcel is null?null:Version(parcel.Version)))throw new BusinessException("version_conflict","The order or parcel changed. Review its current state.");
        if(input.InventoryFingerprint!=facts.Fingerprint)throw ParcelRules.Conflict("inventory","The reviewed inventory, quantities or packing changed.");
        if(order.State is not(OrderState.Paid or OrderState.CreditApproved))throw ParcelRules.Conflict("payment","A paid or independently authorized personal cheque order is required.");
        if(!order.ShippingRequired||!Source(order).Any(x=>!x.IsDigital))throw ParcelRules.Conflict("physical","Physical parcels require a physical order line.");
        CreditDispatchAuthority? authority=null;
        if(order.State==OrderState.CreditApproved&&input.Action is "pack"or"repack"or"dispatch"){
            authority=creditAuthorization is null?null:await creditAuthorization.ReadAuthorityAsync(order.OwnerId,order.Id,ct);
            if(authority is not{Authorized:true,RecordedAt:not null})throw new BusinessException("shipment_credit_clearance_conflict","Finance must review the current evidence before the next warehouse hand-off.");
        }
        var now=clock.GetUtcNow().ToUniversalTime();if(now<order.ChangedAt||facts.Header is not null&&now<facts.Header.ChangedAt)throw ParcelRules.Unavailable();
        var header=await db.FulfillmentHeaders.SingleOrDefaultAsync(x=>x.OrderId==id,ct);
        if(input.Action=="pack"){
            if(facts.Active.Length>=64||facts.Inventory.State!=StockReservationState.Allocated)throw ParcelRules.Conflict("capacity","Void an unshipped parcel or use the remaining permitted capacity.");
            if(header is null){header=new(){OrderId=id,OwnerId=order.OwnerId,ReservationId=order.ReservationId,ReservationContract=order.SnapshotVersion==2?2:1,LastParcelNumber=1,CreatedAt=now,ChangedAt=now,ContainsDemo=order.ContainsDemo};db.FulfillmentHeaders.Add(header);}
            else{if(header.LastParcelNumber==long.MaxValue)throw ParcelRules.Conflict("capacity","The parcel reference capacity has been reached.");header.LastParcelNumber++;}
            parcel=new(){Id=Guid.NewGuid().ToString("N"),OrderId=id,OwnerId=order.OwnerId,ReservationId=order.ReservationId,Number=header.LastParcelNumber,Reference=input.Reference!,PackingFingerprint=facts.Inventory.Fingerprint,PackedAt=now,ChangedAt=now,ContainsDemo=order.ContainsDemo};db.Parcels.Add(parcel);
            await PackAsync(facts,parcel,input.Lines,actor,input.CommandId,ct);
        }else if(input.Action=="repack"){
            if(parcel?.State!="packed"||parcel.PackingRevision>=1000000)throw Stage();
            parcel.PackingRevision++;parcel.PackedAt=now;parcel.ChangedAt=now;parcel.PackingFingerprint=facts.Inventory.Fingerprint;
            await PackAsync(facts,parcel,input.Lines,actor,input.CommandId,ct);
        }else if(input.Action=="void"){
            if(parcel?.State!="packed")throw Stage();parcel.State="void";parcel.VoidedAt=now;parcel.ChangedAt=now;
            await ReleaseClaimsAsync(parcel.Id,ct);
        }else if(input.Action=="dispatch"){
            if(parcel?.State!="packed"||header is null)throw Stage();
            var earliest=authority?.RecordedAt is{}at&&at>parcel.PackedAt?at:parcel.PackedAt;Time(input.OccurredAt!.Value,earliest,now);
            if(parcel.PackingFingerprint!=facts.Inventory.Fingerprint)throw ParcelRules.Conflict("inventory","Reservation facts changed after packing. Explicitly repack this parcel.");
            var detail=await DetailAsync(order,parcel,true,ct);
            var selections=detail.Lines.Select(x=>new PartialDispatchSelection(x.LineKey,x.Quantity,detail.Units.Where(u=>u.LineKey==x.LineKey).Select(u=>u.UnitId).ToArray())).ToArray();
            ValidatePackedUnits(detail,facts.Inventory);
            var request=new PartialDispatchRequest(order.OwnerId,order.ReservationId,parcel.Id,actor,input.CommandId,facts.Inventory.Fingerprint,selections);_=PhysicalPlan(facts,request);
            var result=await inventory.DispatchAsync(request,ct);
            if(result.Replayed||result.ParcelId!=parcel.Id||result.OrderId!=id||result.OwnerId!=order.OwnerId.ToUpperInvariant()||result.RequestId!=input.CommandId||result.ActorId!=actor||result.FingerprintBefore!=facts.Inventory.Fingerprint)throw ParcelRules.Unavailable();
            now=result.RecordedAt;parcel.State="dispatched";parcel.DispatchedAt=input.OccurredAt;parcel.CarrierNameFa=input.CarrierNameFa;parcel.CarrierNameEn=input.CarrierNameEn;parcel.TrackingNumber=input.TrackingNumber;parcel.InventoryDispatchHash=Hash(result);parcel.ChangedAt=now;header.FirstDispatchRecordedAt??=now;
            await ReleaseClaimsAsync(parcel.Id,ct);
        }else{
            if(parcel?.State!="dispatched")throw Stage();Time(input.OccurredAt!.Value,parcel.DispatchedAt!.Value,now);parcel.State="delivered";parcel.DeliveredAt=input.OccurredAt;parcel.ChangedAt=now;
            var all=Source(order).All(line=>line.IsDigital?facts.Digital.Quantity(line.Key)==line.Quantity:facts.Lines.Where(x=>x.Key==line.Key&&facts.Active.Any(p=>p.Id==x.ParcelId&&(p.State=="delivered"||p.Id==parcel.Id))).Sum(x=>(long)x.Quantity)==line.Quantity);
            if(all){if(facts.Inventory.State!=StockReservationState.Fulfilled)throw ParcelRules.Unavailable();order.State=OrderState.Fulfilled;}
        }
        if(parcel is null||header is null)throw ParcelRules.Unavailable();header.ChangedAt=now;db.Entry(header).Property(x=>x.ChangedAt).IsModified=db.Entry(header).State!=EntityState.Added;
        order.ChangedAt=now;db.Entry(order).Property(x=>x.ChangedAt).IsModified=true;order.Events.Add(new(){OrderId=id,State=order.State,ActorId=actor,Reason="parcel_"+input.Action,At=now});
        await db.SaveChangesAsync(ct);
        var response=new ParcelCommandResult(1,input.CommandId,hash,id,input.Action,input.InventoryFingerprint,input.Reason,now,Version(order.Version),await DetailAsync(order,parcel,true,ct),false);
        var json=JsonSerializer.Serialize(response,Json);if(Encoding.UTF8.GetByteCount(json)>ParcelRules.MaxReceiptBytes)throw ParcelRules.Conflict("capacity","The complete immutable receipt exceeds the supported size.");
        db.ParcelCommands.Add(new(){ActorId=actor,CommandId=input.CommandId,OrderId=id,ParcelId=parcel.Id,PackingRevision=parcel.PackingRevision,Action=input.Action,PayloadHash=hash,ResponseHash=HashText(json),ProtectedResult=protection.Protect(actor,id,input.CommandId,json),RecordedAt=now,ContainsDemo=order.ContainsDemo});await db.SaveChangesAsync(ct);return response;
    }
    public async Task<ParcelCommandResult> ReadReceiptAsync(string actorId,string ownerId,string orderId,string commandId,CancellationToken ct)
    {
        var actor=OrderInputRules.Identifier(actorId).ToUpperInvariant();var order=ShipmentRules.Uuid(orderId);var command=ShipmentRules.Uuid(commandId);
        var owner=OrderInputRules.Identifier(ownerId);if(!await db.Orders.AsNoTracking().AnyAsync(x=>x.Id==order&&x.OwnerId==owner,ct))throw Missing();
        var row=await db.ParcelCommands.AsNoTracking().SingleOrDefaultAsync(x=>x.ActorId==actor&&x.OrderId==order&&x.CommandId==command,ct)??throw Missing();if(row.ContainsDemo&&!allowDemo)throw Missing();return Receipt(row)with{Replayed=true};
    }
    private static PartialFulfillmentPlan PhysicalPlan(Facts facts,PartialDispatchRequest request)
    {
        try { return FulfillmentCapacityRules.Plan(facts.Inventory,request,DigitalKeys(facts.Order),false); }
        catch (BusinessException error) when (error.Code is "partial_fulfillment_capacity_unavailable" or "fulfillment_capacity_conflict") {
            // Keep the established parcel HTTP contract for a reviewable selection
            // conflict, including the final shared physical/digital dispatch slot.
            throw ParcelRules.Conflict("capacity","Repack with a selection that leaves enough delivery capacity for every remaining item.");
        }
    }
    private async Task PackAsync(Facts facts,OrderParcel parcel,PartialDispatchSelection[] selections,string actor,string command,CancellationToken ct)
    {
        var plan=PhysicalPlan(facts,new(facts.Order.OwnerId,facts.Order.ReservationId,parcel.Id,actor,command,facts.Inventory.Fingerprint,selections));
        var others=facts.Lines.Where(x=>x.ParcelId!=parcel.Id&&facts.Active.Any(p=>p.Id==x.ParcelId&&p.State=="packed")).ToArray();
        foreach(var line in plan.Lines){var balance=facts.Inventory.Lines.Single(x=>x.LineKey==line.LineKey);if(others.Where(x=>x.Key==line.LineKey).Sum(x=>(long)x.Quantity)+line.Quantity>balance.Remaining)throw ParcelRules.Conflict("quantity","Another packed parcel already contains this reserved quantity.");}
        var unitIds=plan.Lines.SelectMany(x=>x.UnitIds).ToArray();if(facts.Claims.Any(x=>x.ParcelId!=parcel.Id&&unitIds.Contains(x.UnitId)))throw ParcelRules.Conflict("device","A device is already packed in another active parcel.");
        foreach(var line in plan.Lines){var src=Source(facts.Order).Single(x=>x.Key==line.LineKey);db.ParcelLines.Add(new(){ParcelId=parcel.Id,PackingRevision=parcel.PackingRevision,LineKey=src.Key,VariantId=src.VariantId,ProductId=src.ProductId,Sku=src.Sku,Name=src.Name,Label=src.Label,Warranty=src.Warranty,Quantity=line.Quantity,TrackingMode=line.TrackingMode});}
        var claims=await db.ParcelUnitClaims.Where(x=>x.ParcelId==parcel.Id).ToArrayAsync(ct);
        foreach(var old in claims.Where(x=>!unitIds.Contains(x.UnitId)))db.ParcelUnitClaims.Remove(old);
        foreach(var id in unitIds){var u=facts.Inventory.RemainingUnits.Single(x=>x.Id==id);db.ParcelUnits.Add(new(){ParcelId=parcel.Id,PackingRevision=parcel.PackingRevision,UnitId=id,LineKey=u.LineKey,VariantId=u.VariantId,InventoryVersion=u.Version,Serial=u.Serial,Imei1=u.Imei1,Imei2=u.Imei2,WarrantyUntil=u.WarrantyUntil});var claim=claims.SingleOrDefault(x=>x.UnitId==id);if(claim is null)db.ParcelUnitClaims.Add(new(){UnitId=id,ParcelId=parcel.Id,PackingRevision=parcel.PackingRevision,OrderId=facts.Order.Id});else claim.PackingRevision=parcel.PackingRevision;}
    }
    private async Task ReleaseClaimsAsync(string parcel,CancellationToken ct){var claims=await db.ParcelUnitClaims.Where(x=>x.ParcelId==parcel).ToArrayAsync(ct);db.ParcelUnitClaims.RemoveRange(claims);}
    private async Task<SalesOrder> OrderAsync(string ownerId,string orderId,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var owner=OrderInputRules.Identifier(ownerId);var id=ShipmentRules.Uuid(orderId);await OrderV2Locks.OwnerAsync(db,owner,ct);
        var order=await OrderCommandQueries.FindAsync(db,owner,id,ct)??throw Missing();await db.Entry(order).ReloadAsync(ct);if(order.ContainsDemo&&!allowDemo)throw Missing();if(order.SnapshotVersion is not(null or 2))throw new BusinessException("order_contract_upgrade_required","Use the explicit stored order contract.");await OrderCommandQueries.LoadHistoryAsync(db,order,ct);_=Source(order);return order;
    }
    private async Task<Facts> FactsAsync(SalesOrder order,CancellationToken ct)
    {
        if(await db.OrderShipments.AsNoTracking().AnyAsync(x=>x.OrderId==order.Id,ct)||await db.OrderShipmentCommands.AsNoTracking().AnyAsync(x=>x.OrderId==order.Id,ct))throw ParcelRules.Conflict("workflow","This order already uses the complete single-shipment workflow.");
        var header=await db.FulfillmentHeaders.AsNoTracking().SingleOrDefaultAsync(x=>x.OrderId==order.Id,ct);
        var proof=await inventory.ReadRemainingAsync(order.OwnerId,order.ReservationId,ct);var history=await inventory.ReadDispatchHistoryAsync(order.OwnerId,order.ReservationId,ct);
        var digital=await ReadDigitalHistoryAsync(order,history,ct);var source=Source(order);if(proof.OrderId!=order.Id||proof.ReservationId!=order.ReservationId||proof.ReservationContract!=(order.SnapshotVersion==2?2:1)||proof.Lines.Length!=source.Length||source.Any(x=>!proof.Lines.Any(l=>l.LineKey==x.Key&&l.VariantId.Equals(x.VariantId,StringComparison.OrdinalIgnoreCase)&&l.Ordered==x.Quantity)))throw ParcelRules.Unavailable();
        var active=await db.Parcels.AsNoTracking().Where(x=>x.OrderId==order.Id&&x.State!="void").OrderBy(x=>x.Number).Take(65).ToArrayAsync(ct);if(active.Length>64)throw ParcelRules.Unavailable();
        if(header is null&&(active.Length!=0||digital.Manifests.Length!=0||proof.DispatchCount!=0)||header is not null&&(header.OwnerId!=order.OwnerId||header.ReservationId!=order.ReservationId||header.ReservationContract!=proof.ReservationContract||header.ContainsDemo!=order.ContainsDemo))throw ParcelRules.Unavailable();
        var ids=active.Select(x=>x.Id).ToArray();var refs=await db.ParcelLines.AsNoTracking().Where(x=>ids.Contains(x.ParcelId)).Join(db.Parcels.AsNoTracking(),x=>new{Id=x.ParcelId,Revision=x.PackingRevision},p=>new{Id=p.Id,Revision=p.PackingRevision},(x,p)=>new LineRef(x.ParcelId,x.PackingRevision,x.LineKey,x.VariantId,x.Quantity,x.TrackingMode)).Take(4097).ToArrayAsync(ct);
        if(refs.Length>4096||active.Any(p=>!refs.Any(x=>x.ParcelId==p.Id))||refs.Any(x=>!source.Any(s=>!s.IsDigital&&s.Key==x.Key&&s.VariantId.Equals(x.VariantId,StringComparison.OrdinalIgnoreCase)&&x.Quantity>0&&x.Quantity<=s.Quantity)))throw ParcelRules.Unavailable();
        var sent=active.Where(x=>x.State is "dispatched"or"delivered").ToArray();if(sent.Length+digital.Manifests.Length!=proof.DispatchCount||history.Length!=proof.DispatchCount||(header?.FirstDispatchRecordedAt is not null)!=(proof.DispatchCount>0))throw ParcelRules.Unavailable();
        if(history.Length>0&&header?.FirstDispatchRecordedAt!=history[0].RecordedAt)throw ParcelRules.Unavailable();
        foreach(var p in sent){var receipt=history.SingleOrDefault(x=>x.ParcelId==p.Id);if(receipt is null||p.InventoryDispatchHash!=Hash(receipt)||receipt.Lines.Length!=refs.Count(x=>x.ParcelId==p.Id)||receipt.Lines.Any(l=>!refs.Any(x=>x.ParcelId==p.Id&&x.Key==l.LineKey&&x.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&x.Quantity==l.Quantity&&x.TrackingMode==l.TrackingMode)))throw ParcelRules.Unavailable();}
        foreach(var line in proof.Lines){var dispatched=refs.Where(x=>x.Key==line.LineKey&&sent.Any(p=>p.Id==x.ParcelId)).Sum(x=>(long)x.Quantity);var packed=refs.Where(x=>x.Key==line.LineKey&&active.Any(p=>p.Id==x.ParcelId&&p.State=="packed")).Sum(x=>(long)x.Quantity);if(dispatched+digital.Quantity(line.LineKey)!=line.Dispatched||dispatched+digital.Quantity(line.LineKey)+packed>line.Ordered)throw ParcelRules.Unavailable();}
        var claims=await db.ParcelUnitClaims.AsNoTracking().Where(x=>x.OrderId==order.Id).Take(101).ToArrayAsync(ct);if(claims.Length>100||claims.Any(x=>!active.Any(p=>p.Id==x.ParcelId&&p.State=="packed"&&p.PackingRevision==x.PackingRevision)))throw ParcelRules.Unavailable();
        // Claims are checked against immutable snapshots, not mutable Catalog or a client's device IDs.
        foreach(var p in active.Where(x=>x.State=="packed")){var expected=refs.Where(x=>x.ParcelId==p.Id&&x.TrackingMode!="none").Sum(x=>(long)x.Quantity);if(claims.Count(x=>x.ParcelId==p.Id)!=expected)throw ParcelRules.Unavailable();}
        var fingerprint=Hash(new{OrderId=order.Id,OrderVersion=Version(order.Version),HeaderVersion=header is null?null:Version(header.Version),Inventory=proof.Fingerprint,Parcels=active.Select(p=>new{p.Id,p.State,p.PackingRevision,Version=Version(p.Version)}).ToArray()});
        return new(order,header,proof,active,refs,claims,history,fingerprint,digital);
    }
    private static ParcelLineBalance[] Balances(Facts f)=>f.Inventory.Lines.Select(l=>new ParcelLineBalance(l.LineKey,l.VariantId,l.Ordered,f.Lines.Where(x=>x.Key==l.LineKey&&f.Active.Any(p=>p.Id==x.ParcelId&&p.State=="packed")).Sum(x=>x.Quantity),l.Dispatched,f.Lines.Where(x=>x.Key==l.LineKey&&f.Active.Any(p=>p.Id==x.ParcelId&&p.State=="delivered")).Sum(x=>x.Quantity)+f.Digital.Quantity(l.LineKey),l.Remaining)).ToArray();
    private static string[] Blockers(Facts f){var errors=new List<string>();if(f.Order.State is not(OrderState.Paid or OrderState.CreditApproved))errors.Add("payment_not_confirmed");if(!f.Order.ShippingRequired||!Source(f.Order).Any(x=>!x.IsDigital))errors.Add("physical_line_required");if(f.Inventory.State!=StockReservationState.Allocated)errors.Add("reservation_not_allocated");if(f.Active.Length>=64)errors.Add("parcel_capacity_reached");if(f.Inventory.Lines.Any(l=>l.TrackingMode!="none"&&f.Inventory.RemainingUnits.Count(x=>x.LineKey==l.LineKey)!=l.Remaining))errors.Add("complete_serial_assignment_required");return errors.ToArray();}
    private async Task<(ParcelSummary[],string?)> PageAsync(string order,string? after,CancellationToken ct)
    {
        var cursor=ParcelRules.After(after);var n=cursor is null?0:long.Parse(cursor,CultureInfo.InvariantCulture);var page=await db.Parcels.AsNoTracking().Where(x=>x.OrderId==order&&x.Number>n).OrderBy(x=>x.Number).Take(21).ToArrayAsync(ct);var rows=page.Take(20).ToArray();var ids=rows.Select(x=>x.Id).ToArray();
        var refs=await db.ParcelLines.AsNoTracking().Where(x=>ids.Contains(x.ParcelId)).Join(db.Parcels.AsNoTracking(),x=>new{Id=x.ParcelId,Revision=x.PackingRevision},p=>new{Id=p.Id,Revision=p.PackingRevision},(x,p)=>new LineRef(x.ParcelId,x.PackingRevision,x.LineKey,x.VariantId,x.Quantity,x.TrackingMode)).ToArrayAsync(ct);
        return(rows.Select(p=>Summary(p,refs.Where(x=>x.ParcelId==p.Id).Select(x=>new ParcelLineReference(x.Key,x.Quantity)).OrderBy(x=>x.LineKey,StringComparer.Ordinal).ToArray())).ToArray(),page.Length>20?rows[^1].Number.ToString(CultureInfo.InvariantCulture):null);
    }
    private async Task<ParcelDetail> DetailAsync(SalesOrder order,OrderParcel parcel,bool units,CancellationToken ct)
    {
        var lines=await db.ParcelLines.AsNoTracking().Where(x=>x.ParcelId==parcel.Id&&x.PackingRevision==parcel.PackingRevision).OrderBy(x=>x.LineKey).Take(65).ToArrayAsync(ct);var devices=await db.ParcelUnits.AsNoTracking().Where(x=>x.ParcelId==parcel.Id&&x.PackingRevision==parcel.PackingRevision).OrderBy(x=>x.UnitId).Take(101).ToArrayAsync(ct);
        var data=new ParcelDetail(1,order.Id,Summary(parcel,lines.Select(x=>new ParcelLineReference(x.LineKey,x.Quantity)).ToArray()),order.ContainsDemo,true,lines.Select(x=>new ShipmentLineData(x.LineKey,x.VariantId,x.ProductId,x.Sku,x.Name,x.Label,x.Warranty,x.Quantity,x.TrackingMode)).ToArray(),devices.Select(x=>new ShipmentUnitData(x.UnitId,x.LineKey,x.VariantId,x.Serial,x.Imei1,x.Imei2,x.WarrantyUntil)).ToArray());ValidateDetail(data);
        var source=Source(order);if(parcel.OwnerId!=order.OwnerId||parcel.ReservationId!=order.ReservationId||parcel.ContainsDemo!=order.ContainsDemo||data.Lines.Any(l=>!source.Any(s=>s.Key==l.LineKey&&s.VariantId.Equals(l.VariantId,StringComparison.OrdinalIgnoreCase)&&s.ProductId==l.ProductId&&s.Sku==l.Sku&&s.Name==l.Name&&s.Label==l.Label&&s.Warranty==l.Warranty&&l.Quantity<=s.Quantity)))throw ParcelRules.Unavailable();
        if(parcel.State is "dispatched"or"delivered"){
            var receipt=(await inventory.ReadDispatchHistoryAsync(order.OwnerId,order.ReservationId,ct)).SingleOrDefault(x=>x.ParcelId==parcel.Id);
            if(receipt is null||Hash(receipt)!=parcel.InventoryDispatchHash||receipt.Units.Length!=data.Units.Length||receipt.Units.Any(u=>!data.Units.Any(x=>x.UnitId==u.Id&&x.LineKey==u.LineKey&&x.VariantId.Equals(u.VariantId,StringComparison.OrdinalIgnoreCase)&&x.Serial==u.Serial&&x.Imei1==u.Imei1&&x.Imei2==u.Imei2&&x.WarrantyUntil==u.WarrantyUntil)))throw ParcelRules.Unavailable();
        }
        return units?data:data with{UnitDetailsVisible=false,Units=[]};
    }
    private static void ValidatePackedUnits(ParcelDetail detail,PartialFulfillmentView view){foreach(var unit in detail.Units)if(!view.RemainingUnits.Any(x=>x.Id==unit.UnitId&&x.LineKey==unit.LineKey&&x.VariantId.Equals(unit.VariantId,StringComparison.OrdinalIgnoreCase)&&x.Serial==unit.Serial&&x.Imei1==unit.Imei1&&x.Imei2==unit.Imei2&&x.WarrantyUntil==unit.WarrantyUntil))throw ParcelRules.Conflict("inventory","The packed device details changed. Repack explicitly.");}
    private ParcelCommandResult Receipt(OrderParcelCommand row)
    {
        try{var json=protection.Unprotect(row.ActorId,row.OrderId,row.CommandId,row.ProtectedResult);if(Encoding.UTF8.GetByteCount(json)>ParcelRules.MaxReceiptBytes||HashText(json)!=row.ResponseHash)throw ParcelRules.Unavailable();var r=JsonSerializer.Deserialize<ParcelCommandResult>(json,Json)??throw ParcelRules.Unavailable();if(r.SchemaVersion!=1||r.CommandId!=row.CommandId||r.PayloadHash!=row.PayloadHash||r.OrderId!=row.OrderId||r.Action!=row.Action||r.RecordedAt!=row.RecordedAt||r.Replayed||r.Detail.Parcel.Id!=row.ParcelId||r.Detail.Parcel.PackingRevision!=row.PackingRevision||r.Detail.ContainsDemo!=row.ContainsDemo||!r.Detail.UnitDetailsVisible||r.Detail.OrderId!=r.OrderId||r.Detail.Parcel.State!=(r.Action is "pack"or"repack"?"packed":r.Action=="void"?"void":r.Action=="dispatch"?"dispatched":r.Action=="deliver"?"delivered":throw ParcelRules.Unavailable())||r.Reason.Length is<1 or>400||r.Reason.Any(char.IsControl))throw ParcelRules.Unavailable();_=ShipmentRules.Version(r.OrderVersion);_=ShipmentRules.Fingerprint(r.InventoryFingerprint);ValidateDetail(r.Detail);return r;}catch(Exception e)when(e is JsonException or FormatException or NullReferenceException or BusinessException){throw ParcelRules.Unavailable();}
    }
    private static void ValidateDetail(ParcelDetail d){try{ValidateDetailCore(d);}catch(BusinessException){throw ParcelRules.Unavailable();}}
    private static void ValidateDetailCore(ParcelDetail d)
    {
        var p=d.Parcel;_=ShipmentRules.Uuid(d.OrderId);_=ShipmentRules.Uuid(p.Id);_=ShipmentRules.Version(p.Version);_=ParcelRules.After(p.Number);
        if(d.SchemaVersion!=1||p.PackingRevision is<1 or>1000000||p.Reference.Length is<1 or>120||p.Reference.Any(char.IsControl)||p.State is not("packed"or"void"or"dispatched"or"delivered")||d.Lines.Length is<1 or>64||d.Units.Length>100||d.Lines.Select(x=>x.LineKey).Distinct(StringComparer.Ordinal).Count()!=d.Lines.Length||d.Units.Select(x=>x.UnitId).Distinct(StringComparer.Ordinal).Count()!=d.Units.Length||p.Lines.Length!=d.Lines.Length||d.Lines.Any(l=>l.Quantity is<1 or>1000000||l.TrackingMode is not("none"or"serial"or"imei")||!p.Lines.Any(x=>x.LineKey==l.LineKey&&x.Quantity==l.Quantity)))throw ParcelRules.Unavailable();
        foreach(var l in d.Lines)if(d.Units.Count(x=>x.LineKey==l.LineKey)!=(l.TrackingMode=="none"?0:l.Quantity))throw ParcelRules.Unavailable();
        foreach(var u in d.Units){_=ShipmentRules.Uuid(u.UnitId);if(u.Serial is null&&u.Imei1 is null||!d.Lines.Any(l=>l.LineKey==u.LineKey&&l.VariantId.Equals(u.VariantId,StringComparison.OrdinalIgnoreCase)&&l.TrackingMode!="none"))throw ParcelRules.Unavailable();}
        if(p.PackedAt.Offset!=TimeSpan.Zero||p.DispatchedAt is{Offset:var o}&&o!=TimeSpan.Zero||p.DeliveredAt is{Offset:var t}&&t!=TimeSpan.Zero||p.VoidedAt is{Offset:var v}&&v!=TimeSpan.Zero)throw ParcelRules.Unavailable();
        if(p.State is "packed"or"void"){if(p.DispatchedAt is not null||p.DeliveredAt is not null||p.CarrierNameFa is not null||p.CarrierNameEn is not null||p.TrackingNumber is not null||(p.State=="void"?p.VoidedAt is null||p.VoidedAt<p.PackedAt:p.VoidedAt is not null))throw ParcelRules.Unavailable();}
        else if(p.VoidedAt is not null||p.DispatchedAt is null||p.DispatchedAt<p.PackedAt||string.IsNullOrWhiteSpace(p.CarrierNameFa)||string.IsNullOrWhiteSpace(p.CarrierNameEn)||(p.State=="delivered"?p.DeliveredAt is null||p.DeliveredAt<p.DispatchedAt:p.DeliveredAt is not null))throw ParcelRules.Unavailable();
    }
    private static ParcelSummary Summary(OrderParcel p,ParcelLineReference[] refs)=>new(p.Id,p.Number.ToString(CultureInfo.InvariantCulture),p.Reference,p.State,Version(p.Version),p.PackingRevision,p.PackedAt,p.DispatchedAt,p.DeliveredAt,p.VoidedAt,p.CarrierNameFa,p.CarrierNameEn,p.TrackingNumber,refs);
    private static SourceLine[] Source(SalesOrder o){var a=o.SnapshotVersion==2?o.LinesV2.Select(x=>new SourceLine(x.LineId,x.VariantId,x.ProductId,x.Sku,x.Name,x.Label,x.Warranty,x.Quantity,x.IsDigital)).ToArray():o.Lines.Select(x=>new SourceLine(x.VariantId.ToUpperInvariant(),x.VariantId,x.ProductId,x.Sku,x.Name,x.Label,x.Warranty,x.Quantity,x.IsDigital)).ToArray();if(a.Length is<1 or>64||a.Select(x=>x.Key).Distinct(StringComparer.Ordinal).Count()!=a.Length||a.Any(x=>x.Quantity is<1 or>1000000))throw ParcelRules.Unavailable();return a.OrderBy(x=>x.Key,StringComparer.Ordinal).ToArray();}
    private async Task CommandLockAsync(string actor,string command,CancellationToken ct){await using var c=db.Database.GetDbConnection().CreateCommand();c.Transaction=db.Database.CurrentTransaction!.GetDbTransaction();c.CommandTimeout=12;c.CommandText="DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;SELECT @r;";var p=c.CreateParameter();p.ParameterName="@resource";p.Value="sayman:sales:parcel-command:"+HashText(actor+":"+command);c.Parameters.Add(p);if(Convert.ToInt32(await c.ExecuteScalarAsync(ct))<0){await db.Database.CurrentTransaction!.RollbackAsync(CancellationToken.None);throw ParcelRules.Conflict("busy","Retry the same parcel command id.");}}
    private static void Time(DateTimeOffset at,DateTimeOffset earliest,DateTimeOffset now){if(at<earliest||at>now)throw ParcelRules.Conflict("time","Use the actual non-future event time after packing and the current financial authorization.");}
    private static string Version(byte[] v)=>v.Length==8?Convert.ToBase64String(v):throw ParcelRules.Unavailable();
    private static string Hash(object value)=>HashText(JsonSerializer.Serialize(value,Json));
    private static string HashText(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static BusinessException Missing()=>new("not_found","The owned parcel or actor's receipt was not found.");
    private static BusinessException Stage()=>ParcelRules.Conflict("stage","The parcel cannot make this transition from its current stage.");
}

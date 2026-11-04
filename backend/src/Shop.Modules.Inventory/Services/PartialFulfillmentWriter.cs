using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Inventory;

public sealed partial class StockReservationService:IPartialOrderFulfillmentInventory
{
    public async Task<PartialFulfillmentView> ReadRemainingAsync(string ownerId,string reservationId,CancellationToken ct)=>(await ReadPartialFactsAsync(ownerId,reservationId,ct)).View;
    public async Task<PartialDispatchData[]> ReadDispatchHistoryAsync(string ownerId,string reservationId,CancellationToken ct)=>(await ReadPartialFactsAsync(ownerId,reservationId,ct)).History.Select(PartialReceipt).ToArray();
    public async Task<PartialDispatchData> DispatchAsync(PartialDispatchRequest supplied,CancellationToken ct)
    {
        RequireV2Transaction();var input=PartialFulfillmentRules.Normalize(supplied);var payloadHash=PartialHash(input);await LockAsync("partial-dispatch-command",input.ActorId+":"+input.RequestId,ct);
        var previous=await db.PartialDispatches.FromSqlInterpolated($"SELECT * FROM [inventory].[PartialDispatches] WITH (READCOMMITTEDLOCK) WHERE [ActorId]={input.ActorId} AND [RequestId]={input.RequestId}").AsNoTracking().SingleOrDefaultAsync(ct);
        if(previous is not null){if(previous.ContainsDemo&&!allowDemo)throw new BusinessException("not_found","The owned dispatch receipt was not found.");if(previous.PayloadHash!=payloadHash||previous.ReservationId!=input.ReservationId||previous.OwnerId!=input.OwnerId||previous.Id!=input.ParcelId)throw new BusinessException("idempotency_conflict","This partial dispatch request id belongs to another body.");previous.Lines=await db.PartialDispatchLines.AsNoTracking().Where(x=>x.DispatchId==previous.Id).Take(65).ToListAsync(ct);previous.Units=await db.PartialDispatchUnits.AsNoTracking().Where(x=>x.DispatchId==previous.Id).Take(101).ToListAsync(ct);return PartialReceipt(previous)with{Replayed=true};}
        var facts=await ReadPartialFactsAsync(input.OwnerId,input.ReservationId,ct);var plan=PartialFulfillmentRules.Plan(facts.View,input);var row=facts.Reservation;
        if(await db.PartialDispatches.FromSqlInterpolated($"SELECT * FROM [inventory].[PartialDispatches] WITH (READCOMMITTEDLOCK) WHERE [Id]={input.ParcelId}").AsNoTracking().AnyAsync(ct))throw new BusinessException("partial_fulfillment_parcel_conflict","This parcel already has an immutable warehouse dispatch.");
        var selected=plan.Lines.SelectMany(x=>x.UnitIds).ToHashSet(StringComparer.Ordinal);
        if(await db.SerialUnitClaims.AsNoTracking().AnyAsync(x=>selected.Contains(x.UnitId)&&x.IsActive&&x.ReservationId!=row.Id,ct))throw PartialFulfillmentRules.Unavailable();
        var now=clock.GetUtcNow().ToUniversalTime();if(now<row.ChangedAt||facts.History.Length>0&&now<facts.History[^1].RecordedAt)throw PartialFulfillmentRules.Unavailable();
        foreach(var line in plan.Lines)foreach(var id in line.UnitIds){var unit=facts.Units[id];if(unit.State!="assigned"||unit.ReservationId!=row.Id||unit.OrderId!=row.OrderId||(row.ContractVersion==2?unit.OrderLineId!=line.LineKey:unit.OrderLineId is not null))throw PartialFulfillmentRules.Unavailable();unit.State="delivered";unit.ChangedAt=now;db.SerialEvents.Add(new(){UnitId=unit.Id,State=unit.State,ActorId=input.ActorId,OrderId=row.OrderId,At=now,Reason="Order partial fulfillment"});}
        foreach(var claim in facts.Claims.Where(x=>selected.Contains(x.UnitId))){if(claim.State!="Assigned"||claim.IsActive)throw PartialFulfillmentRules.Unavailable();claim.State="Fulfilled";claim.IsActive=false;claim.ChangedAt=now;}
        var movements=new Dictionary<string,StockMovement>(StringComparer.OrdinalIgnoreCase);
        foreach(var movement in plan.Movements){var stock=facts.Stocks[movement.VariantId];if(stock.Reserved<movement.Quantity||stock.OnHand<movement.Quantity)throw PartialFulfillmentRules.Unavailable();stock.Reserved-=movement.Quantity;stock.OnHand-=movement.Quantity;_ = StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved);var entry=new StockMovement{VariantId=stock.VariantId,Delta=-movement.Quantity,Balance=stock.OnHand,ActorId=input.ActorId,At=now,Reason="Order partial fulfillment "+row.OrderId,RequestId=Hash("partial-dispatch:"+row.Id+":"+input.ParcelId+":"+stock.VariantId.ToUpperInvariant())};db.Movements.Add(entry);movements.Add(stock.VariantId,entry);}
        row.ChangedAt=now;db.Entry(row).Property(x=>x.ChangedAt).IsModified=true;if(plan.CompletesReservation){row.State=StockReservationState.Fulfilled;AddEvent(row,input.ActorId);}await db.SaveChangesAsync(ct);
        var head=new PartialInventoryDispatch{Id=input.ParcelId,Sequence=facts.History.Length+1,ReservationId=row.Id,OrderId=row.OrderId,OwnerId=row.OwnerId.ToUpperInvariant(),ActorId=input.ActorId,RequestId=input.RequestId,ReservationContract=row.ContractVersion??1,PayloadHash=payloadHash,FingerprintBefore=input.ExpectedFingerprint,ReservationVersionAfter=Convert.ToBase64String(row.Version),StateAfter=row.State,RecordedAt=now,ContainsDemo=facts.ContainsDemo};
        foreach(var line in plan.Lines)head.Lines.Add(new(){DispatchId=head.Id,LineKey=line.LineKey,VariantId=line.VariantId,Quantity=line.Quantity,TrackingMode=line.TrackingMode,MovementId=movements[line.VariantId].Id});
        foreach(var line in plan.Lines)foreach(var id in line.UnitIds){var unit=facts.Units[id];head.Units.Add(new(){DispatchId=head.Id,ReservationId=row.Id,UnitId=id,LineKey=line.LineKey,VariantId=line.VariantId,InventoryVersion=Convert.ToBase64String(unit.Version),Serial=unit.Serial,Imei1=unit.Imei1,Imei2=unit.Imei2,WarrantyUntil=unit.WarrantyUntil});}
        head.ResponseHash=PartialHash(PartialData(head));db.PartialDispatches.Add(head);await db.SaveChangesAsync(ct);return PartialReceipt(head);
    }
}

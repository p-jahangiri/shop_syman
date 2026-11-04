using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Inventory;

public sealed partial class StockReservationService
{
    private static readonly JsonSerializerOptions PartialJson=new(JsonSerializerDefaults.Web);
    private sealed record PartialFacts(StockReservation Reservation,Dictionary<string,StockItem> Stocks,Dictionary<string,SerialUnit> Units,SerialUnitClaim[] Claims,PartialInventoryDispatch[] History,PartialFulfillmentView View,bool ContainsDemo);
    private static string PartialHash<T>(T value)=>Hash(JsonSerializer.Serialize(value,PartialJson));
    private static PartialDispatchData PartialData(PartialInventoryDispatch row)=>new(1,row.Id,row.Sequence,row.OwnerId,row.ReservationId,row.OrderId,row.ReservationContract,row.ActorId,row.RequestId,row.FingerprintBefore,row.ReservationVersionAfter,row.StateAfter,row.RecordedAt,row.Lines.OrderBy(x=>x.LineKey,StringComparer.Ordinal).Select(x=>new PartialDispatchLineData(x.LineKey,x.VariantId,x.Quantity,x.TrackingMode,x.MovementId.ToString(CultureInfo.InvariantCulture))).ToArray(),row.Units.OrderBy(x=>x.UnitId,StringComparer.Ordinal).Select(x=>new FulfillmentInventoryUnit(x.UnitId,x.LineKey,x.VariantId,x.InventoryVersion,"delivered",x.Serial,x.Imei1,x.Imei2,x.WarrantyUntil)).ToArray(),row.ContainsDemo,false);
    private static PartialDispatchData PartialReceipt(PartialInventoryDispatch row)
    {
        var result=PartialData(row);
        if(row.Lines.Count is<1 or>64||row.Units.Count>100||row.Sequence is<1 or>64||row.ReservationContract is not(1 or 2)||row.RecordedAt.Offset!=TimeSpan.Zero||row.StateAfter is not(StockReservationState.Allocated or StockReservationState.Fulfilled)||row.Lines.Any(l=>l.DispatchId!=row.Id||l.Quantity is<1 or>1000000||l.MovementId<1||l.TrackingMode is not("none"or"serial"or"imei"))||row.Units.Any(u=>u.DispatchId!=row.Id||u.ReservationId!=row.ReservationId||!row.Lines.Any(l=>l.LineKey==u.LineKey&&l.TrackingMode!="none"&&l.VariantId.Equals(u.VariantId,StringComparison.OrdinalIgnoreCase)))||row.Lines.Select(x=>x.LineKey).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=row.Lines.Count||row.Units.Select(x=>x.UnitId).Distinct(StringComparer.Ordinal).Count()!=row.Units.Count)throw PartialFulfillmentRules.Unavailable();
        foreach(var line in row.Lines)if(row.Units.Count(x=>x.LineKey==line.LineKey)!=(line.TrackingMode=="none"?0:line.Quantity))throw PartialFulfillmentRules.Unavailable();
        if(row.ResponseHash!=PartialHash(result))throw PartialFulfillmentRules.Unavailable();return result;
    }
    private async Task<PartialInventoryDispatch[]> PartialHistoryAsync(string reservation,CancellationToken ct)
    {
        var heads=await db.PartialDispatches.FromSqlInterpolated($"SELECT * FROM [inventory].[PartialDispatches] WITH (READCOMMITTEDLOCK) WHERE [ReservationId]={reservation}").AsNoTracking().OrderBy(x=>x.Sequence).Take(65).ToArrayAsync(ct);if(heads.Length>64)throw PartialFulfillmentRules.Unavailable();var ids=heads.Select(x=>x.Id).ToArray();
        var lines=await db.PartialDispatchLines.AsNoTracking().Where(x=>ids.Contains(x.DispatchId)).Take(4097).ToArrayAsync(ct);var units=await db.PartialDispatchUnits.AsNoTracking().Where(x=>ids.Contains(x.DispatchId)).Take(101).ToArrayAsync(ct);if(lines.Length>4096||units.Length>100||units.Select(x=>x.UnitId).Distinct(StringComparer.Ordinal).Count()!=units.Length)throw PartialFulfillmentRules.Unavailable();
        for(var i=0;i<heads.Length;i++){var head=heads[i];head.Lines=lines.Where(x=>x.DispatchId==head.Id).ToList();head.Units=units.Where(x=>x.DispatchId==head.Id).ToList();_ = PartialReceipt(head);if(head.Sequence!=i+1||head.ReservationId!=reservation||i<heads.Length-1&&head.StateAfter!=StockReservationState.Allocated||i>0&&head.RecordedAt<heads[i-1].RecordedAt)throw PartialFulfillmentRules.Unavailable();}
        var movementIds=lines.Select(x=>x.MovementId).Distinct().ToArray();var movements=await db.Movements.AsNoTracking().Where(x=>movementIds.Contains(x.Id)).ToDictionaryAsync(x=>x.Id,ct);
        foreach(var head in heads)foreach(var group in head.Lines.GroupBy(x=>x.VariantId,StringComparer.OrdinalIgnoreCase)){
            var first=group.First();if(group.Any(x=>x.MovementId!=first.MovementId)||!movements.TryGetValue(first.MovementId,out var movement)||!movement.VariantId.Equals(group.Key,StringComparison.OrdinalIgnoreCase)||movement.Delta!=-group.Sum(x=>(long)x.Quantity)||movement.ActorId!=head.ActorId||movement.At!=head.RecordedAt||movement.RequestId!=Hash("partial-dispatch:"+head.ReservationId+":"+head.Id+":"+group.Key.ToUpperInvariant()))throw PartialFulfillmentRules.Unavailable();
        }
        if(lines.GroupBy(x=>x.MovementId).Any(g=>g.Select(x=>x.DispatchId).Distinct().Count()!=1||g.Select(x=>x.VariantId.ToUpperInvariant()).Distinct().Count()!=1))throw PartialFulfillmentRules.Unavailable();return heads;
    }
    private async Task<PartialFacts> ReadPartialFactsAsync(string ownerId,string reservationId,CancellationToken ct)
    {
        RequireV2Transaction();var owner=Identifier(ownerId);var id=Uuid(reservationId);await LockAsync("reservation",id,ct);var row=await LoadAsync(owner,id,ct);
        if(row.ContractVersion is not(null or 2))throw new BusinessException("reservation_contract_upgrade_required","Use the reservation's explicit stored contract.");
        if(row.State is not(StockReservationState.Allocated or StockReservationState.Fulfilled))throw new BusinessException("partial_fulfillment_state_conflict","An allocated or partially fulfilled order is required.");
        if(row.ContractVersion==2){await RequireVisibleV2Async(row,ct);await LoadV2GraphAsync(row,ct);}
        var containsDemo=row.ContractVersion==2&&await db.SourcingAllocationTransfers.AsNoTracking().AnyAsync(x=>x.ReservationId==id&&x.ContainsDemo,ct);
        var stocks=await LockStockAsync(row.Items.Select(x=>x.VariantId),ct);if(stocks.Count!=row.Items.Count)throw PartialFulfillmentRules.Unavailable();var history=await PartialHistoryAsync(id,ct);
        if(history.Any(x=>x.OwnerId!=row.OwnerId.ToUpperInvariant()||x.OrderId!=row.OrderId||x.ReservationContract!=(row.ContractVersion??1)||x.ContainsDemo!=containsDemo)||row.State==StockReservationState.Fulfilled&&history.Length==0)throw new BusinessException("partial_fulfillment_state_conflict","This reservation belongs to another completed fulfillment workflow.");
        var historicalLines=history.SelectMany(x=>x.Lines).ToArray();var historicalUnits=history.SelectMany(x=>x.Units).ToArray();
        var originals=row.ContractVersion==2?row.LineEntitlements.Select(x=>new FulfillmentInventoryLine(x.LineId,x.VariantId,x.Quantity,x.TrackingMode)).ToArray():row.Items.Select(x=>{
            var modes=historicalLines.Where(l=>l.LineKey==x.VariantId.ToUpperInvariant()).Select(l=>l.TrackingMode).Distinct().ToArray();if(modes.Length>1)throw PartialFulfillmentRules.Unavailable();return new FulfillmentInventoryLine(x.VariantId.ToUpperInvariant(),x.VariantId,x.Quantity,modes.SingleOrDefault()??stocks[x.VariantId].TrackingMode);
        }).ToArray();
        if(originals.Length is<1 or>64||originals.Select(x=>x.LineKey).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=originals.Length||historicalLines.Any(x=>!originals.Any(l=>l.LineKey==x.LineKey&&l.VariantId.Equals(x.VariantId,StringComparison.OrdinalIgnoreCase)&&l.TrackingMode==x.TrackingMode)))throw PartialFulfillmentRules.Unavailable();
        var balances=originals.Select(x=>{var sent=historicalLines.Where(l=>l.LineKey==x.LineKey).Sum(l=>(long)l.Quantity);if(sent>x.Quantity||x.Quantity is<1 or>1000000)throw PartialFulfillmentRules.Unavailable();return new PartialFulfillmentBalance(x.LineKey,x.VariantId,x.Quantity,(int)sent,x.Quantity-(int)sent,x.TrackingMode);}).OrderBy(x=>x.LineKey,StringComparer.Ordinal).ToArray();
        var complete=balances.All(x=>x.Remaining==0);if(history.Length==PartialFulfillmentRules.MaxDispatches&&!complete||complete!=(row.State==StockReservationState.Fulfilled)||history.Length>0&&(history[^1].StateAfter!=row.State||history[^1].ReservationVersionAfter!=Convert.ToBase64String(row.Version)))throw PartialFulfillmentRules.Unavailable();
        foreach(var group in balances.GroupBy(x=>x.VariantId,StringComparer.OrdinalIgnoreCase)){var stock=stocks[group.Key];var remaining=group.Sum(x=>(long)x.Remaining);_ = StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved);if(remaining>stock.Reserved||remaining>stock.OnHand||remaining>0&&group.Any(x=>x.TrackingMode!=stock.TrackingMode))throw PartialFulfillmentRules.Unavailable();}
        if(balances.Where(x=>x.TrackingMode!="none").Sum(x=>(long)x.Ordered)>100)throw new BusinessException("partial_fulfillment_capacity_unavailable","This workflow supports at most100 tracked devices per order.");
        var candidates=await db.SerialUnits.AsNoTracking().Where(x=>x.ReservationId==id||x.OrderId==row.OrderId).OrderBy(x=>x.Id).Take(101).ToArrayAsync(ct);var claimCandidates=await db.SerialUnitClaims.AsNoTracking().Where(x=>x.ReservationId==id||x.OrderId==row.OrderId).OrderBy(x=>x.UnitId).Take(101).ToArrayAsync(ct);if(candidates.Length>100||claimCandidates.Length>100)throw PartialFulfillmentRules.Unavailable();
        var units=await LockV2UnitsAsync(candidates.Select(x=>x.Id).Concat(claimCandidates.Select(x=>x.UnitId)),ct);var priorIds=historicalUnits.Select(x=>x.UnitId).ToHashSet(StringComparer.Ordinal);var remainingUnits=units.Values.Where(x=>!priorIds.Contains(x.Id)&&x.ReservationId==id&&x.OrderId==row.OrderId).Select(x=>new FulfillmentInventoryUnit(x.Id,row.ContractVersion==2?x.OrderLineId??"":x.VariantId.ToUpperInvariant(),x.VariantId,Convert.ToBase64String(x.Version),x.State,x.Serial,x.Imei1,x.Imei2,x.WarrantyUntil)).OrderBy(x=>x.Id,StringComparer.Ordinal).ToArray();
        if(remainingUnits.Any(x=>x.State!="assigned"||row.ContractVersion is null&&units[x.Id].OrderLineId is not null||!balances.Any(l=>l.LineKey==x.LineKey&&l.TrackingMode!="none"&&l.VariantId.Equals(x.VariantId,StringComparison.OrdinalIgnoreCase)))||candidates.Any(x=>!priorIds.Contains(x.Id)&&(x.ReservationId!=id||x.OrderId!=row.OrderId))||balances.Any(l=>remainingUnits.Count(x=>x.LineKey==l.LineKey)>l.Remaining))throw PartialFulfillmentRules.Unavailable();
        var claims=new List<SerialUnitClaim>();
        foreach(var candidate in claimCandidates){var claim=await db.SerialUnitClaims.FromSqlInterpolated($"SELECT * FROM [inventory].[SerialUnitClaims] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={candidate.Id}").SingleAsync(ct);await db.Entry(claim).ReloadAsync(ct);var line=row.LineEntitlements.SingleOrDefault(x=>x.LineId==claim.OrderLineId);if(row.ContractVersion!=2||claim.ReservationId!=id||claim.OrderId!=row.OrderId||line is null||line.AllocationId!=claim.OriginAllocationId||line.OfferLineId!=claim.OfferLineId||!line.VariantId.Equals(claim.VariantId,StringComparison.OrdinalIgnoreCase)||!units.TryGetValue(claim.UnitId,out var unit))throw PartialFulfillmentRules.Unavailable();
            if(priorIds.Contains(claim.UnitId)){if(claim.State!="Fulfilled"||claim.IsActive)throw PartialFulfillmentRules.Unavailable();}
            else if(claim.State=="OrderHeld"){if(!claim.IsActive||unit.State!="available"||unit.ReservationId is not null||unit.OrderId is not null||unit.OrderLineId is not null)throw PartialFulfillmentRules.Unavailable();}
            else if(claim.State!="Assigned"||claim.IsActive||unit.State!="assigned"||unit.ReservationId!=id||unit.OrderId!=row.OrderId||unit.OrderLineId!=line.LineId)throw PartialFulfillmentRules.Unavailable();claims.Add(claim);
        }
        if(row.ContractVersion==2&&row.LineEntitlements.Any(l=>claims.Count(c=>c.OrderLineId==l.LineId)!=(l.AllocationId is not null&&l.TrackingMode!="none"?l.Quantity:0)))throw PartialFulfillmentRules.Unavailable();
        var view=new PartialFulfillmentView(1,row.Id,row.OrderId,row.ContractVersion??1,Convert.ToBase64String(row.Version),row.State,history.Length,balances,remainingUnits,"");var fingerprint=PartialHash(new{View=view,History=history.Select(x=>new{x.Id,x.Sequence,x.ResponseHash}).ToArray(),Claims=claims.OrderBy(x=>x.Id,StringComparer.Ordinal).Select(x=>new{x.Id,x.UnitId,x.State,x.IsActive,Version=Convert.ToBase64String(x.Version)}).ToArray()});return new(row,stocks,units,claims.ToArray(),history,view with{Fingerprint=fingerprint},containsDemo);
    }
    internal async Task GuardNoPartialDispatchAsync(string reservationId,CancellationToken ct)
    {
        if(await db.PartialDispatches.FromSqlInterpolated($"SELECT * FROM [inventory].[PartialDispatches] WITH (READCOMMITTEDLOCK) WHERE [ReservationId]={reservationId}").AsNoTracking().AnyAsync(ct))throw new BusinessException("reservation_partial_fulfillment_conflict","Use the explicit remaining-quantity workflow after a partial dispatch.");
    }
}

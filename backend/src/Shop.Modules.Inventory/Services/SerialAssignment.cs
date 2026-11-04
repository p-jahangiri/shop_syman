using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

public sealed partial class SerialInventoryService
{
    private sealed record AssignmentResult(int SchemaVersion,bool Assigned);
    public async Task AssignAsync(StockSerialAssignment request,CancellationToken ct)
    {
        var owner=SerialRules.Identifier(request.OwnerId);var reservationId=SerialRules.Uuid(request.ReservationId);var actor=SerialRules.Identifier(request.ActorId).ToUpperInvariant();var key=SerialRules.Uuid(request.RequestId);
        if(request.Units is null||request.Units.Count is <1 or >SerialRules.BatchSize||request.Units.Any(u=>u is null))throw new BusinessException("invalid_serial_input","Assign 1–100 distinct units from a validated order.");
        var picks=request.Units.Select(p=>new StockSerialPick(SerialRules.Uuid(p.UnitId),SerialRules.Version(p.Version,false)!,p.WarrantyUntil?.ToUniversalTime())).OrderBy(p=>p.UnitId,StringComparer.Ordinal).ToArray();if(picks.Select(p=>p.UnitId).Distinct(StringComparer.Ordinal).Count()!=picks.Length)throw new BusinessException("invalid_serial_input","Serial assignments must be unique.");
        var hash=SerialRules.Hash(new{Kind="assign",Owner=owner.ToUpperInvariant(),Reservation=reservationId,Units=picks});await using var tx=await reservations.BeginAsync(ct);await reservations.LockAsync("reservation",reservationId,ct);var reservation=await reservations.LoadAsync(owner,reservationId,ct);StockReservationService.RequireLegacy(reservation);await reservations.LockAsync("serial-command",actor+":"+key,ct);var replay=await Replay<AssignmentResult>(actor,key,hash,ct);if(replay is not null){if(tx is not null)await tx.CommitAsync(ct);return;}
        await reservations.GuardNoPartialDispatchAsync(reservationId,ct);
        if(reservation.State!=StockReservationState.Allocated)throw new BusinessException("serial_state_conflict","Only an allocated order may receive physical serial assignments.");
        var stock=await reservations.LockStockAsync(reservation.Items.Select(i=>i.VariantId),ct);var ids=picks.Select(p=>p.UnitId).ToArray();var units=await db.SerialUnits.Where(u=>ids.Contains(u.Id)).ToArrayAsync(ct);if(units.Length!=picks.Length)throw new BusinessException("not_found","A serial unit was not found.");foreach(var unit in units)await db.Entry(unit).ReloadAsync(ct);
        foreach(var group in units.GroupBy(u=>u.VariantId,StringComparer.OrdinalIgnoreCase)){
            var line=reservation.Items.SingleOrDefault(i=>i.VariantId.Equals(group.Key,StringComparison.OrdinalIgnoreCase));if(line is null||!stock.TryGetValue(group.Key,out var row)||row.TrackingMode=="none")throw new BusinessException("serial_state_conflict","The unit is not tracked inventory of this order.");
            var assigned=await db.SerialUnits.CountAsync(u=>u.ReservationId==reservationId&&u.VariantId==group.Key&&u.State=="assigned",ct);if(assigned+group.Count()>line.Quantity)throw new BusinessException("serial_state_conflict","Serial assignments exceed the order quantity.");
        }
        if(await HasActiveUnitClaims(ids,ct))throw new BusinessException("serial_state_conflict","A selected physical unit has an active sourcing claim and cannot be assigned through an ordinary order.");
        var pickMap=picks.ToDictionary(p=>p.UnitId,StringComparer.Ordinal);foreach(var unit in units){SerialRules.MatchVersion(unit.Version,pickMap[unit.Id].Version);if(unit.State!="available")throw new BusinessException("serial_state_conflict","The selected unit is no longer available.");unit.State="assigned";unit.ReservationId=reservation.Id;unit.OrderId=reservation.OrderId;unit.WarrantyUntil=pickMap[unit.Id].WarrantyUntil;unit.ChangedAt=clock.GetUtcNow();AddEvent(unit,actor,"Order assignment");}
        await db.SaveChangesAsync(ct);await Remember(actor,key,hash,new AssignmentResult(1,true),ct);if(tx is not null)await tx.CommitAsync(ct);
    }
}

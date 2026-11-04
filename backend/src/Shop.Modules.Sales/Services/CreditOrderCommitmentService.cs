using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed class CreditOrderCommitmentService(SalesDbContext db,ICreditOrderScheduleSource source,IStockReservations legacy,IStockOrderReservationsV2 versioned,TimeProvider clock,IPartialOrderFulfillmentInventory partial):ICreditOrderCommitments
{
    private async Task<SalesOrder> Order(string owner,string id,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);await OrderV2Locks.OwnerAsync(db,owner,ct);var s=await source.LockAndReadAsync(owner,id,ct);var row=await OrderCommandQueries.FindAsync(db,s.OwnerId,id,ct)??throw Missing();await db.Entry(row).ReloadAsync(ct);return row;
    }
    public async Task<CreditOrderCommitmentState> ReadAsync(string owner,string order,CancellationToken ct)
    {
        var o=await Order(owner,order,ct);var hold=o.SnapshotVersion==2?(await versioned.ReadAsync(o.OwnerId,o.ReservationId,ct)).State:(await legacy.ReadAsync(o.OwnerId,o.ReservationId,ct)).State;var shipment=await db.OrderShipments.AsNoTracking().Where(x=>x.OrderId==o.Id).Select(x=>x.State).SingleOrDefaultAsync(ct);var header=await db.FulfillmentHeaders.AsNoTracking().SingleOrDefaultAsync(x=>x.OrderId==o.Id,ct);var remainingPartial=false;
        if(header is not null){if(shipment is not null||header.ReservationId!=o.ReservationId||!header.OwnerId.Equals(o.OwnerId,StringComparison.OrdinalIgnoreCase)||header.ReservationContract!=(o.SnapshotVersion==2?2:1))throw Conflict();var proof=await partial.ReadRemainingAsync(o.OwnerId,o.ReservationId,ct);var dispatched=await db.Parcels.AsNoTracking().CountAsync(x=>x.OrderId==o.Id&&(x.State=="dispatched"||x.State=="delivered"),ct);dispatched+=await db.DigitalDeliveries.AsNoTracking().CountAsync(x=>x.OrderId==o.Id,ct);if(dispatched!=proof.DispatchCount||(header.FirstDispatchRecordedAt is not null)!=(dispatched>0))throw Conflict();shipment=dispatched>0?(o.State==OrderState.Fulfilled?"delivered":"dispatched"):await db.Parcels.AnyAsync(x=>x.OrderId==o.Id&&x.State=="packed",ct)?"packed":null;remainingPartial=dispatched>0&&hold==StockReservationState.Allocated&&proof.Lines.Any(x=>x.Remaining>0);}
        return new(o.Id,Convert.ToBase64String(o.Version),(o.State==OrderState.AwaitingPayment&&o.ExpiresAt<=clock.GetUtcNow()?OrderState.Expired:o.State).ToString(),hold.ToString(),shipment,remainingPartial);
    }
    public async Task<CreditOrderCommitmentState> CommitAsync(CreditOrderCommitmentProof p,CancellationToken ct)
    {
        var o=await Order(p.OwnerId,p.OrderId,ct);var s=await source.LockAndReadAsync(p.OwnerId,p.OrderId,ct);var now=clock.GetUtcNow();if(p.OrderVersion!=Convert.ToBase64String(o.Version)||p.QuoteFingerprint!=s.QuoteFingerprint||p.PayableTotalRial!=o.PayableTotalRial||p.AuthorizedAt<o.CreatedAt||p.AuthorizedAt>now)throw Conflict();var status=await ReadAsync(o.OwnerId,o.Id,ct);
        if(status.ShipmentState is not(null or"packed")&&!status.HasRemainingPartialDispatch)throw Conflict();if(o.State==OrderState.CreditApproved){if(status.ReservationState!="Allocated")throw Conflict();return status;}
        if(o.State!=OrderState.AwaitingPayment||o.ExpiresAt<=now||status.ReservationState!="Active")throw Conflict();var allocated=o.SnapshotVersion==2?(await versioned.AllocateAsync(o.OwnerId,o.ReservationId,p.ActorId,ct)).State:(await legacy.AllocateAsync(o.OwnerId,o.ReservationId,p.ActorId,ct)).State;if(allocated!=StockReservationState.Allocated||o.ExpiresAt<=clock.GetUtcNow())throw Conflict();
        o.State=OrderState.CreditApproved;o.ChangedAt=clock.GetUtcNow();o.Events.Add(new(){OrderId=o.Id,State=o.State,ActorId=OrderInputRules.Identifier(p.ActorId),Reason="credit_financially_approved",At=o.ChangedAt});await db.SaveChangesAsync(ct);return await ReadAsync(o.OwnerId,o.Id,ct);
    }
    private static BusinessException Missing()=>new("not_found","The owned credit order was not found.");
    private static BusinessException Conflict()=>new("credit_commitment_changed_conflict","The original order, deadline, reservation or shipment changed.");
}

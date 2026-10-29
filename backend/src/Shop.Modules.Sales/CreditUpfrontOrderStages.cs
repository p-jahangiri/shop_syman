using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;
namespace Shop.Modules.Sales;
public sealed class SalesCreditUpfrontOrderStages(SalesDbContext db,ICreditOrderScheduleSource source):ICreditUpfrontOrderStages
{
    public async Task<CreditUpfrontOrderStage> ReadAsync(string owner,string order,CancellationToken ct)
    {
        CartOfferRules.RequireParent(db);var s=await source.LockAndReadAsync(owner,order,ct);
        var shipment=await db.OrderShipments.FromSqlInterpolated($"SELECT * FROM [sales].[OrderShipments] WITH (READCOMMITTEDLOCK) WHERE [OrderId]={order}").AsNoTracking().Select(x=>x.State).SingleOrDefaultAsync(ct);
        var header=await db.FulfillmentHeaders.AsNoTracking().SingleOrDefaultAsync(x=>x.OrderId==order,ct);
        if(header is not null){var reservation=await db.Orders.Where(x=>x.Id==order&&x.OwnerId==owner).Select(x=>x.ReservationId).SingleOrDefaultAsync(ct);if(shipment is not null||header.ReservationId!=reservation||!header.OwnerId.Equals(owner,StringComparison.OrdinalIgnoreCase))throw new BusinessException("credit_upfront_unavailable","The selected fulfillment identity could not be verified.");shipment=header.FirstDispatchRecordedAt is not null?(s.State=="Fulfilled"?"delivered":"dispatched"):await db.Parcels.AnyAsync(x=>x.OrderId==order&&x.State=="packed",ct)?"packed":null;}
        if(shipment is not(null or"packed"or"dispatched"or"delivered"))throw new BusinessException("credit_upfront_unavailable","The owned shipment stage could not be verified.");
        return new(s.OrderId,s.OrderVersion,s.State,shipment);
    }
}

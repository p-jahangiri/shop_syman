using Microsoft.EntityFrameworkCore;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

internal static class SourcingOfferLifecycle
{
    // Call only after the SAME request application lock used by both services.
    internal static async Task BeforeParentCloseAsync(MarketDbContext db,string requestId,string actor,string kind,string reason,DateTimeOffset now,CancellationToken ct)
    {
        var active=await db.SourcingOffers.SingleOrDefaultAsync(o=>o.RequestId==requestId&&o.IsActive,ct);if(active is null)return;
        if(SourcingOfferRules.AcceptedBlocks(active.State,active.IsActive,active.PurchaseUntil,now))throw new BusinessException("sourcing_offer_accepted_conflict","An accepted offer remains valid. The request cannot be closed until the purchase deadline or a future explicit supply-cancellation flow.");
        active.IsActive=false;
        if(active.State=="Published"&&active.AcceptUntil>now){var before=active.State;active.State="Withdrawn";active.ChangedAt=now;db.SourcingOfferEvents.Add(new(){OfferId=active.Id,Revision=active.Revision,ActorId=actor,ActorKind=kind,StateBefore=before,StateAfter=active.State,ReasonCode=reason,IsPublic=true,At=now});}
    }
}

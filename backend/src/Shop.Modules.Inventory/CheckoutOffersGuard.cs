using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

// Unlike the conversion guard, this calculation-only batch deliberately owns
// every allocation domain before reading any Stock. It never reads Market,
// Sales, physical device identifiers or claims, and never changes an entity.
public sealed class CheckoutOffersGuard(InventoryDbContext db,StockReservationService reservations,TimeProvider clock,bool allowDemo):IInventoryCheckoutOffers
{
    public async Task<SourcingCheckoutInventoryProof> AssertAsync(string ownerId,SourcingCheckoutAllocationRequest[] requests,SourcingCheckoutOrdinaryLine[] ordinary,CancellationToken ct)
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)
            throw new InvalidOperationException("Checkout offer assertions require the root Serializable transaction and all preceding Agreement locks.");
        var owner=SourcingAllocationRules.Actor(ownerId);
        requests=SourcingCheckoutInventoryRules.NormalizeAllocations(owner,requests,allowDemo);
        ordinary=SourcingCheckoutInventoryRules.NormalizeOrdinary(ordinary);
        SourcingCheckoutInventoryRules.ValidateWholeCart(requests,ordinary);

        // Acquire complete domains first, rather than interleaving a single
        // allocation assertion with Stock reads from another group.
        foreach(var request in requests)
            await reservations.LockAsync("sourcing-allocation-acceptance",request.Plan.AcceptanceId,ct);
        foreach(var id in requests.Select(r=>r.AllocationId).OrderBy(id=>id,StringComparer.Ordinal))
            await reservations.LockAsync("sourcing-allocation-resource",id,ct);

        var rows=new List<SourcingStockAllocation>(requests.Length);
        foreach(var request in requests)
        {
            var id=request.AllocationId;
            var row=await db.Set<SourcingStockAllocation>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={id} AND [OwnerId]={owner}").AsNoTracking().SingleOrDefaultAsync(a=>allowDemo||!a.ContainsDemo,ct)??throw Missing();
            if(Convert.ToBase64String(row.Version)!=request.Version)throw new BusinessException("version_conflict","The sourcing allocation changed. Refresh before calculating its quote.");
            row.Lines=await db.Set<SourcingStockAllocationLine>().AsNoTracking().Where(l=>l.AllocationId==id).OrderBy(l=>l.OfferLineId).Take(65).ToListAsync(ct);
            var proof=Project(row);
            SourcingStockConversionRules.ValidateCoverage(request.Plan,proof,clock.GetUtcNow());
            rows.Add(row);
        }

        // LockStockAsync uses the same canonical order as allocation, release,
        // adjustment and reservation writers. Distinct first: the ordinary
        // lane and several accepted groups may legitimately share one SKU.
        var ids=ordinary.Select(l=>l.VariantId).Concat(rows.SelectMany(r=>r.Lines).Select(l=>l.VariantId)).Distinct(StringComparer.OrdinalIgnoreCase);
        var stocks=await reservations.LockStockAsync(ids,ct);
        SourcingCheckoutInventoryRules.ValidateHeldStock(rows,stocks);
        var available=new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase);
        foreach(var line in ordinary)
            available.Add(line.VariantId,stocks.TryGetValue(line.VariantId,out var stock)?StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved):0);

        // Lock waits must not preserve a deadline that has already passed.
        // Quote creation checks its own clock again immediately before save.
        var now=clock.GetUtcNow();
        var proofs=rows.Select(Project).ToArray();
        for(var i=0;i<requests.Length;i++)SourcingStockConversionRules.ValidateCoverage(requests[i].Plan,proofs[i],now);
        return new(proofs,available);
    }

    private static SourcingStockConversionProof Project(SourcingStockAllocation row)
    {
        if(row.State!="Active"||!row.IsActive||row.ExpiresAt.Offset!=TimeSpan.Zero||row.ExpiresAt<=row.CreatedAt||row.ChangedAt<row.CreatedAt||row.Lines.Count is <1 or >64||row.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=row.Lines.Count||row.Lines.Any(l=>l.Quantity is <1 or >1000000||l.TrackingMode is not ("none" or "serial" or "imei"))||row.Lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase).Any(g=>g.Sum(l=>(long)l.Quantity)>1000000))
            throw new BusinessException("sourcing_allocation_checkout_conflict","A current complete active allocation is required to calculate an accepted quote.");
        return new(row.Id,row.RequestId,row.TaskId,row.OfferId,row.AcceptanceId,row.TermsHash,SourcingAllocationRules.Version(Convert.ToBase64String(row.Version)),row.ExpiresAt,row.ContainsDemo,row.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingAllocationSummaryLine(l.OfferLineId,l.VariantId,l.Quantity)).ToArray());
    }

    private static BusinessException Missing()=>new("not_found","The owned sourcing allocation was not found.");
}

public static class SourcingCheckoutInventoryRules
{
    public static SourcingCheckoutAllocationRequest[] NormalizeAllocations(string owner,SourcingCheckoutAllocationRequest[] requests,bool allowDemo)
    {
        owner=SourcingAllocationRules.Actor(owner);
        if(requests is null||requests.Length>64||requests.Any(r=>r is null))throw Invalid();
        var normalized=requests.Select(r=>new SourcingCheckoutAllocationRequest(SourcingAllocationRules.NormalizePlan(r.Plan),SourcingAllocationRules.Id(r.AllocationId),SourcingAllocationRules.Version(r.Version))).OrderBy(r=>r.Plan.AcceptanceId,StringComparer.Ordinal).ToArray();
        if(normalized.Any(r=>r.Plan.OwnerId!=owner||r.Plan.ContainsDemo&&!allowDemo))throw new BusinessException("not_found","The owned sourcing allocation was not found.");
        if(normalized.Select(r=>r.Plan.AcceptanceId).Distinct(StringComparer.Ordinal).Count()!=normalized.Length||normalized.Select(r=>r.AllocationId).Distinct(StringComparer.Ordinal).Count()!=normalized.Length)throw Invalid();
        return normalized;
    }

    public static SourcingCheckoutOrdinaryLine[] NormalizeOrdinary(SourcingCheckoutOrdinaryLine[] ordinary)
    {
        if(ordinary is null||ordinary.Length>64||ordinary.Any(l=>l is null))throw Invalid();
        var normalized=ordinary.Select(l=>new SourcingCheckoutOrdinaryLine(SourcingReceivingRules.Identifier(l.VariantId).ToUpperInvariant(),l.Quantity)).OrderBy(l=>l.VariantId,StringComparer.Ordinal).ToArray();
        if(normalized.Any(l=>l.Quantity is <1 or >1000000)||normalized.Select(l=>l.VariantId).Distinct(StringComparer.Ordinal).Count()!=normalized.Length)throw Invalid();
        return normalized;
    }

    public static void ValidateWholeCart(SourcingCheckoutAllocationRequest[] requests,SourcingCheckoutOrdinaryLine[] ordinary)
    {
        if(requests.Sum(r=>(long)r.Plan.Lines.Length)+ordinary.Length>64)throw Invalid();
        var quantities=ordinary.Select(l=>new{l.VariantId,l.Quantity}).Concat(requests.SelectMany(r=>r.Plan.Lines).Select(l=>new{l.VariantId,l.Quantity}));
        if(quantities.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase).Any(g=>g.Sum(l=>(long)l.Quantity)>1000000))throw Invalid();
    }

    // A hold does not need any public availability. Its own aggregate must be
    // backed by SourcingReserved, with the same immutable physical mode.
    public static void ValidateHeldStock(IReadOnlyCollection<SourcingStockAllocation> allocations,IReadOnlyDictionary<string,StockItem> stocks)
    {
        foreach(var group in allocations.SelectMany(a=>a.Lines).GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase))
        {
            if(!stocks.TryGetValue(group.Key,out var stock)||group.Any(l=>l.TrackingMode!=stock.TrackingMode)||stock.SourcingReserved<group.Sum(l=>(long)l.Quantity))throw new BusinessException("sourcing_allocation_checkout_conflict","The complete accepted allocation is not backed by its existing held Stock.");
            _=StockAvailability.Available(stock.OnHand,stock.Reserved,stock.SourcingReserved);
        }
    }

    private static BusinessException Invalid()=>new("invalid_sourcing_checkout_inventory","Use complete distinct accepted allocations and bounded ordinary demands from one whole cart.");
}

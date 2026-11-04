using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Inventory;

// Cart conversion proves an existing owned hold. It never changes physical
// Stock, claims, deadlines, or the allocation's immutable origin.
public sealed class SourcingConversionGuard(InventoryDbContext db,StockReservationService reservations,TimeProvider clock,bool allowDemo):IInventorySourcingConversionGuard
{
    private IQueryable<SourcingStockAllocation> Rows(string owner)=>db.Set<SourcingStockAllocation>().Where(a=>a.OwnerId==owner&&(allowDemo||!a.ContainsDemo));
    private static string Version(byte[] value)=>Convert.ToBase64String(value);
    private void RequireTransaction()
    {
        if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Sourcing conversion guards require the root Serializable transaction shared with Market, Sales and audit.");
    }
    public async Task<SourcingStockConversionProof?> ReadActiveAsync(string ownerId,string acceptanceId,CancellationToken ct)
    {
        var owner=SourcingAllocationRules.Actor(ownerId);acceptanceId=SourcingAllocationRules.Id(acceptanceId);
        var row=await Rows(owner).AsNoTracking().Include(a=>a.Lines.OrderBy(l=>l.OfferLineId).Take(65)).AsSplitQuery().SingleOrDefaultAsync(a=>a.AcceptanceId==acceptanceId&&a.IsActive,ct);
        if(row is null)return null;
        var proof=Project(row);
        var current=await Rows(owner).AsNoTracking().Where(a=>a.Id==row.Id).Select(a=>new{a.Version,a.IsActive}).SingleOrDefaultAsync(ct);
        if(current is null||!current.IsActive||!current.Version.SequenceEqual(row.Version))throw Changed();
        // An expired but unreleased hold remains an honest read. The server
        // assertion below, and the candidate's clock, reject fresh conversion.
        return proof;
    }
    public async Task<SourcingStockConversionProof> AssertAsync(string ownerId,SourcingStockAllocationPlan supplied,string allocationId,string expectedVersion,CancellationToken ct)
    {
        RequireTransaction();var owner=SourcingAllocationRules.Actor(ownerId);var plan=SourcingAllocationRules.NormalizePlan(supplied);allocationId=SourcingAllocationRules.Id(allocationId);expectedVersion=SourcingAllocationRules.Version(expectedVersion);
        if(plan.OwnerId!=owner||plan.ContainsDemo&&!allowDemo)throw Missing();
        // These are the same locks used by allocation/release/expiry. No Market,
        // cart, Agreement, Stock or unit lock may be acquired after this guard.
        await reservations.LockAsync("sourcing-allocation-acceptance",plan.AcceptanceId,ct);
        await reservations.LockAsync("sourcing-allocation-resource",allocationId,ct);
        var row=await db.Set<SourcingStockAllocation>().FromSqlInterpolated($"SELECT * FROM [inventory].[SourcingAllocations] WITH (UPDLOCK,HOLDLOCK) WHERE [Id]={allocationId} AND [OwnerId]={owner}").AsNoTracking().SingleOrDefaultAsync(a=>allowDemo||!a.ContainsDemo,ct)??throw Missing();
        if(Version(row.Version)!=expectedVersion)throw Changed();
        row.Lines=await db.Set<SourcingStockAllocationLine>().AsNoTracking().Where(l=>l.AllocationId==allocationId).OrderBy(l=>l.OfferLineId).Take(65).ToListAsync(ct);
        if(!row.IsActive||row.State!="Active")throw new BusinessException("sourcing_allocation_conversion_conflict","A current active owned stock allocation is required for conversion.");
        var proof=Project(row);SourcingStockConversionRules.ValidateCoverage(plan,proof,clock.GetUtcNow());return proof;
    }
    private static SourcingStockConversionProof Project(SourcingStockAllocation row)
    {
        if(row.State!="Active"||!row.IsActive||row.ExpiresAt.Offset!=TimeSpan.Zero||row.ExpiresAt<=row.CreatedAt||row.ChangedAt<row.CreatedAt||row.Lines.Count is <1 or >64||row.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=row.Lines.Count||row.Lines.Any(l=>l.Quantity is <1 or >1000000||l.TrackingMode is not ("none" or "serial" or "imei"))||row.Lines.GroupBy(l=>l.VariantId,StringComparer.OrdinalIgnoreCase).Any(g=>g.Sum(l=>(long)l.Quantity)>1000000))throw new BusinessException("sourcing_allocation_capacity_unavailable","The allocation graph exceeds its supported bounds.");
        return new(row.Id,row.RequestId,row.TaskId,row.OfferId,row.AcceptanceId,row.TermsHash,SourcingAllocationRules.Version(Version(row.Version)),row.ExpiresAt,row.ContainsDemo,row.Lines.OrderBy(l=>l.OfferLineId,StringComparer.Ordinal).Select(l=>new SourcingAllocationSummaryLine(l.OfferLineId,l.VariantId,l.Quantity)).ToArray());
    }
    private static BusinessException Missing()=>new("not_found","The owned sourcing allocation was not found.");
    private static BusinessException Changed()=>new("version_conflict","The sourcing allocation changed. Refresh before converting the accepted offer.");
}

public static class SourcingStockConversionRules
{
    public static void ValidateCoverage(SourcingStockAllocationPlan supplied,SourcingStockConversionProof proof,DateTimeOffset now)
    {
        var plan=SourcingAllocationRules.NormalizePlan(supplied);
        if(proof is null||proof.Lines is not {Length:>0 and <=64}||proof.Lines.Any(l=>l is null)||proof.Lines.Select(l=>l.OfferLineId).Distinct(StringComparer.Ordinal).Count()!=proof.Lines.Length)throw Conflict();
        SourcingAllocationRules.Id(proof.AllocationId);SourcingAllocationRules.Version(proof.Version);
        if(proof.RequestId!=plan.RequestId||proof.TaskId!=plan.TaskId||proof.OfferId!=plan.OfferId||proof.AcceptanceId!=plan.AcceptanceId||proof.TermsHash!=plan.TermsHash||proof.IsDemo!=plan.ContainsDemo||proof.Lines.Length!=plan.Lines.Length)throw Conflict();
        var lines=proof.Lines.ToDictionary(l=>l.OfferLineId,StringComparer.Ordinal);
        foreach(var line in plan.Lines)if(!lines.TryGetValue(line.OfferLineId,out var held)||!line.VariantId.Equals(held.VariantId,StringComparison.OrdinalIgnoreCase)||line.Quantity!=held.Quantity)throw Conflict();
        SourcingAllocationRules.ValidateDeadline(proof.ExpiresAt,plan.PurchaseUntil,now);
    }
    private static BusinessException Conflict()=>new("sourcing_allocation_conversion_conflict","Conversion requires the exact complete owned allocation for these accepted terms.");
}

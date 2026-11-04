namespace Shop.SharedKernel;

// This is an internal, price-free assertion built from the complete immutable
// Sales agreements. Browser input never supplies these plans or quantities.
public sealed record SourcingCheckoutAllocationRequest(SourcingStockAllocationPlan Plan,string AllocationId,string Version);
public sealed record SourcingCheckoutOrdinaryLine(string VariantId,int Quantity);
public sealed record SourcingCheckoutInventoryProof(SourcingStockConversionProof[] Allocations,IReadOnlyDictionary<string,int> OrdinaryAvailable);

public interface IInventoryCheckoutOffers
{
    // The caller owns the root Serializable transaction, cart lock, and every
    // Agreement lock in AcceptanceId order before invoking this batch. It has
    // not read Stock, claims or units. Pass every ordinary demand, preserving
    // the current cart's Stock checks for both physical and digital SKUs.
    // The batch owns all allocation locks before taking sorted Stock locks.
    // It only observes existing holds; it does not reserve, release or extend.
    Task<SourcingCheckoutInventoryProof> AssertAsync(string ownerId,SourcingCheckoutAllocationRequest[] requests,SourcingCheckoutOrdinaryLine[] ordinary,CancellationToken ct);
}

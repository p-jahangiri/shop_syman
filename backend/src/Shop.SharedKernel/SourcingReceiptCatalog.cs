namespace Shop.SharedKernel;

// Physical receiving checks identity, not public sale eligibility. A hidden or
// inactive SKU can arrive physically; it still cannot be allocated or sold just
// because it was received. The composition root calls this inside its unit of work.
public sealed record SourcingReceiptSkuIdentity(string VariantId,string ProductId,bool IsDigital);
public interface ISourcingReceiptCatalogReader
{
    Task<IReadOnlyDictionary<string,SourcingReceiptSkuIdentity>> ReadAsync(string[] variantIds,CancellationToken ct);
}
public static class SourcingReceiptCatalogRules
{
    public static string[] Ids(string[] ids)
    {
        if(ids is null||ids.Length>64||ids.Any(id=>string.IsNullOrEmpty(id)||id.Length>64||id.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))||ids.Distinct(StringComparer.OrdinalIgnoreCase).Count()!=ids.Length)
            throw new BusinessException("invalid_receiving_catalog","Read up to 64 distinct physical SKU identities.");
        return ids;
    }
    public static void AssertPlan(SourcingReceivingPlan plan,IReadOnlyDictionary<string,SourcingReceiptSkuIdentity> current)
    {
        if(plan.Lines.Length is <1 or >64||plan.Lines.Any(line=>!current.TryGetValue(line.VariantId,out var sku)||sku.IsDigital||!string.Equals(sku.ProductId,line.ProductId,StringComparison.OrdinalIgnoreCase)))
            throw new BusinessException("receiving_catalog_conflict","An actual physical SKU of the accepted model is required for receiving.");
    }
    public static SourcingReceivingPlan ForReceipt(SourcingReceivingPlan plan,string[] offerLineIds)
    {
        var selected=offerLineIds.Distinct(StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
        var lines=plan.Lines.Where(line=>selected.Contains(line.OfferLineId)).ToArray();
        if(selected.Count==0||lines.Length!=selected.Count)
            throw new BusinessException("receiving_line_conflict","Every actual receipt line must belong to this accepted task.");
        return plan with{Lines=lines};
    }
    public static void AssertPhysical(string variantId,IReadOnlyDictionary<string,SourcingReceiptSkuIdentity> current)
    {
        if(!current.TryGetValue(variantId,out var sku)||sku.IsDigital)
            throw new BusinessException("receiving_catalog_conflict","An actual physical SKU is required for a receiving-unit mapping.");
    }
}

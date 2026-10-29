namespace Shop.SharedKernel;

public sealed record CheckoutVariantData(CartCatalogVariant Variant, string Sku, string SellerId, string Warranty, string PriceVersion, string[] ProductMethodIds, string[]? VariantMethodIds, string[] ChequePlanIds,UsedItemConditionData? UsedCondition=null);
public interface ICheckoutCatalogReader
{
    Task<IReadOnlyDictionary<string, CheckoutVariantData>> ReadCheckoutVariantsAsync(string locale, IReadOnlyCollection<string> variantIds, CancellationToken ct);
}

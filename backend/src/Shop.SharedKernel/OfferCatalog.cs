using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

// A sourcing offer describes an actual physical SKU. It does not assert that
// stock exists or authorize its allocation, payment, or a public price change.
public sealed record OfferModelSnapshot(string Id,string Slug,string CategoryId,string CategoryNameFa,string CategoryNameEn,string BrandId,string Brand,string NameFa,string NameEn,string DescriptionFa,string DescriptionEn,string[] Images,SourcingAttributeSnapshot[] Attributes);
public sealed record OfferSkuSnapshot(string VariantId,string ProductId,string SellerId,string Sku,OfferModelSnapshot Model,string LabelFa,string LabelEn,string Color,string ColorNameFa,string ColorNameEn,string WarrantyFa,string WarrantyEn,SourcingAttributeSnapshot[] Attributes,string[] ProductMethodIds,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string[]? VariantMethodIds,string[] ChequePlanIds,string PublicPriceRial,string Version,string CurrentFingerprint,string MaterialFingerprint);
public sealed record OfferSkuChoice(string VariantId,string ProductId,string Sku,string LabelFa,string LabelEn,string Color,string ColorNameFa,string ColorNameEn,string WarrantyFa,string WarrantyEn,string PublicPriceRial,string Version);
public sealed record OfferSkuPage(int SchemaVersion,int PageSize,OfferSkuChoice[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public interface ICatalogOfferReader
{
    Task<IReadOnlyDictionary<string,OfferSkuSnapshot>> ReadAsync(string[] variantIds,CancellationToken ct);
    Task<OfferSkuPage> LookupAsync(string modelId,string? query,string? cursor,CancellationToken ct);
}

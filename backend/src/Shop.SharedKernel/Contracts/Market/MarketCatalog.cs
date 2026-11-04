using System.Text.Json.Serialization;
namespace Shop.SharedKernel;

// Internal, read-only SQL contract owned and migrated by Catalog. Being present
// here is NOT public publication: Market must explicitly publish its listing.
public sealed class CatalogMarketModelV1
{
    public string ModelId { get; set; } = "";
    public string Slug { get; set; } = "";
    public string CategoryId { get; set; } = "";
    public string BrandId { get; set; } = "";
    public string Brand { get; set; } = "";
    public string NameFa { get; set; } = "";
    public string NameEn { get; set; } = "";
    public string SearchFa { get; set; } = "";
    public string SearchEn { get; set; } = "";
    public bool IsEligible { get; set; }
    public bool HasAvailableStoreOffer { get; set; }
    public byte[] Version { get; set; } = [];
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ModelTranslationInput(string Locale,string Name,string Description);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ModelAttributeInput(string AttributeId,string? TextFa=null,string? TextEn=null,[property:JsonNumberHandling(JsonNumberHandling.AllowReadingFromString|JsonNumberHandling.WriteAsString)]decimal? Number=null,bool? Bool=null,string? OptionId=null,string[]? OptionIds=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CatalogModelInput(string CategoryId,string BrandId,string Slug,ModelTranslationInput[] Translations,ModelAttributeInput[] Attributes,string[] ImageUrls,string? Version);
public sealed record CatalogModelDto(string Id,string Slug,string CategoryId,string BrandId,string Brand,string Name,string EnglishName,string Description,string Image,string[] Images,Dictionary<string,string> Attributes);
public sealed record CatalogModelRead(CatalogModelDto Model,string Version);
public sealed record CatalogModelEditable(CatalogModelInput Input,string StorefrontStatus,bool HasOffers);
public interface IMarketModelCatalog
{
    Task<CatalogModelEditable> ReadEditableAsync(string id,CancellationToken ct);
    Task<Dictionary<string,string>> ResolveAttributeKeysAsync(string[] keys,CancellationToken ct);
    Task<string> ValidateAsync(string? id,CatalogModelInput input,bool publishInMarket,CancellationToken ct);
    Task<string> SaveAsync(string? id,CatalogModelInput input,string actorId,CancellationToken ct);
    Task<CatalogModelRead[]> ReadCandidatesAsync(string locale,string[] ids,CancellationToken ct);
}

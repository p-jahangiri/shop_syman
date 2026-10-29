using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

public sealed record SourcingOptionSnapshot(string Id,string LabelFa,string LabelEn);
public sealed record SourcingAttributeSnapshot(string AttributeId,string Key,string DataType,string LabelFa,string LabelEn,string? Unit,string? UnitFa,string? UnitEn,string? TextFa,string? TextEn,[property:JsonNumberHandling(JsonNumberHandling.WriteAsString|JsonNumberHandling.AllowReadingFromString)]decimal? Number,bool? Bool,SourcingOptionSnapshot[] Options);
public sealed record SourcingModelSnapshot(string Id,string Slug,string CategoryId,string CategoryNameFa,string CategoryNameEn,string BrandId,string Brand,string NameFa,string NameEn,string DescriptionFa,string DescriptionEn,string[] Images,string Version,string Fingerprint,bool HasAvailableStoreOffer,SourcingAttributeSnapshot[] Attributes);
public interface ICatalogSourcingReader
{
    Task<IReadOnlyDictionary<string,SourcingModelSnapshot>> ReadAsync(string[] modelIds,CancellationToken ct);
}
public sealed record SourcingCandidate(string ListingId,SourcingModelSnapshot? Model,string? Fingerprint,string? SourceNameFa,string? SourceNameEn,string? SourceUrl,string? Availability,DateTimeOffset? ObservedAt,DateTimeOffset? ValidUntil,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ReferencePriceRial,bool ReferencePriceCurrent,bool IsDemo,string? Issue)
{
    [JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]public PhoneConfigurationSnapshot? Configuration{get;init;}
}
public interface IMarketSourcingReader
{
    Task<IReadOnlyDictionary<string,SourcingCandidate>> ReadAsync(string locale,string[] listingIds,CancellationToken ct);
    Task<IReadOnlyDictionary<string,SourcingCandidate>> ReadConfiguredAsync(string locale,string[] listingIds,IReadOnlyDictionary<string,string> configurations,CancellationToken ct)=>configurations.Count==0?ReadAsync(locale,listingIds,ct):throw new BusinessException("phone_discovery_unavailable","Configured phone selection is unavailable.");
}
public sealed record SourcingCartSelection(string ListingId,int Quantity)
{
    [JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]public string? ConfigurationId{get;init;}
}
public sealed record SourcingCartContents(string? CartId,string? Version,SourcingCartSelection[] Lines);
public interface ISourcingCart
{
    // Both methods require the root Serializable transaction and use the same
    // cart lock/version as normal purchases. Only sourcing selections are consumed.
    Task<SourcingCartContents> ReadForSubmissionAsync(string ownerId,CancellationToken ct);
    Task ConsumeSourcingAsync(string ownerId,string version,CancellationToken ct);
}
public interface ISourcingNoteProtection
{
    string Protect(string ownerId,string requestId,string note);
    string Unprotect(string ownerId,string requestId,string protectedNote);
}

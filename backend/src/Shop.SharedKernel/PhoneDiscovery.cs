using System.Text.Json.Serialization;

namespace Shop.SharedKernel;

// A requested phone configuration is a choice of specifications, not a SKU,
// stock assertion, price agreement or permission to take payment.
public sealed record PhoneConfigurationSnapshot(string Id,string ModelId,int RamGb,int StorageGb,string ColorKey,string ColorNameFa,string ColorNameEn,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ColorHex,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ImageUrl,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? LinkedVariantId,string Version,string Fingerprint);
public sealed record PhoneConfigurationSelection(PhoneConfigurationSnapshot Configuration,bool AvailableInStore,string? StoreSlug);
public interface IPhoneConfigurationReader
{
    Task<IReadOnlyDictionary<string,PhoneConfigurationSelection>> ReadSelectionsAsync(string locale,IReadOnlyDictionary<string,string> selections,CancellationToken ct);
}

// Notifications owns the inbox. No source observation, reference price,
// customer contact details or message text crosses this contract.
public sealed record PhoneDiscoveryNotificationEvent(string Id,string OwnerId,string Kind,string ListingId,string ConfigurationId,string? RequestId,string? OfferId,string? StoreSlug,string? VariantId,DateTimeOffset At);
public interface IPhoneDiscoveryNotificationWriter
{
    Task RecordAsync(PhoneDiscoveryNotificationEvent value,CancellationToken ct);
}

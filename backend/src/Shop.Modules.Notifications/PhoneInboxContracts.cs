using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Shop.SharedKernel;

namespace Shop.Modules.Notifications;

public sealed record PhoneInboxData(string Id,string Sequence,string Kind,string ListingId,string ConfigurationId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? RequestId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? OfferId,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? StoreSlug,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? VariantId,
    DateTimeOffset At,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ReadAt);
public sealed record PhoneInboxPage(int SchemaVersion,bool UnreadOnly,PhoneInboxData[] Items,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record PhoneInboxReadResult(int SchemaVersion,PhoneInboxData Notification);
public interface IPhoneInboxProtection
{
    byte[] Protect(string owner,string id,string text);
    string Unprotect(string owner,string id,byte[] value);
}

public static class PhoneInboxRules
{
    public static readonly string[] Kinds=["phone_available","sourcing_offer_published"];
    public static PhoneDiscoveryNotificationEvent Normalize(PhoneDiscoveryNotificationEvent value)
    {
        if(value is null)throw NotificationRules.Invalid();
        var normalized=value with{OwnerId=NotificationRules.Owner(value.OwnerId)};
        Validate(normalized);return normalized;
    }
    public static void Validate(PhoneDiscoveryNotificationEvent value)
    {
        if(value is null)throw NotificationRules.Invalid();
        foreach(var id in new[]{value.Id,value.ListingId,value.ConfigurationId})NotificationRules.Id(id);
        if(value.OwnerId!=NotificationRules.Owner(value.OwnerId)||value.At.Offset!=TimeSpan.Zero||!Kinds.Contains(value.Kind,StringComparer.Ordinal))throw NotificationRules.Invalid();
        if(value.RequestId is{}request)NotificationRules.Id(request);
        if(value.OfferId is{}offer)NotificationRules.Id(offer);
        if(value.StoreSlug is{}slug&&(slug.Length>180||!Regex.IsMatch(slug,"^[a-z0-9]+(?:-[a-z0-9]+)*$",RegexOptions.CultureInvariant)))throw NotificationRules.Invalid();
        if(value.VariantId is{}variant&&(variant.Length is<1 or>64||variant.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_'))))throw NotificationRules.Invalid();
        if((value.StoreSlug is null)!=(value.VariantId is null))throw NotificationRules.Invalid();
        if(value.Kind=="phone_available"&&(value.RequestId is not null||value.OfferId is not null||value.StoreSlug is null))throw NotificationRules.Invalid();
        if(value.Kind=="sourcing_offer_published"&&(value.RequestId is null||value.OfferId is null))throw NotificationRules.Invalid();
    }
    // Reuse the established bounded cursor codec with a separate family scope.
    // A support/credit cursor cannot be used against the phone discovery feed.
    private static string ScopeOwner(string owner)=>"PHONE_"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(NotificationRules.Owner(owner))))[..48];
    public static string Cursor(long before,string owner,bool unreadOnly)=>NotificationRules.Cursor(before,ScopeOwner(owner),unreadOnly);
    public static long Before(string? cursor,string owner,bool unreadOnly)=>NotificationRules.Before(cursor,ScopeOwner(owner),unreadOnly);
    public static string Sequence(long value)=>value>0?value.ToString(CultureInfo.InvariantCulture):throw NotificationRules.Unavailable();
}

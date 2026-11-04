using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingExpectedInput(string ListingId,string Fingerprint);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingSubmitInput(string RequestId,string CartVersion,SourcingExpectedInput[] Expected,string? Note=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingActionInput(string RequestId,string Version);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingUnavailableInput(string RequestId,string Version,string ReasonCode,string PublicMessage);
public sealed record SourcingMutationResult(int SchemaVersion,string Id,string Reference,string State,string Version,string EventId,DateTimeOffset At,bool Replayed,bool RequestOnly=true,bool CanPay=false);
public sealed record SourcingRequestSummary(string Id,string Reference,string Locale,string State,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,int ItemCount,int LineCount,string Version,bool IsDemo,[property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]string? OwnerId=null);
public sealed record SourcingRequestLineData(string ListingId,int Quantity,SourcingModelSnapshot Model,string SourceNameFa,string SourceNameEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceUrl,string Availability,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ObservedAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ValidUntil,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ReferencePriceRial,bool ReferencePriceCurrent,bool IsDemo)
{
    [JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]public PhoneConfigurationSnapshot? Configuration{get;init;}
}
public sealed record SourcingRequestDetail(int SchemaVersion,SourcingRequestSummary Summary,string Note,SourcingRequestLineData[] Lines,bool CanCancel,bool CanReview,bool CanMarkUnavailable,bool RequestOnly=true,bool CanPay=false);
public sealed record SourcingRequestPage(int SchemaVersion,int PageSize,SourcingRequestSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record SourcingRequestEventData(string Id,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? StateBefore,string StateAfter,string ActorKind,string ReasonCode,string PublicMessage,DateTimeOffset At);
public sealed record SourcingRequestEventPage(int SchemaVersion,int PageSize,SourcingRequestEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record SourcingRequestOptions(int MaxOpenRequestsPerOwner=20);

public static class SourcingRules
{
    public static readonly string[] States=["Submitted","Reviewing","Unavailable","Cancelled"];
    public static string Id(string? value)=>value is {Length:32}&&value.All(char.IsAsciiHexDigit)&&Guid.TryParseExact(value,"N",out var id)&&id!=Guid.Empty?id.ToString("N"):throw Invalid();
    public static string CommandId(string? value)=>Guid.TryParseExact(value,"D",out var id)&&id!=Guid.Empty?id.ToString("N"):value is {Length:32}?Id(value):throw Invalid();
    public static string Actor(string? value)=>value is {Length:>0 and <=64}&&value.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_')?value:throw Invalid();
    public static string Version(string? value){try{if(value is not {Length:12}||Convert.FromBase64String(value).Length!=8||Convert.ToBase64String(Convert.FromBase64String(value))!=value)throw Invalid();return value;}catch(FormatException){throw Invalid();}}
    public static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Fingerprint(string? value)=>value is {Length:64}&&value.All(c=>c is >= '0' and <= '9' or >= 'A' and <= 'F')?value:throw Invalid();
    public static string Locale(string? locale)=>locale is "fa" or "en"?locale:throw Invalid();
    public static string Text(string? value,int max,bool required=false)
    {
        string text;try{text=(value??"").Replace("\r\n","\n").Replace('\r','\n').Normalize(NormalizationForm.FormKC).Trim();}catch(ArgumentException){throw Invalid();}
        if(text.Length>max||required&&text.Length==0||text.Any(c=>char.IsControl(c)&&c!='\n'))throw Invalid();return text;
    }
    public static string Reason(string? value)=>value is {Length:>0 and <=64}&&value.All(c=>c is >= 'a' and <= 'z' or '_')?value:throw Invalid();
    public static long? ReferencePrice(string? value)=>value is null?null:value.Length is >0 and <=19&&value.All(char.IsAsciiDigit)&&long.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var price)&&price>0?price:throw Invalid();
    public static SourcingSubmitInput Normalize(SourcingSubmitInput input)
    {
        if(input.Expected is not {Length:>0 and <=24}||input.Expected.Any(x=>x is null))throw Invalid();
        var expected=input.Expected.Select(e=>new SourcingExpectedInput(Id(e.ListingId),Fingerprint(e.Fingerprint))).OrderBy(e=>e.ListingId,StringComparer.Ordinal).ToArray();
        if(expected.Select(e=>e.ListingId).Distinct(StringComparer.Ordinal).Count()!=expected.Length)throw Invalid();
        return new(CommandId(input.RequestId),Version(input.CartVersion),expected,Text(input.Note,500));
    }
    public static string Payload(object value)=>Hash(JsonSerializer.Serialize(value));
    private static BusinessException Invalid()=>new("invalid_sourcing_input","Use a supported locale, bounded request fields, unique listing ids, a UUID command id and the current version/fingerprints.");
}

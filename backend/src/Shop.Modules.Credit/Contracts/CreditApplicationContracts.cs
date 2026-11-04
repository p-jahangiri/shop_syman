using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;
namespace Shop.Modules.Credit;

public interface ICreditApplicationProtection
{
    byte[] Protect(string applicationId,string kind,string recordId,string text);
    string Unprotect(string applicationId,string kind,string recordId,byte[] bytes);
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateCreditApplicationInput(string PlanId,string PlanVersion,string RequestedAmountRial,string Locale);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CancelCreditApplicationInput(string Version);
public sealed record CreditApplicationPlan(string Id,string Version,string NameFa,string NameEn,int Months,int MarkupBasisPoints,int DownPaymentBasisPoints,int IntervalMonths,string RoundingUnitRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? MinAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? MaxAmountRial,string[] CategoryIds);
public sealed record CreditApplicationSummary(string Id,string PlanId,string RequestedAmountRial,string Locale,string State,string Version,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt);
public sealed record CreditApplicationPage(int SchemaVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? State,CreditApplicationSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record CreditApplicationDetail(int SchemaVersion,CreditApplicationSummary Application,CreditApplicationPlan Plan,bool CanSubmit,string[] Blockers);
public sealed record CreditApplicationResult(int SchemaVersion,bool Replayed,string CommandId,CreditApplicationSummary Application);
public sealed record CreditApplicationPlanOption(string Id,string Version,string NameFa,string NameEn,int Months,int MarkupBasisPoints,int DownPaymentBasisPoints,int IntervalMonths,string RoundingUnitRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? MinAmountRial,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? MaxAmountRial,int CategoryCount);
public sealed record CreditApplicationPlans(int SchemaVersion,CreditApplicationPlanOption[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);

public static class CreditApplicationRules
{
    public static BusinessException Invalid()=>new("invalid_credit_application","Credit application input, version or cursor is invalid.");
    public static BusinessException Immutable()=>new("credit_application_history_immutable","Credit application identity, terms and history cannot be changed or deleted.");
    public static BusinessException Missing()=>new("not_found","Credit application not found.");
    public static BusinessException Unavailable()=>new("credit_application_unavailable","The private credit application could not be read safely.");
    public static string Id(string value){if(value is null||!Guid.TryParseExact(value,"N",out var id)||id==Guid.Empty||value!=id.ToString("N"))throw Invalid();return value;}
    public static string Key(string value){if(string.IsNullOrWhiteSpace(value)||value.Length>64||value!=value.Trim()||value.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-' or '_')))throw Invalid();return value;}
    public static string Actor(string value)=>Key(value).ToUpperInvariant();
    public static string Locale(string value)=>value is "fa" or "en"?value:throw Invalid();
    public static string? State(string? value)=>value is null or "Draft" or "Submitted" or "Cancelled" or "Approved" or "Declined"?value:throw Invalid();
    public static long Amount(string value){if(value is null||value.Length is <1 or >19||!long.TryParse(value,NumberStyles.None,CultureInfo.InvariantCulture,out var amount)||amount<=0||amount.ToString(CultureInfo.InvariantCulture)!=value)throw Invalid();return amount;}
    public static void Version(string value){try{if(value is null||value.Length!=12||Convert.FromBase64String(value).Length!=8||Convert.ToBase64String(Convert.FromBase64String(value))!=value)throw Invalid();}catch(FormatException){throw Invalid();}}
    public static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static void Digest(string value){if(value is null||value.Length!=64||value.Any(c=>!char.IsAsciiDigit(c)&&c is not(>='A'and<='F')))throw Invalid();}
    public static long Cursor(string? value,string scope){if(value is null)return long.MaxValue;try{if(value.Length>180)throw Invalid();var bytes=Convert.FromBase64String(value);if(Convert.ToBase64String(bytes)!=value)throw Invalid();var parts=new UTF8Encoding(false,true).GetString(bytes).Split(':');if(parts.Length!=3||parts[0]!="1"||parts[1]!=Hash(scope))throw Invalid();return Amount(parts[2]);}catch(Exception e)when(e is FormatException or DecoderFallbackException){throw Invalid();}}
    public static string Cursor(long value,string scope)=>Convert.ToBase64String(Encoding.UTF8.GetBytes("1:"+Hash(scope)+":"+Amount(value.ToString(CultureInfo.InvariantCulture)).ToString(CultureInfo.InvariantCulture)));
}

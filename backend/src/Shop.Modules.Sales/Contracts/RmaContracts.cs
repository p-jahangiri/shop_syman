using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

public interface IRmaProtection
{
    byte[] Protect(string purpose,string principal,string id,string text);
    string Unprotect(string purpose,string principal,string id,byte[] value);
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RmaPolicyInput([property:JsonRequired]string? Version,[property:JsonRequired]bool Enabled,[property:JsonRequired]bool PhysicalReturns,[property:JsonRequired]bool DigitalComplaints,
    string ConditionsFa,string ConditionsEn,string WindowMode,[property:JsonRequired]int? WindowDays,
    [property:JsonRequired]int? MaxOpenPerOwner,string Note,bool Confirmed);
public sealed record RmaPolicyData(string Id,int Revision,string Version,bool Enabled,bool PhysicalReturns,bool DigitalComplaints,
    string ConditionsFa,string ConditionsEn,string WindowMode,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? WindowDays,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? MaxOpenPerOwner,DateTimeOffset At);
public sealed record RmaPolicyCurrent(int SchemaVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]RmaPolicyData? Current,
    bool CanRefund=false,string RefundAvailability="provider_unconfigured");
public sealed record RmaPublicPolicyData(int SchemaVersion,bool Configured,bool Enabled,bool PhysicalReturns,bool DigitalComplaints,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ConditionsFa,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? ConditionsEn,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? WindowMode,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? WindowDays,
    bool CanRefund=false,string RefundAvailability="provider_unconfigured");
public sealed record RmaPolicyHistory(int SchemaVersion,RmaPolicyData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]int? NextBefore);
public sealed record RmaPolicyResult(int SchemaVersion,string CommandId,bool Replayed,RmaPolicyCurrent Policy);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RmaLineSelection(string LineKey,int Quantity);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CreateRmaInput(string PolicyRevisionId,string OrderVersion,string Kind,RmaLineSelection[] Lines,string Reason,bool AcknowledgeNoFinancialAction);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WithdrawRmaInput(string Version,string Reason,bool Confirmed);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReviewRmaInput(string OwnerId,string Version,string Action,[property:JsonRequired]string? Outcome,string Note,
    [property:JsonRequired]string? CustomerMessage,bool AcknowledgeNoFinancialAction);
public sealed record RmaOrderLineData(string LineKey,string VariantId,string Sku,string Name,string Label,bool IsDigital,int OrderedQuantity,
    int HandedOffOrAvailableQuantity,int RequestableQuantity);
public sealed record RmaOrderContext(int SchemaVersion,string OrderId,int OriginalSnapshotVersion,string OrderVersion,string OrderState,
    string SnapshotHash,RmaPolicyCurrent Policy,RmaOrderLineData[] Lines,bool CanRequest,string[] Blockers,
    bool CanRefund=false,bool CanRestock=false,bool CanReship=false);
public sealed record RmaSummary(string Id,string Reference,string OrderId,string Locale,string Kind,string State,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Outcome,bool IsOpen,string Version,int ItemCount,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]string? OwnerId=null);
public sealed record RmaLineData(string LineKey,string VariantId,string Sku,string Name,string Label,bool IsDigital,int OrderedQuantity,int Quantity,
    int HandedOffOrAvailableQuantity);
public sealed record RmaEventData(string Sequence,string Action,string State,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Outcome,
    string Author,DateTimeOffset At,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Message,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]string? StaffNote=null);
public sealed record RmaDetail(int SchemaVersion,RmaSummary Case,int OriginalSnapshotVersion,string SnapshotHash,RmaPolicyData Policy,
    string Reason,RmaLineData[] Lines,RmaEventData[] Events,bool CanWithdraw,
    bool CanRefund=false,string RefundAvailability="provider_unconfigured",bool CanReceive=false,bool CanRestock=false,bool CanReship=false);
public sealed record RmaPage(int SchemaVersion,RmaSummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record RmaCommandResult(int SchemaVersion,string CommandId,string PayloadHash,bool Replayed,RmaDetail Case);

public static class RmaRules
{
    // Structural bounds, not an invented commercial deadline or request quota.
    public const int MaxRevisions=10000,MaxLines=64,MaxEvents=1000,MaxProtectedBytes=2097152;
    public static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,
        RespectRequiredConstructorParameters=true,RespectNullableAnnotations=true,MaxDepth=32};
    public static BusinessException Invalid()=>new("invalid_rma","Provide exact bounded return-request fields, versions and explicit confirmation.");
    public static BusinessException Missing()=>new("rma_not_found","The return request or owned order was not found.");
    public static BusinessException Unavailable()=>new("rma_unavailable","The retained return request could not be verified safely.");
    public static BusinessException Conflict(string reason)=>new("rma_"+reason+"_conflict","Review the current return-request facts before retrying.");
    public static BusinessException Immutable()=>new("rma_history_immutable","Return-request policy revisions, source lines, events and command receipts are immutable.");
    public static string Actor(string x)=>OrderInputRules.Identifier(x).ToUpperInvariant();
    public static string Id(string x){try{return ShipmentRules.Uuid(x);}catch(BusinessException){throw Invalid();}}
    public static string Version(string x){try{return ShipmentRules.Version(x);}catch(BusinessException){throw Invalid();}}
    public static string Hash(string x)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(x)));
    public static string Serialize<T>(T x)=>JsonSerializer.Serialize(x,Json);
    public static string Locale(string x)=>x is "fa" or "en"?x:throw Invalid();
    public static string Text(string x,int max,bool required=true)
    {
        if(x is null||x.Length>max)throw Invalid();var text=x.Replace("\r\n","\n",StringComparison.Ordinal).Replace('\r','\n').Trim();
        if(required&&text.Length==0||text.Any(c=>char.IsControl(c)&&c is not('\n'or'\t')||c is '\u202a'or'\u202b'or'\u202c'or'\u202d'or'\u202e'or'\u2066'or'\u2067'or'\u2068'or'\u2069'))throw Invalid();
        try{_=new UTF8Encoding(false,true).GetByteCount(text);}catch(EncoderFallbackException){throw Invalid();}return text;
    }
    public static RmaPolicyInput Normalize(RmaPolicyInput x)
    {
        if(x is null||!x.Confirmed||x.WindowMode is not("manualReview"or"deliveryDays")
            ||(x.WindowMode=="manualReview"?x.WindowDays is not null:x.WindowDays is not(>=1 and<=3650))
            ||x.MaxOpenPerOwner is not(null or >=1 and<=10000)||x.Enabled&&!x.PhysicalReturns&&!x.DigitalComplaints)throw Invalid();
        if(x.Version is{}v)Version(v);
        return x with{ConditionsFa=Text(x.ConditionsFa,4000),ConditionsEn=Text(x.ConditionsEn,4000),Note=Text(x.Note,1000)};
    }
    public static CreateRmaInput Normalize(CreateRmaInput x)
    {
        if(x is null||!x.AcknowledgeNoFinancialAction||x.Kind is not("physicalReturn"or"digitalComplaint")
            ||x.Lines is null||x.Lines.Length is<1 or>MaxLines||x.Lines.Any(l=>l is null||l.LineKey is not{Length:>0 and<=64}
                ||l.LineKey.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_'))||l.Quantity is<1 or>1000000)
            ||x.Lines.Select(l=>l.LineKey).Distinct(StringComparer.Ordinal).Count()!=x.Lines.Length)throw Invalid();
        return x with{PolicyRevisionId=Id(x.PolicyRevisionId),OrderVersion=Version(x.OrderVersion),Reason=Text(x.Reason,4000),
            Lines=x.Lines.OrderBy(l=>l.LineKey,StringComparer.Ordinal).ToArray()};
    }
    public static ReviewRmaInput Normalize(ReviewRmaInput x)
    {
        if(x is null||!x.AcknowledgeNoFinancialAction||x.Action is not("startReview"or"completeReview")
            ||(x.Action=="startReview"?x.Outcome is not null:x.Outcome is not("followUp"or"declined")))throw Invalid();
        return x with{OwnerId=OrderInputRules.Identifier(x.OwnerId),Version=Version(x.Version),Note=Text(x.Note,4000),
            CustomerMessage=x.CustomerMessage is null?null:Text(x.CustomerMessage,2000)};
    }
    public static bool WithinWindow(string mode,int? days,DateTimeOffset? deliveredAt,DateTimeOffset now)
        =>mode=="manualReview"?days is null:mode=="deliveryDays"&&days is>=1 and<=3650&&deliveredAt is{}at&&at<=now&&now-at<=TimeSpan.FromDays(days.Value);
    public static long Cursor(string? value,string scope)
    {
        if(value is null)return long.MaxValue;
        try{if(value.Length>180)throw Invalid();var bytes=Convert.FromBase64String(value);if(Convert.ToBase64String(bytes)!=value)throw Invalid();
            var pieces=new UTF8Encoding(false,true).GetString(bytes).Split(':');if(pieces.Length!=3||pieces[0]!="1"||pieces[1]!=Hash(scope)
                ||!long.TryParse(pieces[2],NumberStyles.None,CultureInfo.InvariantCulture,out var n)||n<1||n.ToString(CultureInfo.InvariantCulture)!=pieces[2])throw Invalid();return n;
        }catch(Exception e)when(e is FormatException or DecoderFallbackException){throw Invalid();}
    }
    public static string Cursor(long n,string scope)=>n>0?Convert.ToBase64String(Encoding.UTF8.GetBytes("1:"+Hash(scope)+":"+n.ToString(CultureInfo.InvariantCulture))):throw Unavailable();
}

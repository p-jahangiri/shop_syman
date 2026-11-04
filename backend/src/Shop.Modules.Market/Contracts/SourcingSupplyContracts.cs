using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingSupplyStartInput(string RequestId,string RequestVersion,string OfferVersion,string TermsHash);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingSupplySourceInput(string RequestId,string RequestVersion,string TaskVersion,string SourceKind,string SourceKey,string SourceNameFa,string SourceNameEn,string? Reference,DateTimeOffset ActionAt,string PublicMessageFa,string PublicMessageEn,DateTimeOffset? ExpectedAt,string? InternalNote=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingSupplyProgressInput(string RequestId,string RequestVersion,string TaskVersion,DateTimeOffset ActionAt,string PublicMessageFa,string PublicMessageEn,DateTimeOffset? ExpectedAt,string? InternalNote=null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SourcingSupplyCloseInput(string RequestId,string RequestVersion,string TaskVersion,string ReasonCode,string PublicMessageFa,string PublicMessageEn,string? InternalNote=null);

public sealed record SourcingSupplySummary(string Id,string OfferId,string AcceptanceId,string State,string ReceiptProgress,string EffectiveState,string Version,int LineCount,int RequiredQuantity,int ReceivedQuantity,int RemainingQuantity,DateTimeOffset CreatedAt,DateTimeOffset ChangedAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ExpectedAt,DateTimeOffset PurchaseUntil,bool IsOpen,bool RequiresNewOffer,bool IsDemo);
public sealed record SourcingSupplyLineData(string OfferLineId,string VariantId,string Sku,string NameFa,string NameEn,string LabelFa,string LabelEn,int RequiredQuantity,int ReceivedQuantity,int RemainingQuantity);
public sealed record SourcingSupplyCustomerDetail(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary Task,SourcingSupplyLineData[] Lines,string PublicMessageFa,string PublicMessageEn,bool ReservedForRequest=false,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingSupplyAdminDetail(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary Task,SourcingSupplyLineData[] Lines,string PublicMessageFa,string PublicMessageEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceKind,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceKey,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceNameFa,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceNameEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Reference,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ActionAt,string InternalNote,bool CanRecordSource,bool CanProgress,bool CanCancel,bool CanFail,bool ReservedForRequest=false,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingSupplyStartCandidate(string OfferId,string AcceptanceId,string OfferVersion,string TermsHash,DateTimeOffset PurchaseUntil);
public sealed record SourcingSupplyPage(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,int PageSize,SourcingSupplySummary[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]SourcingSupplyStartCandidate? StartCandidate=null,bool ReservedForRequest=false,bool CanCheckout=false,bool CanPay=false);

// Inventory staff never receive account identity, negotiated prices, supplier
// actions or protected notes. Stock mode/version are added by the root reader.
public sealed record SourcingSupplyInventoryLine(string OfferLineId,string VariantId,string ProductId,string Sku,string NameFa,string NameEn,string LabelFa,string LabelEn,int RequiredQuantity,int ReceivedQuantity,int RemainingQuantity);
public sealed record SourcingSupplyInventoryDetail(int SchemaVersion,string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary Task,SourcingSupplyInventoryLine[] Lines,bool CanReceive,bool RequiresHistoricalAcknowledgement,bool ReservedForRequest=false,bool CanCheckout=false,bool CanPay=false);
public sealed record SourcingSupplyInventoryItem(string RequestId,string RequestReference,string RequestVersion,SourcingSupplySummary Task);
public sealed record SourcingSupplyInventoryPage(int SchemaVersion,int PageSize,SourcingSupplyInventoryItem[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record SourcingSupplyEventData(string Id,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? StateBefore,string StateAfter,string ReceiptProgress,string ActorKind,string ReasonCode,string PublicMessageFa,string PublicMessageEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ActionAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]DateTimeOffset? ExpectedAt,DateTimeOffset At);
public sealed record SourcingSupplyEventPage(int SchemaVersion,int PageSize,SourcingSupplyEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record SourcingSupplyAdminEventData(SourcingSupplyEventData Event,string ActorId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceKind,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceKey,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceNameFa,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? SourceNameEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? Reference,string InternalNote);
public sealed record SourcingSupplyAdminEventPage(int SchemaVersion,int PageSize,SourcingSupplyAdminEventData[] Items,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? NextCursor);
public sealed record SourcingSupplyMutation(int SchemaVersion,string RequestId,string TaskId,string OfferId,string AcceptanceId,string Operation,string State,string ReceiptProgress,string Version,string RequestVersion,string EventId,DateTimeOffset At,bool Replayed,bool CanCheckout=false,bool CanPay=false);

public interface ISourcingSupplyNoteProtection
{
    string Protect(string ownerId,string taskId,string note);
    string Unprotect(string ownerId,string taskId,string protectedNote);
}

public static class SourcingSupplyRules
{
    public static readonly string[] States=["PendingSupply","SupplierRequested","SupplierOrderRecorded","Cancelled","Failed"];
    public static readonly string[] Operations=["start","requested","ordered","progress","cancel","fail"];
    public static bool Open(string state)=>state is "PendingSupply" or "SupplierRequested" or "SupplierOrderRecorded";
    public static string ReceiptProgress(IEnumerable<(int Required,int Received)> lines)
    {
        var rows=lines.ToArray();
        if(rows.Length is <1 or >64||rows.Any(l=>l.Required is <1 or >1000000||l.Received<0||l.Received>l.Required))throw Invalid();
        return rows.All(l=>l.Received==l.Required)?"Complete":rows.Any(l=>l.Received>0)?"Partial":"None";
    }
    public static string EffectiveState(string state,string progress)
    {
        if(!States.Contains(state,StringComparer.Ordinal)||progress is not ("None" or "Partial" or "Complete"))throw Invalid();
        return !Open(state)?state:progress=="Complete"?"Received":progress=="Partial"?"PartiallyReceived":state;
    }
    public static string ExternalKey(string? value,int max=120)=>value is {Length:>0}&&value.Length<=max&&value==value.Trim()&&!value.Any(char.IsControl)?value:throw Invalid();
    public static DateTimeOffset Utc(DateTimeOffset value)=>value.Offset==TimeSpan.Zero?value:throw Invalid();
    public static DateTimeOffset? Utc(DateTimeOffset? value)=>value is null?null:Utc(value.Value);
    public static SourcingSupplyStartInput Normalize(SourcingSupplyStartInput input)=>new(SourcingRules.CommandId(input.RequestId),SourcingRules.Version(input.RequestVersion),SourcingRules.Version(input.OfferVersion),SourcingRules.Fingerprint(input.TermsHash));
    public static SourcingSupplySourceInput Normalize(SourcingSupplySourceInput input,bool ordered)
    {
        if(input.SourceKind is not ("manual" or "csv"))throw Invalid();
        var reference=input.Reference is null?null:ExternalKey(input.Reference,200);
        if(ordered&&reference is null)throw Invalid();
        return new(SourcingRules.CommandId(input.RequestId),SourcingRules.Version(input.RequestVersion),SourcingRules.Version(input.TaskVersion),input.SourceKind,ExternalKey(input.SourceKey),SourcingRules.Text(input.SourceNameFa,200,true),SourcingRules.Text(input.SourceNameEn,200,true),reference,Utc(input.ActionAt),SourcingRules.Text(input.PublicMessageFa,500,true),SourcingRules.Text(input.PublicMessageEn,500,true),Utc(input.ExpectedAt),SourcingRules.Text(input.InternalNote,2000));
    }
    public static SourcingSupplyProgressInput Normalize(SourcingSupplyProgressInput input)=>new(SourcingRules.CommandId(input.RequestId),SourcingRules.Version(input.RequestVersion),SourcingRules.Version(input.TaskVersion),Utc(input.ActionAt),SourcingRules.Text(input.PublicMessageFa,500,true),SourcingRules.Text(input.PublicMessageEn,500,true),Utc(input.ExpectedAt),SourcingRules.Text(input.InternalNote,2000));
    public static SourcingSupplyCloseInput Normalize(SourcingSupplyCloseInput input)=>new(SourcingRules.CommandId(input.RequestId),SourcingRules.Version(input.RequestVersion),SourcingRules.Version(input.TaskVersion),SourcingRules.Reason(input.ReasonCode),SourcingRules.Text(input.PublicMessageFa,500,true),SourcingRules.Text(input.PublicMessageEn,500,true),SourcingRules.Text(input.InternalNote,2000));
    public static BusinessException Invalid()=>new("invalid_sourcing_supply","Use bounded explicit supply fields, UTC times, current versions and a UUID command id.");
}

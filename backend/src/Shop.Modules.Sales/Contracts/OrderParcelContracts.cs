using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ParcelCommandInput(string OwnerId,string CommandId,string Action,string OrderVersion,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? ParcelId,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? ParcelVersion,string InventoryFingerprint,string Reason,bool Acknowledge,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? Reference,PartialDispatchSelection[] Lines,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? CarrierNameFa,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? CarrierNameEn,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? TrackingNumber,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? OccurredAt);
public sealed record ParcelLineBalance(string LineKey,string VariantId,int Ordered,int Packed,int Dispatched,int Delivered,int Remaining);
public sealed record ParcelLineReference(string LineKey,int Quantity);
public sealed record ParcelSummary(string Id,string Number,string Reference,string State,string Version,int PackingRevision,
    DateTimeOffset PackedAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? DispatchedAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? DeliveredAt,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] DateTimeOffset? VoidedAt,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? CarrierNameFa,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? CarrierNameEn,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? TrackingNumber,ParcelLineReference[] Lines);
public sealed record ParcelDetail(int SchemaVersion,string OrderId,ParcelSummary Parcel,bool ContainsDemo,
    bool UnitDetailsVisible,ShipmentLineData[] Lines,ShipmentUnitData[] Units);
public sealed record ParcelPackedUnit(string ParcelId,FulfillmentInventoryUnit Unit);
public sealed record ParcelPage(int SchemaVersion,string OrderId,string OwnerId,string OrderState,string OrderVersion,
    string Mode,bool ContainsDemo,string InventoryFingerprint,int DispatchCount,int ActiveParcelCount,ParcelLineBalance[] Lines,ShipmentLineData[] OrderLines,
    FulfillmentInventoryUnit[] AvailableUnits,ParcelPackedUnit[] PackedUnits,ParcelSummary[] Parcels,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? NextAfter,
    bool CanPack,bool CreditAuthorized,string[] Blockers,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingDefault)]int DigitalDispatchCount=0,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.WhenWritingNull)]string[]? DigitalLineKeys=null);
public sealed record CustomerFulfillmentData(int SchemaVersion,string OrderId,string Mode,
    [property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] CustomerShipmentData? Single,ParcelSummary[] Parcels,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)] string? NextAfter,bool ManualCarrierReport);
public sealed record ParcelCommandResult(int SchemaVersion,string CommandId,string PayloadHash,string OrderId,
    string Action,string InventoryFingerprint,string Reason,DateTimeOffset RecordedAt,string OrderVersion,
    ParcelDetail Detail,bool Replayed);
public interface IOrderParcelProtection
{
    byte[] Protect(string actor,string order,string command,string text);
    string Unprotect(string actor,string order,string command,byte[] bytes);
}
public static class ParcelRules
{
    public const int MaxReceiptBytes=4194304;
    public static PartialFulfillmentPlan Plan(PartialFulfillmentView view,PartialDispatchRequest input)
    {
        try{return PartialFulfillmentRules.Plan(view,input);}
        catch(BusinessException e)when(e.Code=="partial_fulfillment_capacity_unavailable"){throw Conflict("capacity","The final permitted parcel must contain every remaining reserved item. Repack it explicitly.");}
    }
    public static ParcelCommandInput Normalize(ParcelCommandInput x)
    {
        if(x is null||!x.Acknowledge||x.Action is not("pack"or"repack"or"void"or"dispatch"or"deliver")||x.Lines is null)throw Invalid();
        var owner=OrderInputRules.Identifier(x.OwnerId);var command=ShipmentRules.Uuid(x.CommandId);
        var version=ShipmentRules.Version(x.OrderVersion);var fp=ShipmentRules.Fingerprint(x.InventoryFingerprint);
        var parcel=x.ParcelId is null?null:ShipmentRules.Uuid(x.ParcelId);var pv=x.ParcelVersion is null?null:ShipmentRules.Version(x.ParcelVersion);
        var reason=Text(x.Reason,400,false)!;var reference=Text(x.Reference,120,true);
        var fa=Text(x.CarrierNameFa,120,true);var en=Text(x.CarrierNameEn,120,true);var tracking=Text(x.TrackingNumber,120,true);var at=x.OccurredAt?.ToUniversalTime();
        if(x.Action=="pack"?(parcel is not null||pv is not null||reference is null):(parcel is null||pv is null||reference is not null))throw Invalid();
        PartialDispatchSelection[] lines=[];
        if(x.Action is "pack"or"repack"){
            // Reuse the Inventory boundary's exact selection normalization; never trust a client SKU or quantity total.
            lines=PartialFulfillmentRules.Normalize(new(owner,new string('1',32),new string('2',32),owner,command,fp,x.Lines)).Lines;
            if(fa is not null||en is not null||tracking is not null||at is not null)throw Invalid();
        }else{
            if(x.Lines.Length!=0)throw Invalid();
            if(x.Action=="void") {if(fa is not null||en is not null||tracking is not null||at is not null)throw Invalid();}
            else if(at is null||(x.Action=="dispatch"?(fa is null||en is null):(fa is not null||en is not null||tracking is not null)))throw Invalid();
        }
        return new(owner,command,x.Action,version,parcel,pv,fp,reason,true,reference,lines,fa,en,tracking,at);
    }
    public static string? After(string? value)
    {
        if(value is null)return null;
        if(!long.TryParse(value,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out var n)||n<1||n.ToString(System.Globalization.CultureInfo.InvariantCulture)!=value)throw Invalid();return value;
    }
    private static string? Text(string? x,int max,bool optional){if(x is null)return optional?null:throw Invalid();var s=x.Trim();if(optional&&s.Length==0)return null;if(s.Length is 0||s.Length>max||s.Any(char.IsControl))throw Invalid();return s;}
    public static BusinessException Invalid()=>new("invalid_parcel","Provide the exact bounded parcel selection, versions, reason and explicit confirmation.");
    public static BusinessException Unavailable()=>new("parcel_unavailable","The immutable parcel and reservation history could not be verified.");
    public static BusinessException Conflict(string suffix,string text)=>new("parcel_"+suffix+"_conflict",text);
}

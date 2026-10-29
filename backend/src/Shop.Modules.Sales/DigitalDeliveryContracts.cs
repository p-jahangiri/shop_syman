using System.Text;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Sales;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DigitalDeliveryLineInput(string LineKey,string[] Contents);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DigitalDeliveryInput(string OwnerId,string CommandId,string OrderVersion,string InventoryFingerprint,string Reason,bool Acknowledge,DigitalDeliveryLineInput[] Lines);
public sealed record DigitalDeliveryLineSummary(string LineKey,string VariantId,string ProductId,string Sku,string Name,string Label,int Quantity);
public sealed record DigitalDeliverySummary(string Id,DateTimeOffset AvailableAt,DigitalDeliveryLineSummary[] Lines);
public sealed record DigitalDeliveryResult(int SchemaVersion,string CommandId,string OrderId,string OrderVersion,DigitalDeliverySummary Delivery,bool Replayed);
public sealed record DigitalContentItem(string Id,string LineKey,string Content);
public sealed record DigitalDeliveryContent(int SchemaVersion,string OrderId,string DeliveryId,DateTimeOffset AvailableAt,DigitalContentItem[] Items);
public sealed record DigitalLineBalance(string LineKey,string VariantId,string ProductId,string Sku,string Name,string Label,int Ordered,int Available,int Remaining);
public sealed record AdminDigitalDeliveryPage(int SchemaVersion,string OrderId,string OwnerId,string OrderState,string OrderVersion,string InventoryFingerprint,bool ContainsDemo,bool CanDeliver,bool CreditAuthorized,int RemainingDeliverySlots,DigitalLineBalance[] Lines,DigitalDeliverySummary[] Deliveries,string[] Blockers);
public sealed record CustomerDigitalDeliveries(int SchemaVersion,string OrderId,DigitalDeliverySummary[] Deliveries);
public interface IDigitalDeliveryProtection
{
    byte[] Protect(string purpose,string owner,string order,string id,string text);
    string Unprotect(string purpose,string owner,string order,string id,byte[] bytes);
}

public static class DigitalDeliveryRules
{
    public const int MaxUnits=100,MaxContentBytes=4096,MaxBatchContentBytes=65536;
    private static readonly UTF8Encoding Utf8=new(false,true);
    public static DigitalDeliveryInput Normalize(DigitalDeliveryInput input)
    {
        if(input is null||!input.Acknowledge||input.Lines is not{Length:>0 and<=64}||input.Lines.Any(x=>x is null))throw Invalid();
        var owner=OrderInputRules.Identifier(input.OwnerId);var command=ShipmentRules.Uuid(input.CommandId);var version=ShipmentRules.Version(input.OrderVersion);var fingerprint=ShipmentRules.Fingerprint(input.InventoryFingerprint);
        var reason=input.Reason?.Trim();if(reason is not{Length:>0 and<=400}||reason.Any(char.IsControl))throw Invalid();
        var count=0;var bytes=0;
        var lines=input.Lines.Select(line=>{
            var key=PartialFulfillmentRules.Identifier(line.LineKey);
            if(line.Contents is not{Length:>0 and<=MaxUnits})throw Invalid();
            var contents=line.Contents.Select(content=>{
                if(content is null||content.Length>MaxContentBytes)throw Invalid();
                // Preserve code whitespace and order. Only CRLF is canonicalized.
                var value=content.Replace("\r\n","\n",StringComparison.Ordinal);
                if(string.IsNullOrWhiteSpace(value)||value.Any(c=>char.IsControl(c)&&c is not('\n'or'\t')))throw Invalid();
                int size;try{size=Utf8.GetByteCount(value);}catch(EncoderFallbackException){throw Invalid();}
                if(size>MaxContentBytes||++count>MaxUnits||(bytes+=size)>MaxBatchContentBytes)throw Invalid();
                return value;
            }).ToArray();return new DigitalDeliveryLineInput(key,contents);
        }).OrderBy(x=>x.LineKey,StringComparer.Ordinal).ToArray();
        if(lines.Select(x=>x.LineKey).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=lines.Length)throw Invalid();
        return new(owner,command,version,fingerprint,reason,true,lines);
    }
    public static BusinessException Invalid()=>new("invalid_digital_delivery","Provide the exact digital lines, one bounded text per unit, reviewed versions, reason and confirmation.");
    public static BusinessException Unavailable()=>new("digital_delivery_unavailable","The owned digital delivery history could not be verified.");
}

public static class FulfillmentCapacityRules
{
    // Both kinds share Inventory's finite, immutable dispatch ledger. Reserve
    // enough future slots before an irreversible delivery can strand the rest.
    public static PartialFulfillmentPlan Plan(PartialFulfillmentView view,PartialDispatchRequest request,IReadOnlySet<string> digitalKeys,bool digital)
    {
        var plan=PartialFulfillmentRules.Plan(view,request);
        if(digitalKeys.Any(key=>!view.Lines.Any(l=>l.LineKey==key))||view.Lines.Any(l=>digitalKeys.Contains(l.LineKey)&&l.TrackingMode!="none"))throw DigitalDeliveryRules.Unavailable();
        if(plan.Lines.Any(l=>digitalKeys.Contains(l.LineKey)!=digital))throw new BusinessException("fulfillment_kind_conflict","Use digital delivery for digital lines and physical parcels for physical lines.");
        var selected=plan.Lines.ToDictionary(l=>l.LineKey,l=>l.Quantity,StringComparer.Ordinal);
        var digitalRemaining=view.Lines.Where(l=>digitalKeys.Contains(l.LineKey)).Sum(l=>(long)l.Remaining-selected.GetValueOrDefault(l.LineKey));
        var physicalRemaining=view.Lines.Any(l=>!digitalKeys.Contains(l.LineKey)&&l.Remaining>selected.GetValueOrDefault(l.LineKey));
        var required=(digitalRemaining+DigitalDeliveryRules.MaxUnits-1)/DigitalDeliveryRules.MaxUnits+(physicalRemaining?1:0);
        if(required>PartialFulfillmentRules.MaxDispatches-view.DispatchCount-1)throw new BusinessException("fulfillment_capacity_conflict","This selection would leave too few delivery slots for the remaining digital and physical items.");
        if(digital&&plan.Lines.Sum(l=>(long)l.Quantity)>DigitalDeliveryRules.MaxUnits)throw DigitalDeliveryRules.Invalid();
        return plan;
    }
}

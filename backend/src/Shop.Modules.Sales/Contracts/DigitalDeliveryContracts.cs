using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
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
public sealed record AdminDigitalDeliveryPage(int SchemaVersion,string OrderId,string OwnerId,string OrderState,string OrderVersion,[property:JsonIgnore(Condition=JsonIgnoreCondition.Never)]string? InventoryFingerprint,bool ContainsDemo,bool CanDeliver,bool CreditAuthorized,int RemainingDeliverySlots,DigitalLineBalance[] Lines,DigitalDeliverySummary[] Deliveries,string[] Blockers);
public sealed record CustomerDigitalDeliveries(int SchemaVersion,string OrderId,DigitalDeliverySummary[] Deliveries);
public interface IDigitalDeliveryProtection
{
    byte[] Protect(string purpose,string owner,string order,string id,string text);
    string Unprotect(string purpose,string owner,string order,string id,byte[] bytes);
}

public static class DigitalDeliveryRules
{
    public const int MaxUnits=100,MaxContentBytes=4096,MaxBatchContentBytes=65536;
    public const int MaxOrderLineMetadataBytes=4096;
    public const int GuaranteedUnitsPerFutureBatch=MaxBatchContentBytes/MaxContentBytes;
    private static readonly UTF8Encoding Utf8=new(false,true);
    private static readonly JsonSerializerOptions OrderMetadataJson=new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions EncryptedEnvelopeJson=new(JsonSerializerDefaults.Web){Encoder=JavaScriptEncoder.UnsafeRelaxedJsonEscaping,MaxDepth=24};
    public static void RequireOrderCapacity(IEnumerable<(bool IsDigital,int Quantity)> lines)
    {
        var digital=0L;var physical=false;
        foreach(var line in lines){if(line.Quantity is<1 or>1000000)throw new BusinessException("invalid_quantity","Order quantities must be bounded positive integers.");if(line.IsDigital)digital=checked(digital+line.Quantity);else physical=true;}
        var slots=PartialFulfillmentRules.MaxDispatches-(physical?1:0);
        if(digital>(long)slots*GuaranteedUnitsPerFutureBatch)throw new BusinessException("digital_delivery_order_capacity_conflict","This order contains more digital units than can be guaranteed within the bounded delivery history. Reduce the quantity or place separate orders.");
    }
    public static void RequireOrderCapacity(IEnumerable<(bool IsDigital,int Quantity,string Sku,string Name,string Label)> lines)
    {
        var snapshot=lines.ToArray();RequireOrderCapacity(snapshot.Select(l=>(l.IsDigital,l.Quantity)));
        foreach(var line in snapshot.Where(l=>l.IsDigital)){
            // Delivery manifests deliberately retain complete immutable product
            // metadata. Bound its strict Web JSON form before accepting a new
            // order so any future 16-unit batch fits its 128KiB envelope.
            // Never truncate a label or apply this gate to historical reads.
            if(line.Sku is null||line.Name is null||line.Label is null||
               line.Sku.Length>MaxOrderLineMetadataBytes||line.Name.Length>MaxOrderLineMetadataBytes||line.Label.Length>MaxOrderLineMetadataBytes||
               JsonSerializer.SerializeToUtf8Bytes(new{line.Sku,line.Name,line.Label},OrderMetadataJson).Length>MaxOrderLineMetadataBytes)
                throw new BusinessException("digital_delivery_metadata_capacity_conflict","The complete digital product name, SKU or label exceeds the supported delivery metadata size. Shorten its catalog metadata before ordering; no text is truncated.");
        }
    }
    // This serialization is encrypted immediately and is never emitted as API
    // JSON or HTML. Avoid sixfold HTML escaping of valid literal license text,
    // which otherwise exceeds the unchanged 16KiB encrypted-item SQL limit.
    public static string SerializeEncryptedEnvelope<T>(T value)=>JsonSerializer.Serialize(value,EncryptedEnvelopeJson);
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
        // Future content is not known yet. A batch of maximum-size items must
        // fit both the unit limit and byte limit, even when today's short codes
        // permit a larger batch. Every irreversible hand-off preserves this.
        var futureUnits=Math.Min(DigitalDeliveryRules.MaxUnits,DigitalDeliveryRules.GuaranteedUnitsPerFutureBatch);
        var required=(digitalRemaining+futureUnits-1)/futureUnits+(physicalRemaining?1:0);
        if(required>PartialFulfillmentRules.MaxDispatches-view.DispatchCount-1)throw new BusinessException("fulfillment_capacity_conflict","This selection would leave too few delivery slots for the remaining digital and physical items.");
        if(digital&&plan.Lines.Sum(l=>(long)l.Quantity)>DigitalDeliveryRules.MaxUnits)throw DigitalDeliveryRules.Invalid();
        return plan;
    }
}
